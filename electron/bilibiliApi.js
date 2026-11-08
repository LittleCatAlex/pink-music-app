/**
 * Bilibili API 服务与签名模块
 * 封装 B 站风控 WBI 签名、Cookie 维护、二维码登录及各业务接口。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { app, session } = require('electron');

const isDevLog = !app.isPackaged || process.env.NODE_ENV === 'development';
function dlog(...args) {
  if (isDevLog) console.log(...args);
}

const BILIBILI_BASE = 'https://api.bilibili.com';
const BILIBILI_WEB = 'https://passport.bilibili.com';

const UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const COOKIE_STORE_PATH = path.join(app.getPath('userData'), 'bilibili-cookies.json');

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

// B 站风控 wbi 签名：/x/v3/fav/* 等接口必须带 wts + w_rid。
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

let customSessionGetter = null;

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
        if (config.url && (config.url.includes('/x/v3/fav/') || config.url.includes('/wbi/'))) {
          config.params = config.params || {};
          config.params = wbiSignParams(config.params, wbiKeysCache.imgKey, wbiKeysCache.subKey);
        }
      } catch (e) { /* ignore */ }
      return config;
    });
  }

  async ensureWbiKeys() {
    if (wbiKeysCache.imgKey && wbiKeysCache.subKey && (Date.now() - wbiKeysCache.updatedAt < 3600000)) {
      return;
    }
    try {
      await this.getUserNavInfo();
    } catch (e) {
      dlog('[ensureWbiKeys] 获取 wbi keys 失败:', e.message);
    }
  }

  async refreshCookiesFromSession() {
    let fileCookies = {};
    try {
      if (fs.existsSync(COOKIE_STORE_PATH)) {
        const raw = fs.readFileSync(COOKIE_STORE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') fileCookies = parsed;
      }
    } catch (e) { /* ignore */ }

    let sessionCookies = {};
    const target = (customSessionGetter && customSessionGetter()) || (session && session.defaultSession);
    if (target && target.cookies) {
      try {
        const list = await target.cookies.get({ domain: '.bilibili.com' });
        list.forEach(c => { sessionCookies[c.name] = c.value; });
      } catch (error) {
        console.error('[debug] 从 session 读 cookies 失败:', error);
      }
    }

    this.cookies = { ...fileCookies, ...sessionCookies };
    try { fs.writeFileSync(COOKIE_STORE_PATH, JSON.stringify(this.cookies, null, 2), 'utf-8'); } catch (e) {}
    console.log('[debug] refreshCookiesFromSession merged =', Object.keys(this.cookies).join(','));
  }

  async request(url, options = {}) {
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

  async getMusicRegionFeed(displayId = 1, requestCnt = 15) {
    try {
      console.log('[debug] getMusicRegionFeed: page=', displayId, 'cnt=', requestCnt);
      const data = await this.request(`${BILIBILI_BASE}/x/web-interface/region/feed/rcmd`, {
        params: {
          display_id: displayId,
          request_cnt: requestCnt,
          from_region: 1003,
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
      dlog('获取音乐信息:', bvid);
      const data = await this.request(`${BILIBILI_BASE}/x/web-interface/view`, {
        params: { bvid }
      });
      dlog('音乐信息 code:', data?.code, 'bvid:', bvid);
      return data;
    } catch (error) {
      console.error('获取音乐信息失败:', error);
      return { code: -1, message: error.message };
    }
  }

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
      dlog('获取播放地址:', bvid, cid);
      const data = await this.request(`${BILIBILI_BASE}/x/player/playurl`, {
        params: {
          bvid,
          cid,
          qn: 0,
          fnval: 4048,
          fnver: 0,
          fourk: 1
        }
      });
      dlog('播放地址 code:', data?.code, 'bvid:', bvid, 'cid:', cid);
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

  async getVideoSubtitles(bvid, cid) {
    try {
      await this.refreshCookiesFromSession();
      await this.ensureWbiKeys();
      dlog('获取视频字幕:', bvid, cid);
      let targetCid = cid;
      if ((!targetCid || Number(targetCid) <= 1) && bvid) {
        const episodes = await this.getVideoEpisodes(bvid);
        if (episodes?.code === 0 && Array.isArray(episodes.data) && episodes.data.length > 0) {
          targetCid = episodes.data[0].cid;
        }
      }
      if (!targetCid) return { code: -1, message: '缺少 cid' };

      let needLogin = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const data = await this.request(`${BILIBILI_BASE}/x/player/wbi/v2`, {
            params: { bvid, cid: targetCid },
            timeout: 15000
          });
          if (data?.data?.need_login_subtitle) {
            needLogin = true;
          }
          const subtitles = data?.data?.subtitle?.subtitles;
          if (Array.isArray(subtitles) && subtitles.length > 0) {
            return { code: 0, data: { subtitles, needLogin } };
          }
        } catch (e) {
          dlog('[getVideoSubtitles] wbi/v2 尝试失败:', e.message);
        }
        if (needLogin) break;
        if (attempt === 0) await new Promise(r => setTimeout(r, 400));
      }

      try {
        const dataV2 = await this.request(`${BILIBILI_BASE}/x/player/v2`, {
          params: { bvid, cid: targetCid },
          timeout: 15000
        });
        if (dataV2?.data?.need_login_subtitle) {
          needLogin = true;
        }
        const subtitlesV2 = dataV2?.data?.subtitle?.subtitles;
        if (Array.isArray(subtitlesV2) && subtitlesV2.length > 0) {
          return { code: 0, data: { subtitles: subtitlesV2, needLogin } };
        }
      } catch (e) {
        dlog('[getVideoSubtitles] player/v2 尝试失败:', e.message);
      }

      try {
        const viewData = await this.request(`${BILIBILI_BASE}/x/web-interface/view`, {
          params: { bvid },
          timeout: 15000
        });
        const viewSubs = viewData?.data?.subtitle?.list || viewData?.data?.subtitle?.subtitles;
        if (Array.isArray(viewSubs) && viewSubs.length > 0) {
          return { code: 0, data: { subtitles: viewSubs, needLogin } };
        }
      } catch (e) {
        dlog('[getVideoSubtitles] view 尝试失败:', e.message);
      }

      return { code: 0, data: { subtitles: [], needLogin } };
    } catch (error) {
      console.error('获取视频字幕失败:', error.message);
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
      const response = await this.axios.get(`${BILIBILI_BASE}/x/web-interface/nav`);
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
      const safePs = Math.max(1, Math.min(20, Number(ps) || 20));
      const safePn = Math.max(1, Number(pn) || 1);
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

function setSessionGetter(getter) {
  customSessionGetter = getter;
}

module.exports = {
  BILIBILI_BASE,
  BILIBILI_WEB,
  UserAgent,
  COOKIE_STORE_PATH,
  BilibiliAPI,
  bilibiliAPI,
  loadCookiesFromFile,
  setSessionGetter,
  wbiSignParams,
  getMixinKey,
  extractWbiKeys
};
