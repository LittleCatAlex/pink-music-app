const { app, BrowserWindow, ipcMain, session, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const crypto = require('crypto');

// 显式固定 userData 目录，使开发版（npm run electron:dev）和
// 打包版（electron-builder）走同一个目录，B 站登录 cookie 互通、长期保持登录态。
// 默认情况下，Electron 在开发模式用 package.json#name、打包后用 productName，
// 二者 userData 路径不同，会导致 cookie 互相隔离。
function getFixedUserDataDir() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'pink-music');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'pink-music');
  }
  return path.join(home, '.config', 'pink-music');
}
if (typeof app.setPath === 'function') {
  try { app.setPath('userData', getFixedUserDataDir()); } catch (e) { /* ignore */ }
}

const cacheManager = require('./cacheManager');

// —— EPIPE 防御 ——
// 当 Electron 进程被以 `&` 后台启动、父 shell 退出后，stdout/stderr 管道会被关闭。
// 此后任何 `console.log/error` 写入都会触发 EPIPE，Node 会把这种 stream 错误升级为
// Uncaught Exception 并在后续 IPC 调用时反复抛出。吞掉 EPIPE，让控制台日志失败不再致命。
const swallowEpipe = (err) => {
  if (err && err.code === 'EPIPE') return;
  // 其它错误仍然抛回（不静默吞掉）
  throw err;
};
process.stdout.on('error', swallowEpipe);
process.stderr.on('error', swallowEpipe);

// 顺手也加个全局兜底，防止任意 unhandled error 直接干掉渲染链路
process.on('uncaughtException', (err) => {
  if (err && err.code === 'EPIPE') return;
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  if (reason && reason.code === 'EPIPE') return;
  console.error('[unhandledRejection]', reason);
});

const BILIBILI_BASE = 'https://api.bilibili.com';
const BILIBILI_WEB = 'https://passport.bilibili.com';

const UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// B 站风控 wbi 签名：/x/v3/fav/* 等接口必须带 wts + w_rid。
// 参考 biu-master 的 wbi-sign.ts 改写为 Node.js 实现（用内置 crypto 算 md5）。
const mixinKeyEncTab = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34,
  44, 52
];
function getMixinKey(orig) {
  return mixinKeyEncTab.map(n => orig[n]).join('').slice(0, 32);
}
function wbiSignParams(params, imgKey, subKey) {
  if (!imgKey || !subKey) return { ...params };
  const mixinKey = getMixinKey(imgKey + subKey);
  const wts = Math.round(Date.now() / 1000);
  const enriched = { ...params, wts };
  const keys = Object.keys(enriched).filter(k => enriched[k] !== undefined && enriched[k] !== null && enriched[k] !== '').sort();
  const chrFilter = /[!'()*]/g;
  const query = keys.map(k => {
    const v = String(enriched[k]).replace(chrFilter, '');
    return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
  }).join('&');
  const crypto = require('crypto');
  const wRid = crypto.createHash('md5').update(query + mixinKey).digest('hex');
  return { ...enriched, w_rid: wRid };
}
function extractWbiKeys(wbiImg) {
  if (!wbiImg) return { imgKey: '', subKey: '' };
  const { img_url, sub_url } = wbiImg;
  const extract = (u) => u ? u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.')) : '';
  return { imgKey: extract(img_url), subKey: extract(sub_url) };
}

let wbiKeysCache = { imgKey: '', subKey: '', updatedAt: 0 };
function updateWbiKeys(wbiImg) {
  if (!wbiImg) return;
  const keys = extractWbiKeys(wbiImg);
  if (keys.imgKey && keys.subKey) {
    wbiKeysCache = { ...keys, updatedAt: Date.now() };
  }
}

class BilibiliAPI {
  constructor() {
    this.cookies = {};
    this.axios = axios.create({
      timeout: 30000,
      withCredentials: false,
      headers: {
        'User-Agent': UserAgent,
        'Referer': 'https://www.bilibili.com/',
        'Origin': 'https://www.bilibili.com',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    // 请求拦截器：每次请求前自动注入最新 Cookie + 给 fav 路径加 wbi 签名
    this.axios.interceptors.request.use((config) => {
      try {
        const cookies = this.cookies || {};
        const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
        if (cookieHeader) {
          config.headers = config.headers || {};
          config.headers.Cookie = cookieHeader;
        }
        // 路径匹配 fav 系列：自动加 wbi 签名
        if (config.url && config.url.includes('/x/v3/fav/')) {
          config.params = config.params || {};
          config.params = wbiSignParams(config.params, wbiKeysCache.imgKey, wbiKeysCache.subKey);
        }
      } catch (e) { /* ignore */ }
      return config;
    });
  }

  async refreshCookiesFromSession() {
    // 三源合并：JSON 持久化（冷启动） < session 内存（热路径）< 文件最新落盘值
    let fileCookies = {};
    try {
      if (fs.existsSync(COOKIE_STORE_PATH)) {
        const raw = fs.readFileSync(COOKIE_STORE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') fileCookies = parsed;
      }
    } catch (e) { /* ignore */ }

    let sessionCookies = {};
    const target = bilibiliSession || (session && session.defaultSession);
    if (target && target.cookies) {
      try {
        const list = await target.cookies.get({ domain: '.bilibili.com' });
        list.forEach(c => { sessionCookies[c.name] = c.value; });
      } catch (error) {
        console.error('[debug] 从 session 读 cookies 失败:', error);
      }
    }

    // session 覆盖 file（session 是热路径值更新），但 file 中已存在且 session 没有的仍保留
    this.cookies = { ...fileCookies, ...sessionCookies };
    // 落盘（保持 JSON 是当前真实状态的镜像）
    try { fs.writeFileSync(COOKIE_STORE_PATH, JSON.stringify(this.cookies, null, 2), 'utf-8'); } catch (e) {}
    console.log('[debug] refreshCookiesFromSession merged =', Object.keys(this.cookies).join(','));
  }

  async request(url, options = {}) {
    // Cookie 注入和 wbi 签名由 axios interceptor 自动处理
    // （interceptor 从 this.cookies 取最新值；fav/* 路径自动加 wts+w_rid）
    try {
      const response = await this.axios({
        url,
        ...options
      });
      return response.data;
    } catch (error) {
      console.error('API请求失败:', url, error.message);
      throw error;
    }
  }

  async searchMusic(keyword, page = 1, pageSize = 20) {
    try {
      console.log('搜索音乐:', keyword, page, pageSize);
      const data = await this.request(`${BILIBILI_BASE}/x/web-interface/search/all/v2`, {
        params: {
          keyword,
          page,
          page_size: pageSize
        }
      });
      console.log('搜索结果:', JSON.stringify(data, null, 2));
      return data;
    } catch (error) {
      console.error('搜索失败:', error);
      return { code: -1, message: error.message };
    }
  }

  /**
   * 音乐区推荐（参考 biu-master 的 getRegionFeedRcmd）
   * 仅返回 tid=1003（音乐区）的内容，避免被全站搜索误导到擦边视频
   */
  async getMusicRegionFeed(displayId = 1, requestCnt = 15) {
    try {
      console.log('[debug] getMusicRegionFeed: page=', displayId, 'cnt=', requestCnt);
      const data = await this.request(`${BILIBILI_BASE}/x/web-interface/region/feed/rcmd`, {
        params: {
          display_id: displayId,
          request_cnt: requestCnt,
          from_region: 1003, // 音乐区
          device: 'web',
          plat: 30,
          web_location: '333.40138'
        }
      });
      console.log('[debug] getMusicRegionFeed ok, archives:', data?.data?.archives?.length);
      return data;
    } catch (error) {
      console.error('音乐区推荐获取失败:', error);
      return { code: -1, message: error.message, data: { archives: [] } };
    }
  }

  async getMusicInfo(bvid) {
    try {
      console.log('获取音乐信息:', bvid);
      const data = await this.request(`${BILIBILI_BASE}/x/web-interface/view`, {
        params: { bvid }
      });
      console.log('音乐信息结果:', JSON.stringify(data, null, 2));
      return data;
    } catch (error) {
      console.error('获取音乐信息失败:', error);
      return { code: -1, message: error.message };
    }
  }

  /**
   * 热门音乐排行（参考 biu-master 的 getMusicComprehensiveWebRank）
   * GET /x/centralization/interface/music/comprehensive/web/rank
   */
  async getMusicComprehensiveWebRank(pn = 1, ps = 20) {
    try {
      console.log('[debug] getMusicComprehensiveWebRank: pn=', pn, 'ps=', ps);
      const data = await this.request(`${BILIBILI_BASE}/x/centralization/interface/music/comprehensive/web/rank`, {
        params: {
          pn,
          ps,
          web_location: '333.1351'
        }
      });
      console.log('[debug] getMusicComprehensiveWebRank ok, list:', data?.data?.list?.length);
      return data;
    } catch (error) {
      console.error('热门音乐排行获取失败:', error);
      return { code: -1, message: error.message, data: { list: [] } };
    }
  }

  async getMusicPlayUrl(bvid, cid) {
    try {
      console.log('获取播放地址:', bvid, cid);
      const data = await this.request(`${BILIBILI_BASE}/x/player/playurl`, {
        params: {
          bvid,
          cid,
          qn: 0,
          fnval: 4048, // DASH格式（必须）
          fnver: 0,
          fourk: 1
        }
      });
      console.log('播放地址结果:', JSON.stringify(data, null, 2));
      return data;
    } catch (error) {
      console.error('获取播放地址失败:', error);
      return { code: -1, message: error.message };
    }
  }

  async getVideoEpisodes(bvid) {
    try {
      console.log('获取视频分P列表:', bvid);
      const data = await this.request(`${BILIBILI_BASE}/x/player/pagelist`, {
        params: { bvid }
      });
      console.log('分P列表结果:', JSON.stringify(data, null, 2));
      return data;
    } catch (error) {
      console.error('获取分P列表失败:', error);
      return { code: -1, message: error.message };
    }
  }

  async getAudioProxy(audioUrl) {
    try {
      console.log('代理音频请求:', audioUrl);
      const response = await this.axios({
        method: 'get',
        url: audioUrl,
        responseType: 'arraybuffer',
        headers: {
          'Referer': 'https://www.bilibili.com',
          'User-Agent': UserAgent
        },
        timeout: 60000
      });
      return Buffer.from(response.data);
    } catch (error) {
      console.error('音频代理失败:', error.message);
      throw error;
    }
  }

  async getRecommendations() {
    try {
      const headers = {
        'Referer': 'https://www.bilibili.com',
        'User-Agent': UserAgent
      };

      const response = await this.axios.get(`${BILIBILI_BASE}/x/web-interface/index/top/feed/rcmd`, {
        params: {
          platform: 'web',
          web_location: 1550101,
          aid: 1,
          appkey: '84956560bc028eb7'
        },
        headers: {
          ...headers,
          Cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
        }
      });
      return response.data;
    } catch (error) {
      console.error('获取推荐内容失败:', error.message);
      return { code: -1, message: error.message };
    }
  }

  async generateQrcode() {
    try {
      const response = await this.axios.get(`${BILIBILI_WEB}/x/passport-login/web/qrcode/generate`, {
        headers: { Referer: 'https://passport.bilibili.com/' }
      });
      return response.data;
    } catch (error) {
      console.error('申请二维码失败:', error.message);
      return { code: -1, message: error.message };
    }
  }

  async pollQrcode(qrcodeKey) {
    try {
      const response = await this.axios.get(`${BILIBILI_WEB}/x/passport-login/web/qrcode/poll`, {
        params: { qrcode_key: qrcodeKey },
        headers: { Referer: 'https://passport.bilibili.com/' }
      });
      return { code: 0, data: response.data, headers: response.headers };
    } catch (error) {
      console.error('轮询二维码失败:', error.message);
      return { code: -1, message: error.message };
    }
  }

  async getUserNavInfo() {
    try {
      await this.refreshCookiesFromSession();
      // axios interceptor 会自动注入 Cookie
      const response = await this.axios.get(`${BILIBILI_BASE}/x/web-interface/nav`);
      // 缓存 wbi img_key / sub_key（供 /x/v3/fav/* 接口签名使用）
      if (response.data?.data?.wbi_img) {
        updateWbiKeys(response.data.data.wbi_img);
      }
      return response.data;
    } catch (error) {
      console.error('获取用户信息失败:', error.message);
      return { code: -1, message: error.message };
    }
  }

  async getFavFolderCreatedList(upMid, pn = 1, ps = 50) {
    try {
      await this.refreshCookiesFromSession();
      // axios interceptor 会自动注入 Cookie + 给 /x/v3/fav/ 加 wbi 签名
      const response = await this.axios.get(`${BILIBILI_BASE}/x/v3/fav/folder/created/list`, {
        params: { up_mid: upMid, pn, ps, web_location: '333.1387' }
      });
      return response.data;
    } catch (error) {
      console.error('获取创建的收藏夹失败:', error.message, error.response?.data);
      return { code: -1, message: error.message };
    }
  }

  async getFavFolderCollectedList(upMid, pn = 1, ps = 50) {
    try {
      await this.refreshCookiesFromSession();
      const response = await this.axios.get(`${BILIBILI_BASE}/x/v3/fav/folder/collected/list`, {
        params: { up_mid: upMid, pn, ps, platform: 'web' }
      });
      return response.data;
    } catch (error) {
      console.error('获取收藏的收藏夹失败:', error.message, error.response?.data);
      return { code: -1, message: error.message };
    }
  }

  async getFavResourceList(mediaId, pn = 1, ps = 20) {
    try {
      await this.refreshCookiesFromSession();
      // B 站 /x/v3/fav/resource/list 的 ps 定义域为 1-20，超过会被 -400 拒绝
      // 同步补齐 tid=0（全部分区）与 type=0（仅当前收藏夹），与 biu-master 保持一致
      const safePs = Math.max(1, Math.min(20, Number(ps) || 20));
      const safePn = Math.max(1, Number(pn) || 1);
      // axios interceptor 会自动注入 Cookie + 给 /x/v3/fav/ 加 wbi 签名
      const response = await this.axios.get(`${BILIBILI_BASE}/x/v3/fav/resource/list`, {
        params: { media_id: mediaId, pn: safePn, ps: safePs, tid: 0, type: 0, platform: 'web', order: 'mtime' }
      });
      const data = response.data;
      if (data?.code !== 0) {
        console.error('getFavResourceList B站返回非 0:', data?.code, data?.message, 'mediaId=', mediaId, 'pn=', safePn, 'ps=', safePs);
      } else {
        console.log('[debug] getFavResourceList 成功, medias:', data.data?.medias?.length, 'mediaId=', mediaId);
      }
      return data;
    } catch (error) {
      console.error('获取收藏夹资源失败:', error.message, error.response?.data);
      return { code: -1, message: error.message };
    }
  }

  /**
   * 获取收藏夹全部内容 id（不分页，单次拿到所有 id）
   * 参考 biu-master 的 getFavResourceIds，避免对 /x/v3/fav/resource/list 分页循环触发 -412
   * 注意：/x/v3/fav/resource/ids 不在 /x/v3/fav/ 前缀下，wbi 拦截器不会加签名
   */
  async getFavResourceIds(mediaId) {
    try {
      await this.refreshCookiesFromSession();
      const response = await this.axios.get(`${BILIBILI_BASE}/x/v3/fav/resource/ids`, {
        params: { media_id: mediaId, platform: 'web' }
      });
      const data = response.data;
      if (data?.code !== 0) {
        console.error('getFavResourceIds B站返回非 0:', data?.code, data?.message, 'mediaId=', mediaId);
        return data;
      }
      console.log('[debug] getFavResourceIds 成功, count:', Array.isArray(data?.data) ? data.data.length : 0, 'mediaId=', mediaId);
      return data;
    } catch (error) {
      console.error('获取收藏夹 id 列表失败:', error.message, error.response?.data);
      return { code: -1, message: error.message };
    }
  }

  /**
   * 批量获取收藏资源详情（按 50 个一组）。
   * - resources 形如 "583785685:2,15664:12"（id:type 逗号分隔，最多 50 个）
   * - 注意：/x/v3/fav/resource/infos 不在 /x/v3/fav/ 前缀下，wbi 拦截器不会加签名
   *   但 biu-master 通过 `useWbi: true` 显式给该接口签名，我们走主进程 axios 默认会加
   */
  async getFavResourceInfos(resources) {
    try {
      await this.refreshCookiesFromSession();
      if (typeof resources !== 'string' || !resources) {
        return { code: -400, message: 'resources 不能为空', data: null };
      }
      const response = await this.axios.get(`${BILIBILI_BASE}/x/v3/fav/resource/infos`, {
        params: { resources, platform: 'web' }
      });
      const data = response.data;
      if (data?.code !== 0) {
        console.error('getFavResourceInfos B站返回非 0:', data?.code, data?.message, 'size=', resources.split(',').length);
      } else {
        console.log('[debug] getFavResourceInfos 成功, count:', Array.isArray(data?.data) ? data.data.length : 0);
      }
      return data;
    } catch (error) {
      console.error('获取收藏资源详情失败:', error.message, error.response?.data);
      return { code: -1, message: error.message };
    }
  }

  async getVideoSeries(bvid) {
    try {
      const headers = {
        'Referer': 'https://www.bilibili.com',
        'User-Agent': UserAgent
      };

      const videoInfo = await this.getMusicInfo(bvid);
      if (videoInfo.code === 0 && videoInfo.data && videoInfo.data.season_id) {
        const seasonId = videoInfo.data.season_id;
        const mid = videoInfo.data.owner?.mid;
        
        if (seasonId && mid) {
          const response = await this.axios.get(`${BILIBILI_BASE}/x/polymer/web-space/seasons_archives_list`, {
            params: {
              mid: mid,
              season_id: seasonId
            },
            headers: {
              ...headers,
              Cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
            }
          });
          return response.data;
        }
      }
      
      try {
        const response = await this.axios.get(`${BILIBILI_BASE}/x/polymer/space/seasons_archives_list`, {
          params: {
            bvid: bvid
          },
          headers
        });
        return response.data;
      } catch (error) {
        console.error('备用接口获取视频合集失败:', error.message);
      }
      
      return { code: -1, message: '获取视频合集失败' };
    } catch (error) {
      console.error('获取视频合集失败:', error.message);
      return { code: -1, message: error.message };
    }
  }
}

const bilibiliAPI = new BilibiliAPI();

// B 站登录态独立持久化：Electron 20 的 defaultSession 不持久化 cookie，
// 而 session.fromPartition('persist:xxx') 依赖 Chromium 内部 LevelDB
// 懒加载，trae 沙盒下 Partitions/ 目录创建常被拦截。
// 因此我们自己用 JSON 文件保存 .bilibili.com cookie 列表，跨重启保持登录。
const COOKIE_STORE_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'pink-music', 'bilibili-cookies.json');

async function loadCookiesFromFile() {
  try {
    if (fs.existsSync(COOKIE_STORE_PATH)) {
      const raw = fs.readFileSync(COOKIE_STORE_PATH, 'utf-8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        return data;
      }
    }
  } catch (e) {
    console.error('[debug] 读 cookie store 失败:', e);
  }
  return {};
}

async function saveCookiesToFile(cookies) {
  try {
    const dir = path.dirname(COOKIE_STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COOKIE_STORE_PATH, JSON.stringify(cookies, null, 2), 'utf-8');
  } catch (e) {
    console.error('[debug] 写 cookie store 失败:', e);
  }
}

let mainWindow = null;
let bilibiliSession = null;
const downloadTasks = [];

function getMainWindow() {
  return mainWindow || BrowserWindow.getFocusedWindow();
}

function broadcastDownloadProgress(task) {
  const window = getMainWindow();
  if (window && !window.isDestroyed()) {
    window.webContents.send('download-progress', task);
  }
}

function installWebRequestInterceptors(targetSession) {
  const sessionToUse = targetSession || (session && session.defaultSession);
  if (!sessionToUse) {
    console.error('未找到可用的 session，跳过 webRequest 拦截器安装');
    return;
  }
  const urls = ["http://*/*", "https://*/*"];
  const origin = "https://www.bilibili.com";
  const referer = "https://www.bilibili.com";

  const onBeforeSendHeadersHandler = async (details, callback) => {
    const headers = details.requestHeaders || {};

    headers["Referer"] = referer;
    headers["Origin"] = origin;
    headers["User-Agent"] = UserAgent;

    // 从持久化 Electron session 读取 cookies 并添加到请求头
    try {
      const sessionCookies = await sessionToUse.cookies.get({ domain: '.bilibili.com' });
      if (sessionCookies && sessionCookies.length > 0) {
        const cookieString = sessionCookies.map(c => `${c.name}=${c.value}`).join('; ');
        if (cookieString) {
          headers["Cookie"] = cookieString;
        }
      }
    } catch (error) {
      console.error('读取 cookies 失败:', error);
    }

    callback({ requestHeaders: headers });
  };

  const onHeadersReceivedHandler = (details, callback) => {
    const responseHeaders = details.responseHeaders || {};
    const setCookieKey = Object.keys(responseHeaders).find(k => k.toLowerCase() === "set-cookie");

    if (!setCookieKey) {
      callback({ responseHeaders });
      return;
    }

    const raw = responseHeaders[setCookieKey.toLowerCase()];
    const cookies = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];

    const rewritten = cookies.map(cookie => {
      // 简易重写：补齐 SameSite=None; Secure，供跨站嵌入场景
      let result = cookie;
      if (!/;\s*samesite=/i.test(result)) {
        result += '; SameSite=None';
      }
      if (!/;\s*secure/i.test(result)) {
        result += '; Secure';
      }
      return result;
    });

    responseHeaders[setCookieKey] = rewritten;
    callback({ responseHeaders });
  };

  sessionToUse.webRequest.onBeforeSendHeaders({ urls }, onBeforeSendHeadersHandler);
  sessionToUse.webRequest.onHeadersReceived({ urls }, onHeadersReceivedHandler);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      webSecurity: false
    }
  });

  // 隐藏菜单栏
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173/');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  // 直接使用 defaultSession（仅供 webRequest 拦截器使用）；
  // B 站登录态走 JSON 文件持久化（COOKIE_STORE_PATH）。
  bilibiliSession = session.defaultSession;
  // 调试日志
  try {
    const userData = app.getPath('userData');
    console.log('[debug] app.getPath(userData) =', userData);
    console.log('[debug] cookie store path =', COOKIE_STORE_PATH);
    if (fs.existsSync(COOKIE_STORE_PATH)) {
      const stat = fs.statSync(COOKIE_STORE_PATH);
      console.log('[debug] cookie store 文件存在, size =', stat.size, 'mtime =', stat.mtime.toISOString());
    } else {
      console.log('[debug] cookie store 文件不存在（首次启动或未登录）');
    }
  } catch (e) {
    console.error('[debug] 路径打印失败:', e);
  }
  // 启动时从 JSON 恢复 B 站登录 cookie 到 bilibiliAPI.cookies
  try {
    await bilibiliAPI.refreshCookiesFromSession();
  } catch (e) {
    console.error('[debug] 启动时加载 cookie 失败:', e);
  }
  installWebRequestInterceptors(bilibiliSession);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  // 退出前显式刷盘，确保 cookie 立即写入磁盘 store
  const target = bilibiliSession || (session && session.defaultSession);
  if (target && target.cookies && typeof target.cookies.flushStore === 'function') {
    try {
      target.cookies.flushStore();
    } catch (error) {
      console.error('flushStore 失败:', error);
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('search-music', async (event, keyword, page, pageSize) => {
  try {
    const result = await bilibiliAPI.searchMusic(keyword, page, pageSize);
    return result;
  } catch (error) {
    return { code: -1, message: error.message };
  }
});

ipcMain.handle('get-music-comprehensive-web-rank', async (event, pn, ps) => {
  try {
    const result = await bilibiliAPI.getMusicComprehensiveWebRank(pn, ps);
    return result;
  } catch (error) {
    return { code: -1, message: error.message, data: { list: [] } };
  }
});

ipcMain.handle('get-music-region-feed', async (event, displayId, requestCnt) => {
  try {
    const result = await bilibiliAPI.getMusicRegionFeed(displayId, requestCnt);
    return result;
  } catch (error) {
    return { code: -1, message: error.message, data: { archives: [] } };
  }
});

ipcMain.handle('get-music-info', async (event, bvid) => {
  try {
    const result = await bilibiliAPI.getMusicInfo(bvid);
    return result;
  } catch (error) {
    return { code: -1, message: error.message };
  }
});

ipcMain.handle('get-music-play-url', async (event, bvid, cid) => {
  try {
    const result = await bilibiliAPI.getMusicPlayUrl(bvid, cid);
    return result;
  } catch (error) {
    return { code: -1, message: error.message };
  }
});

ipcMain.handle('proxy-audio', async (event, audioUrl) => {
  try {
    console.log('收到音频代理请求:', audioUrl);
    const buffer = await bilibiliAPI.getAudioProxy(audioUrl);
    return { code: 0, data: buffer.toString('base64') };
  } catch (error) {
    console.error('代理音频失败:', error);
    return { code: -1, message: error.message };
  }
});

ipcMain.handle('get-recommendations', async (event) => {
  try {
    const result = await bilibiliAPI.getRecommendations();
    console.log('获取推荐内容结果:', JSON.stringify(result)?.substring(0, 500));
    return result;
  } catch (error) {
    return { code: -1, message: error.message };
  }
});

ipcMain.handle('get-video-episodes', async (event, bvid) => {
  try {
    const result = await bilibiliAPI.getVideoEpisodes(bvid);
    console.log('获取视频分P结果:', JSON.stringify(result)?.substring(0, 500));
    return result;
  } catch (error) {
    return { code: -1, message: error.message };
  }
});

ipcMain.handle('get-video-series', async (event, bvid) => {
  try {
    const result = await bilibiliAPI.getVideoSeries(bvid);
    console.log('获取视频合集结果:', JSON.stringify(result)?.substring(0, 500));
    return result;
  } catch (error) {
    return { code: -1, message: error.message };
  }
});

// ==================== 登录与收藏夹同步 ====================

function extractSetCookies(headers) {
  if (!headers) return [];
  const raw = headers['set-cookie'] || headers['Set-Cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function parseSetCookieString(cookie) {
  if (!cookie) return null;
  const parts = cookie.split(';').map(p => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const first = parts[0];
  const eq = first.indexOf('=');
  if (eq < 0) return null;
  const result = {
    name: first.slice(0, eq).trim(),
    value: first.slice(eq + 1).trim()
  };
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    const idx = seg.indexOf('=');
    if (idx < 0) continue;
    const key = seg.slice(0, idx).trim().toLowerCase();
    const val = seg.slice(idx + 1).trim();
    if (key === 'expires') result.expires = val;
    else if (key === 'max-age') result.maxAge = parseInt(val, 10);
    else if (key === 'path') result.path = val;
    else if (key === 'domain') result.domain = val;
    else if (key === 'httponly') result.httpOnly = true;
    else if (key === 'secure') result.secure = true;
    else if (key === 'samesite') result.sameSite = val;
  }
  return result;
}

async function persistBilibiliCookies(headers) {
  const targetSession = bilibiliSession || (session && session.defaultSession);
  if (!targetSession) return;
  const setCookies = extractSetCookies(headers);
  console.log('[debug] persistBilibiliCookies 收到', setCookies.length, '个 set-cookie');
  for (const cookie of setCookies) {
    const parsed = parseSetCookieString(cookie);
    if (!parsed || !parsed.name) continue;
    try {
      const cookieDetails = {
        url: 'https://bilibili.com/',
        domain: '.bilibili.com',
        path: '/',
        name: parsed.name,
        value: parsed.value,
        secure: true,
        sameSite: 'no_restriction',
        httpOnly: false
      };
      if (parsed.expires) {
        const exp = Date.parse(parsed.expires);
        if (!Number.isNaN(exp)) {
          cookieDetails.expirationDate = Math.floor(exp / 1000);
        }
      }
      // 同步写入 session（供渲染进程 webRequest 拦截器使用）
      await targetSession.cookies.set(cookieDetails);
      // 立即同步写入内存 cookie 字典 + JSON 文件（保证持久化）
      bilibiliAPI.cookies[parsed.name] = parsed.value;
      try { fs.writeFileSync(COOKIE_STORE_PATH, JSON.stringify(bilibiliAPI.cookies, null, 2), 'utf-8'); } catch (e) {}
      console.log('[debug] 写入 cookie:', parsed.name, 'expires:', parsed.expires || 'session');
    } catch (error) {
      console.warn('写入 cookie 失败:', parsed.name, error.message);
    }
  }
  // 落盘确认
  try {
    const stat = fs.statSync(COOKIE_STORE_PATH);
    console.log('[debug] persistBilibiliCookies 后 cookie store file size =', stat.size, 'mtime =', stat.mtime.toISOString());
  } catch (e) {}
  await bilibiliAPI.refreshCookiesFromSession();
}

ipcMain.handle('generate-qrcode', async () => {
  return await bilibiliAPI.generateQrcode();
});

ipcMain.handle('poll-qrcode', async (event, qrcodeKey) => {
  if (!qrcodeKey) return { code: -1, message: '缺少 qrcode_key' };
  const result = await bilibiliAPI.pollQrcode(qrcodeKey);
  if (result.code === 0) {
    const pollData = result.data?.data;
    if (pollData && pollData.code === 0) {
      // 登录成功，将响应头里的 set-cookie 写入 session
      await persistBilibiliCookies(result.headers);
    }
  }
  return result;
});

ipcMain.handle('get-user-info', async () => {
  await bilibiliAPI.refreshCookiesFromSession();
  return bilibiliAPI.getUserNavInfo();
});

ipcMain.handle('get-bilibili-cookies', async () => {
  await bilibiliAPI.refreshCookiesFromSession();
  return { code: 0, data: bilibiliAPI.cookies || {} };
});

ipcMain.handle('get-fav-folder-created-list', async (event, upMid, pn, ps) => {
  return await bilibiliAPI.getFavFolderCreatedList(upMid, pn, ps);
});

ipcMain.handle('get-fav-folder-collected-list', async (event, upMid, pn, ps) => {
  return await bilibiliAPI.getFavFolderCollectedList(upMid, pn, ps);
});

ipcMain.handle('get-fav-resource-list', async (event, mediaId, pn, ps) => {
  return await bilibiliAPI.getFavResourceList(mediaId, pn, ps);
});

ipcMain.handle('get-fav-resource-ids', async (event, mediaId) => {
  return await bilibiliAPI.getFavResourceIds(mediaId);
});

ipcMain.handle('get-fav-resource-infos', async (event, resources) => {
  return await bilibiliAPI.getFavResourceInfos(resources);
});

ipcMain.handle('logout-bilibili', async () => {
  const targetSession = bilibiliSession || (session && session.defaultSession);
  if (!targetSession) return { code: 0 };
  try {
    const cookies = await targetSession.cookies.get({ domain: '.bilibili.com' });
    for (const cookie of cookies) {
      try {
        await targetSession.cookies.remove({
          url: `https://${cookie.domain.replace(/^\./, '')}/`,
          name: cookie.name
        });
      } catch (error) {
        console.warn('删除 cookie 失败:', cookie.name, error.message);
      }
    }
    try { await targetSession.cookies.flushStore(); } catch (e) {}
    bilibiliAPI.cookies = {};
    // 清空 JSON cookie store
    try { fs.writeFileSync(COOKIE_STORE_PATH, JSON.stringify({}, null, 2), 'utf-8'); } catch (e) {}
    return { code: 0 };
  } catch (error) {
    return { code: -1, message: error.message };
  }
});

// 计算缓存大小
ipcMain.handle('get-cache-size', async () => {
  try {
    let totalSize = 0;
    
    // 用户数据目录中的下载文件夹
    const downloadDir = path.join(app.getPath('userData'), 'downloads');
    if (fs.existsSync(downloadDir)) {
      totalSize += await calculateDirectorySize(downloadDir);
    }
    
    // Electron 的缓存目录
    const cacheDir = path.join(app.getPath('userData'), 'Cache');
    if (fs.existsSync(cacheDir)) {
      totalSize += await calculateDirectorySize(cacheDir);
    }
    
    // Session 缓存
    try {
      const cachePath = path.join(app.getPath('userData'), 'Code Cache');
      if (fs.existsSync(cachePath)) {
        totalSize += await calculateDirectorySize(cachePath);
      }
    } catch (e) {
      // 忽略错误
    }
    
    // cacheManager 管理的音频缓存
    try {
      const audioCacheDir = path.join(__dirname, '..', 'cache', 'audio');
      if (fs.existsSync(audioCacheDir)) {
        totalSize += await calculateDirectorySize(audioCacheDir);
      }
    } catch (e) {
      // 忽略错误
    }
    
    // 项目根目录下的 cache 目录
    try {
      const projectCacheDir = path.join(__dirname, '..', 'cache');
      if (fs.existsSync(projectCacheDir)) {
        totalSize += await calculateDirectorySize(projectCacheDir);
      }
    } catch (e) {
      // 忽略错误
    }
    
    return { code: 0, size: totalSize };
  } catch (error) {
    console.error('获取缓存大小失败:', error);
    return { code: -1, message: error.message };
  }
});

// 清空缓存
ipcMain.handle('clear-cache', async () => {
  try {
    // 清空下载目录中的缓存
    const downloadDir = path.join(app.getPath('userData'), 'downloads');
    if (fs.existsSync(downloadDir)) {
      try {
        const files = fs.readdirSync(downloadDir);
        for (const file of files) {
          const filePath = path.join(downloadDir, file);
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        console.log('清空下载目录失败:', e);
      }
    }
    
    // 清空 Electron 的缓存
    try {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearStorageData();
    } catch (e) {
      console.log('清空 session 缓存失败:', e);
    }
    
    // 清空 cacheManager 管理的缓存
    try {
      cacheManager.clearAllCache();
    } catch (e) {
      console.log('清空音频缓存失败:', e);
    }
    
    // 清空项目根目录下的 cache 目录
    try {
      const projectCacheDir = path.join(__dirname, '..', 'cache');
      if (fs.existsSync(projectCacheDir)) {
        fs.rmSync(projectCacheDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.log('清空项目缓存目录失败:', e);
    }
    
    return { code: 0 };
  } catch (error) {
    console.error('清空缓存失败:', error);
    return { code: -1, message: error.message };
  }
});

// 选择下载目录
ipcMain.handle('select-download-directory', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: '选择下载目录'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { code: 0, path: result.filePaths[0] };
    }
    return { code: 1, message: '未选择目录' };
  } catch (error) {
    console.error('选择目录失败:', error);
    return { code: -1, message: error.message };
  }
});

/**
 * 通用确认弹窗（解决 window.confirm 在 Electron 默认配置下被屏蔽的问题）
 * 入参：{ type, title, message, detail, buttons, defaultId, cancelId }
 * 返回：{ response: number } 用户点的是哪个按钮的下标
 */
ipcMain.handle('dialog-message-box', async (event, options) => {
  try {
    const opts = {
      type: options.type || 'question',
      title: options.title || '提示',
      message: options.message || '',
      detail: options.detail || '',
      buttons: options.buttons || ['确定', '取消'],
      defaultId: options.defaultId ?? 0,
      cancelId: options.cancelId ?? 1,
      noLink: true
    };
    const result = await dialog.showMessageBox(mainWindow, opts);
    return { response: result.response };
  } catch (error) {
    console.error('弹窗失败:', error);
    // 主进程弹窗失败时回退 false，避免误删
    return { response: 1 };
  }
});

// 获取当前下载目录
ipcMain.handle('get-download-directory', async () => {
  try {
    let downloadDir = path.join(app.getPath('userData'), 'downloads');
    
    // 尝试从本地存储读取保存的目录
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.downloadDir) {
        downloadDir = settings.downloadDir;
      }
    }
    
    // 确保目录存在
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }
    
    return { code: 0, path: downloadDir };
  } catch (error) {
    console.error('获取下载目录失败:', error);
    return { code: -1, message: error.message };
  }
});

// 保存下载目录
ipcMain.handle('set-download-directory', async (event, dirPath) => {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    let settings = {};
    
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
    
    settings.downloadDir = dirPath;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    
    // 确保目录存在
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    return { code: 0 };
  } catch (error) {
    console.error('保存下载目录失败:', error);
    return { code: -1, message: error.message };
  }
});

// 获取下载目录
function getDownloadDirectory() {
  let downloadDir = path.join(app.getPath('userData'), 'downloads');
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (settings.downloadDir) {
      downloadDir = settings.downloadDir;
    }
  }
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }
  return downloadDir;
}

// 下载任务管理
ipcMain.handle('download-audio', async (event, taskInfo) => {
  try {
    const { audioUrl, fileName, bvid, cid, title, author, quality, audioCodecs, id: providedId } = taskInfo || {};
    if (!audioUrl || !fileName) {
      return { code: -1, message: '缺少下载参数' };
    }

    // 优先使用渲染层传过来的 id，保证主进程 task 与前端 store 的 waitingTask
    // 是同一条；前端 progress 回调就能用 id 匹配到，避免重复新增任务
    const id = providedId || `dl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const safeFileName = fileName.replace(/[<>"/\\|?*]/g, '').substring(0, 100);
    const downloadDir = getDownloadDirectory();

    // B 站 DASH 音频流（dash.audio / dash.flac / dash.dolby）返回的字节流
    // 本质都是 fragmented MP4（ftypisom 开头），无论内部 codec 是 AAC / FLAC / EC-3，
    // 都不能直接写成 .flac / .mp3，否则播放器会因魔数不匹配而拒绝。
    // 统一用 .m4a 保存，原始编码通过 ftyp/mdat box 完整保留，绝大多数现代播放器
    // （macOS AVFoundation、VLC、ffmpeg-based、QuickTime）都能正常解码。
    // 如需真正的原生 .flac 容器，可安装 ffmpeg 后自行 `ffmpeg -i song.m4a -c:a copy song.flac`。
    const codecsLower = String(audioCodecs || '').toLowerCase();
    let ext = '.m4a';
    if (codecsLower.includes('mp3')) ext = '.mp3';

    const filePath = path.join(downloadDir, `${safeFileName}${ext}`);

    const task = {
      id,
      title: title || fileName,
      author: author || '',
      bvid: bvid || '',
      cid: cid || '',
      quality: quality || 'auto',
      audioCodecs: audioCodecs || '',
      fileName: `${safeFileName}${ext}`,
      filePath,
      status: 'downloading',
      progress: 0,
      totalBytes: 0,
      downloadedBytes: 0,
      createdTime: Date.now(),
      error: ''
    };

    // 已存在同 id 任务时，先移除再插入到队首，避免重复
    const existingIdx = downloadTasks.findIndex(t => t.id === id);
    if (existingIdx > -1) {
      downloadTasks.splice(existingIdx, 1);
    }
    downloadTasks.unshift(task);
    broadcastDownloadProgress(task);
    console.log('开始下载任务:', task.id, fileName);

    const response = await bilibiliAPI.axios({
      method: 'get',
      url: audioUrl,
      responseType: 'arraybuffer',
      headers: {
        'Referer': 'https://www.bilibili.com',
        'User-Agent': UserAgent
      },
      timeout: 120000,
      onDownloadProgress: (progressEvent) => {
        if (progressEvent.total) {
          task.totalBytes = progressEvent.total;
          task.downloadedBytes = progressEvent.loaded;
          task.progress = Math.round((progressEvent.loaded / progressEvent.total) * 100);
          broadcastDownloadProgress(task);
        }
      }
    });

    const buffer = Buffer.from(response.data);

    // 扩展名已在任务创建时基于 audioCodecs 决定（flac/m4a/mp3），
    // 此处直接使用 task.fileName / filePath 写入即可
    const actualFilePath = task.filePath;
    const actualFileName = task.fileName;

    await fs.promises.writeFile(actualFilePath, buffer);

    task.status = 'completed';
    task.progress = 100;
    task.totalBytes = task.totalBytes || buffer.length;
    task.downloadedBytes = buffer.length;
    broadcastDownloadProgress(task);
    console.log('音频下载完成:', filePath);

    return { code: 0, data: { filePath, taskId: id } };
  } catch (error) {
    console.error('下载音频失败:', error);
    // 错误时仅把当前调用方传进来的 id 标记为失败，避免误改其它正在下载的任务
    const { id: failedId } = taskInfo || {};
    const failedTask = failedId
      ? downloadTasks.find(t => t.id === failedId)
      : downloadTasks.find(t => t.status === 'downloading');
    if (failedTask) {
      failedTask.status = 'error';
      failedTask.error = error.message;
      failedTask.progress = 0;
      broadcastDownloadProgress(failedTask);
    }
    return { code: -1, message: error.message };
  }
});

ipcMain.handle('get-download-tasks', async () => {
  return { code: 0, data: downloadTasks };
});

ipcMain.handle('clear-download-tasks', async () => {
  downloadTasks.length = 0;
  return { code: 0 };
});

// 更新打开下载目录函数
ipcMain.handle('open-download-folder', async () => {
  try {
    let downloadDir = path.join(app.getPath('userData'), 'downloads');
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.downloadDir) {
        downloadDir = settings.downloadDir;
      }
    }
    
    // 确保下载目录存在
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }
    
    await shell.openPath(downloadDir);
    return { code: 0, message: '成功打开下载目录' };
  } catch (error) {
    console.error('打开下载目录失败:', error);
    return { code: -1, message: error.message };
  }
});

// 打开 GitHub 链接
ipcMain.handle('open-github', async () => {
  try {
    await shell.openExternal('https://github.com/Rayson-Liu/pink-music-app');
    return { code: 0 };
  } catch (error) {
    console.error('打开 GitHub 失败:', error);
    return { code: -1, message: error.message };
  }
});

// 窗口控制
ipcMain.handle('minimize-window', () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    window.minimize();
  }
  return { code: 0 };
});

ipcMain.handle('maximize-window', () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  }
  return { code: 0 };
});

ipcMain.handle('close-window', () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    window.close();
  }
  return { code: 0 };
});

ipcMain.handle('is-window-maximized', () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    return { code: 0, isMaximized: window.isMaximized() };
  }
  return { code: 0, isMaximized: false };
});

ipcMain.handle('get-platform', () => {
  return process.platform;
});

// 辅助函数: 计算目录大小
async function calculateDirectorySize(dirPath) {
  let totalSize = 0;
  
  async function scanDirectory(currentPath) {
    const files = fs.readdirSync(currentPath);
    for (const file of files) {
      const filePath = path.join(currentPath, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        await scanDirectory(filePath);
      } else {
        totalSize += stats.size;
      }
    }
  }
  
  try {
    await scanDirectory(dirPath);
  } catch (e) {
    console.error('扫描目录失败:', e);
  }
  
  return totalSize;
}

// ==================== 歌词功能 ====================

const NETEASE_BASE_URL = 'https://music.163.com';

function createNeteaseSignature(params) {
  const modulus = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
  const publicKey = '010001';
  const secret = '0CoJUm6Qyw8W8jud';

  function aesEncrypt(text, key) {
    const iv = '0102030405060708';
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  }

  function rsaEncrypt(text) {
    const buffer = Buffer.from(text, 'utf8');
    const encrypted = crypto.publicEncrypt({
      key: `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    }, buffer);
    return encrypted.toString('base64');
  }

  const jsonText = JSON.stringify(params);
  const randomKey = crypto.randomBytes(16).toString('hex');
  
  const encryptedParams = aesEncrypt(aesEncrypt(jsonText, secret), randomKey);
  const encSecKey = rsaEncrypt(randomKey.split('').reverse().join(''));

  return { params: encryptedParams, encSecKey };
}

// 使用网易云直接搜索API
async function searchNeteaseMusic(keyword) {
  try {
    console.log('使用网易云直接搜索API:', keyword);
    
    const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(keyword)}&type=1&offset=0&limit=10`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'Referer': 'https://music.163.com/',
        'Accept': 'application/json, text/plain, */*',
      },
      timeout: 10000,
    });

    console.log('搜索API状态码:', response.status);
    console.log('搜索结果code:', response.data?.code);

    if (response.data?.code === 200 && response.data?.result?.songs) {
      const songs = response.data.result.songs;
      console.log('找到歌曲数量:', songs.length);
      return songs.map((song) => ({
        id: song.id,
        name: song.name,
        artist: song.artists?.[0]?.name || song.ar?.[0]?.name || '',
        album: song.album?.name || song.al?.name || '',
        // 网易云返回的 duration 单位是毫秒
        duration: typeof song.duration === 'number' ? song.duration : 0
      }));
    }
    return [];
  } catch (error) {
    console.error('搜索网易云音乐失败:', error.message);
    return [];
  }
}

// 使用简单的未加密API获取歌词
async function getNeteaseLyric(songId) {
  try {
    console.log('使用简单API获取歌词, songId:', songId);
    
    const url = `https://music.163.com/api/song/lyric?id=${songId}&lv=-1&kv=-1&tv=-1`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'Referer': 'https://music.163.com/',
      },
    });

    console.log('API响应:', response.data);

    if (response.data.code === 200 || response.status === 200) {
      const lrc = response.data.lrc?.lyric || '';
      const tlyric = response.data.tlyric?.lyric || '';
      
      let lyric = lrc;
      if (tlyric) {
        const lrcLines = lrc.split('\n');
        const tlyricMap = {};
        tlyric.split('\n').forEach(line => {
          const match = line.match(/\[(\d{2}:\d{2}\.\d{2,3})\](.+)/);
          if (match) {
            tlyricMap[match[1]] = match[2];
          }
        });
        
        lyric = lrcLines.map(line => {
          const match = line.match(/\[(\d{2}:\d{2}\.\d{2,3})\](.+)/);
          if (match && tlyricMap[match[1]]) {
            return `${line}${tlyricMap[match[1]]}`;
          }
          return line;
        }).join('\n');
      }

      return {
        lyric,
        title: '',
        artist: '',
      };
    }
    return null;
  } catch (error) {
    console.error('获取网易云歌词失败:', error);
    return null;
  }
}

// IPC: 获取歌词（通过网易云API）
ipcMain.handle('get-lyric', async (event, { bvid, cid, title, artist }) => {
  try {
    console.log('获取歌词:', { bvid, cid, title, artist });
    
    const keywords = [];
    if (title && artist) {
      keywords.push(`${title} ${artist}`);
    }
    if (title) {
      keywords.push(title);
    }

    let allResults = [];
    for (const keyword of keywords) {
      console.log('搜索关键词:', keyword);
      const results = await searchNeteaseMusic(keyword);
      if (results.length > 0) {
        allResults = results;
        break;
      }
    }

    console.log('搜索结果数量:', allResults.length);

    if (allResults.length > 0) {
      let matchedSong = null;

      if (artist) {
        const artistMain = artist.split(/[、,，&/\\\s]+/)[0].trim();
        matchedSong = allResults.find(song =>
          song.artist.toLowerCase().includes(artistMain.toLowerCase()) ||
          song.name.toLowerCase() === title.toLowerCase()
        );
      }

      if (!matchedSong) {
        matchedSong = allResults[0];
      }

      console.log('匹配到的歌曲:', matchedSong);
      const lyricData = await getNeteaseLyric(matchedSong.id);

      if (lyricData && lyricData.lyric) {
        console.log('获取到歌词，长度:', lyricData.lyric.length);
        return {
          code: 0,
          data: lyricData.lyric,
          source: 'netease'
        };
      } else {
        console.log('该歌曲没有歌词');
      }
    } else {
      console.log('网易云未找到匹配歌曲');
    }

    return {
      code: -1,
      message: '未找到歌词'
    };
  } catch (error) {
    console.error('获取歌词失败:', error);
    return {
      code: -1,
      message: error.message
    };
  }
});

// IPC: 搜索歌词
ipcMain.handle('search-lyric', async (event, keyword) => {
  try {
    console.log('搜索歌词:', keyword);
    const results = await searchNeteaseMusic(keyword);
    console.log('歌词搜索结果数量:', results.length);
    if (results.length > 0) {
      console.log('第一个结果:', results[0]);
    }
    return {
      code: 0,
      data: results
    };
  } catch (error) {
    console.error('搜索歌词失败:', error);
    return {
      code: -1,
      message: error.message
    };
  }
});

// IPC: 通过歌曲ID获取歌词
ipcMain.handle('get-lyric-by-id', async (event, songId) => {
  try {
    console.log('通过歌曲ID获取歌词:', songId);
    const lyricData = await getNeteaseLyric(songId);
    
    if (lyricData) {
      return {
        code: 0,
        data: lyricData.lyric
      };
    }
    
    return {
      code: -1,
      message: '未找到歌词'
    };
  } catch (error) {
    console.error('获取歌词失败:', error);
    return {
      code: -1,
      message: error.message
    };
  }
});
