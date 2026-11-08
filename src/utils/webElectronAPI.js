// 通用噪声词与无实质意义停用词（避免仅因 feat、official、is 等助词误匹配无关歌曲）
const GENERIC_STOP_WORDS = new Set([
  'feat', 'ft', 'feat.', 'ft.', 'featuring',
  'official', 'mv', 'pv', 'video', 'music', 'audio', 'sound', 'ost', 'op', 'ed',
  'remix', 'live', 'cover', 'ver', 'version', 'mix', 'edit', 'instrumental',
  '伴奏', '纯音乐', '官方', '公式', '完整版', '现场', '翻唱', '原版', '自制', '首发',
  'the', 'a', 'an', 'is', 'in', 'on', 'of', 'to', 'for', 'and', 'with', 'by', 'this', 'that', 'then'
]);

function normalizeForComparison(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[【】\[\]（）()《》<>「」『』·♪♫｜|~～"'`“”‘’_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCoreTitle(title) {
  let s = String(title || '')
    .replace(/【[^】]*】/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:feat|ft|cover|live|remix|official|mv)[^)]*\)/gi, ' ')
    .replace(/(?:feat|ft)\.?\s*[^\s/|｜]+(?:\s+[^\s/|｜]+)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeForComparison(s);
}

function extractMeaningfulTokens(str) {
  const norm = normalizeForComparison(str);
  if (!norm) return [];
  const tokens = [];
  const words = norm.split(/\s+/);
  for (const w of words) {
    if (!w) continue;
    if (GENERIC_STOP_WORDS.has(w)) continue;
    if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(w)) {
      tokens.push(w);
    } else if (w.length >= 2) {
      tokens.push(w);
    }
  }
  return tokens;
}

function extractTargetArtists(title, artist) {
  const artists = new Set();
  const rawArtist = String(artist || '').trim();
  if (rawArtist) {
    const normA = normalizeForComparison(rawArtist);
    if (normA && normA !== 'unknown') artists.add(normA);
  }

  const rawTitle = String(title || '');
  const featMatches = rawTitle.matchAll(/(?:feat|ft|cv|vocal|vo)\.?\s*[:：]?\s*([^/|｜()（）\[\]【】\s]+(?:\s*[,、&]\s*[^/|｜()（）\[\]【】\s]+)*)/gi);
  for (const m of featMatches) {
    if (m[1]) {
      const parts = m[1].split(/[,、&/|｜]/);
      for (const p of parts) {
        const norm = normalizeForComparison(p);
        if (norm && norm.length >= 2) artists.add(norm);
      }
    }
  }

  const knownSingers = [
    '初音ミク', '初音未来', 'miku',
    '重音テト', '重音teto', 'teto',
    '足立レイ', 'adachi rei',
    '洛天依', '言和', '乐正绫', '乐正龙牙', '徵羽摩柯', '墨清弦',
    '花隈千冬', '可不', '星界', '裏命', '狐子',
    '镜音双子', '镜音铃', '镜音连', '巡音流歌', '神威乐步', 'kaito', 'meiko'
  ];
  const normTitle = normalizeForComparison(rawTitle);
  for (const ks of knownSingers) {
    const normKs = normalizeForComparison(ks);
    if (normTitle.includes(normKs)) {
      artists.add(normKs);
    }
  }

  return [...artists];
}

function isArtistMatch(candidateArtist, targetArtists) {
  if (!candidateArtist || !targetArtists || targetArtists.length === 0) return false;
  const normCand = normalizeForComparison(candidateArtist);
  if (!normCand) return false;

  for (const ta of targetArtists) {
    if (!ta) continue;
    if (normCand === ta) return true;
    if (normCand.includes(ta) || ta.includes(normCand)) return true;

    if ((ta.includes('初音') || ta.includes('miku')) && (normCand.includes('初音') || normCand.includes('miku'))) return true;
    if ((ta.includes('テト') || ta.includes('teto')) && (normCand.includes('テト') || normCand.includes('teto'))) return true;
    if ((ta.includes('足立') || ta.includes('adachi')) && (normCand.includes('足立') || normCand.includes('adachi'))) return true;
    if (ta.includes('洛天依') && normCand.includes('洛天依')) return true;
  }
  return false;
}

// 严格校验候选歌曲是否真正匹配目标歌曲
function isStrictMatch(candidate, cleanTitle, cleanArtist, bookTitle = '', targetTitle = '') {
  if (!candidate || !candidate.name) return false;

  const effectiveTitle = bookTitle || cleanTitle;
  const normTarget = normalizeForComparison(effectiveTitle);
  const normCandidate = normalizeForComparison(candidate.name);

  if (!normTarget || !normCandidate) return false;

  const targetArtists = extractTargetArtists(targetTitle || effectiveTitle, cleanArtist);
  const candArtist = candidate.artist || '';
  const artistMatched = isArtistMatch(candArtist, targetArtists);

  let titleMatched = false;

  // 1. 完全相同
  if (normCandidate === normTarget) {
    titleMatched = true;
  }

  // 2. 核心歌名完全相同（去除 feat、噪声括号等）
  const coreTarget = extractCoreTitle(effectiveTitle);
  const coreCandidate = extractCoreTitle(candidate.name);
  if (!titleMatched && coreTarget && coreCandidate && coreTarget === coreCandidate) {
    titleMatched = true;
  }

  // 3. 高覆盖率的子串包含关系（如 "晴天" 与 "晴天 (Live)"）
  if (!titleMatched && (normTarget.includes(normCandidate) || normCandidate.includes(normTarget))) {
    const shorter = normTarget.length <= normCandidate.length ? normTarget : normCandidate;
    const longer = normTarget.length > normCandidate.length ? normTarget : normCandidate;
    const coverage = shorter.length / longer.length;
    if (coverage >= 0.7) {
      titleMatched = true;
    } else {
      const remainder = longer.replace(shorter, '').trim();
      if (extractMeaningfulTokens(remainder).length === 0) {
        titleMatched = true;
      }
    }
  }

  if (!titleMatched && coreTarget && coreCandidate && (coreTarget.includes(coreCandidate) || coreCandidate.includes(coreTarget))) {
    const shorter = coreTarget.length <= coreCandidate.length ? coreTarget : coreCandidate;
    const longer = coreTarget.length > coreCandidate.length ? coreTarget : coreCandidate;
    if (shorter.length / longer.length >= 0.7) {
      titleMatched = true;
    } else {
      const remainder = longer.replace(shorter, '').trim();
      if (extractMeaningfulTokens(remainder).length === 0) {
        titleMatched = true;
      }
    }
  }

  // 4. 有效核心词/词组匹配（需覆盖 80% 以上有意义词，杜绝依靠 feat / 噪声词误匹配）
  if (!titleMatched) {
    const targetTokens = extractMeaningfulTokens(coreTarget || normTarget);
    const candidateTokens = extractMeaningfulTokens(coreCandidate || normCandidate);
    if (targetTokens.length > 0 && candidateTokens.length > 0) {
      const matchedCount = targetTokens.filter(t => {
        return candidateTokens.some(ct => ct === t || (t.length >= 3 && (ct.includes(t) || t.includes(ct))));
      }).length;
      const ratio = matchedCount / targetTokens.length;
      if (ratio >= 0.8 && matchedCount >= 1 && candidateTokens.length <= targetTokens.length * 1.5) {
        titleMatched = true;
      }
    }
  }

  if (!titleMatched) return false;

  // 5. 歌手严格校验：
  // 若目标存在已知歌手（例如上传者或 feat 歌手）：
  if (targetArtists.length > 0) {
    if (artistMatched) return true;
    // 候选歌名是否直接包含目标歌手
    const normCandName = normalizeForComparison(candidate.name);
    if (targetArtists.some(ta => normCandName.includes(ta))) return true;

    // 若歌手完全不匹配：
    // 如果歌名较短（<= 12 字符）或仅由单个/通用单词组成，杜绝跨歌手误匹配！
    const isShortOrGeneric = (coreTarget || normTarget).length <= 12 || !(coreTarget || normTarget).includes(' ');
    if (isShortOrGeneric) {
      return false;
    }
    // 若候选者有明确歌手且与目标歌手完全冲突，即使长歌名也拒绝
    if (candArtist && candArtist.trim().length > 0) {
      return false;
    }
  }

  return true;
}

// 清洗搜索关键词：去掉 B 站标题常见的装饰符号，降低歌词源误匹配概率
function cleanTitleAndExtract(title, artist) {
  let raw = String(title || '').replace(/<[^>]+>/g, '').trim();
  const rawArtist = String(artist || '').replace(/<[^>]+>/g, '').trim();

  // 1. 提取《...》中的书名号（最可靠的歌名标识）
  const bookMatch = raw.match(/《([^》]+)》/);
  const bookTitle = bookMatch ? bookMatch[1].trim() : '';

  // 2. 常见噪声标签与说明过滤（包含中文、日文及英文常见投稿标签）
  const noiseTagRegex = /【(?:4K|1080P|720P|60帧|60FPS|超清|修复|高清|无损|纯享|高音质|官方|公式|Official|MV|PV|现场|完整版|精选|合集|单曲循环|Remix|动态歌词|自制|首发|伴奏|Live|LIVE|本家投稿|オリジナル|Original|VOCALOID|UTAU|CeVIO|SynthV)[^】]*】/gi;
  const noiseParenRegex = /\((?:4K|1080P|720P|60帧|60FPS|超清|修复|高清|无损|纯享|高音质|官方|公式|Official|MV|PV|现场|完整版|单曲纯享|动态歌词|Live|LIVE|cover|Cover|翻唱|高码率)[^)]*\)/gi;
  const noiseSquareRegex = /\[(?:4K|1080P|720P|60帧|60FPS|超清|修复|高清|无损|纯享|Live|MV|PV|Official|公式)[^\]]*\]/gi;
  const noiseWordsRegex = /(?:4K|1080P|60帧|60FPS|超清|修复|高清|无损|纯享|高音质|官方|公式|Official|OFFICIAL|MV|PV|现场版?|完整版|单曲循环|Remix|动态歌词|自制|首发|伴奏|Live|LIVE|本家投稿|オリジナル|Original|音质|高码率)/gi;

  let cleaned = raw
    .replace(noiseTagRegex, ' ')
    .replace(noiseParenRegex, ' ')
    .replace(noiseSquareRegex, ' ')
    .replace(/[【】\[\]（）()《》<>「」『』·♪♫｜|~～]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const queries = [];

  // 若存在书名号（优先搜索 书名号+歌手、书名号）
  if (bookTitle) {
    if (rawArtist) {
      queries.push(bookTitle + ' ' + rawArtist);
    }
    queries.push(bookTitle);
  }

  const coreTitle = extractCoreTitle(cleaned.replace(noiseWordsRegex, ' '));
  const cleanWithoutNoise = cleaned.replace(noiseWordsRegex, ' ').replace(/\s+/g, ' ').trim();

  // 优先带歌手的精准组合关键词
  if (rawArtist && coreTitle && !queries.includes(coreTitle + ' ' + rawArtist)) {
    queries.push(coreTitle + ' ' + rawArtist);
  }

  // 原始标题去噪版（带原版完整歌手或feat）
  if (cleanWithoutNoise && cleanWithoutNoise.length >= 2 && !queries.includes(cleanWithoutNoise)) {
    queries.push(cleanWithoutNoise);
  }

  // 若包含 " - " 或 " / " 分隔
  const dashMatch = raw.replace(noiseTagRegex, '').replace(noiseParenRegex, '').match(/([^-–—/|｜]+)\s*[-–—/|｜]\s*([^-–—/|｜]+)/);
  if (dashMatch) {
    const p1 = extractCoreTitle(dashMatch[1].replace(/[【】\[\]()（）《》]/g, ' ').replace(noiseWordsRegex, ' '));
    const p2 = extractCoreTitle(dashMatch[2].replace(/[【】\[\]()（）《》]/g, ' ').replace(noiseWordsRegex, ' '));
    if (p1 && p1.length >= 2 && !queries.includes(p1)) queries.push(p1);
    if (p2 && p2.length >= 2 && !queries.includes(p2)) queries.push(p2);
  }

  // 纯核心歌名作为最后宽泛备选
  if (coreTitle && coreTitle.length >= 2 && !queries.includes(coreTitle)) {
    queries.push(coreTitle);
  }

  return {
    bookTitle,
    cleanTitle: coreTitle || cleanWithoutNoise || cleaned,
    cleanArtist: rawArtist,
    queries: [...new Set(queries.filter(q => q && q.length >= 2))]
  };
}

// 按歌名/歌手构造搜索关键词序列（多源共用）
function buildLyricKeywords(title, artist) {
  const { bookTitle, cleanTitle, cleanArtist, queries } = cleanTitleAndExtract(title, artist);
  return { keywords: queries, cleanTitle, cleanArtist, bookTitle };
}

// 从搜索结果里挑最佳匹配（严格校验，杜绝误匹配无关歌曲）
function pickBestMatch(allResults, cleanTitle, cleanArtist, bookTitle = '', rawTitle = '') {
  if (!allResults || !allResults.length) return null;
  return allResults.find(s => isStrictMatch(s, cleanTitle, cleanArtist, bookTitle, rawTitle)) || null;
}

function matchSong(results, cleanTitle, bookTitle, query, cleanArtist = "", rawTitle = "") {
  return pickBestMatch(results, cleanTitle, cleanArtist, bookTitle, rawTitle);
}

/**
 * Web 环境下的 electronAPI 适配器
 * 当在普通浏览器（localhost）运行而没有 Electron preload 注入时生效。
 * 通过 Vite 开发服务器的 /api、/passport、/netease-api 和 /proxy-audio 反向代理与 B 站及歌词服务通信。
 */

function getStoredCookies() {
  const keys = [
    'pink-music-login',
    'bilibili-login-cookie',
    'bilibili_cookies',
    'app-data-login'
  ];
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const target = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
          if (target && (target.SESSDATA || target.bili_jct || target.DedeUserID)) {
            return target;
          }
        }
      }
    } catch (_) {}
  }
  // 回退解析 document.cookie
  if (typeof document !== 'undefined' && document.cookie) {
    const fromDoc = {};
    document.cookie.split(';').forEach(pair => {
      const [k, ...v] = pair.trim().split('=');
      if (k) fromDoc[k] = v.join('=');
    });
    if (fromDoc.bili_jct || fromDoc.DedeUserID || fromDoc.SESSDATA) {
      return fromDoc;
    }
  }
  return {};
}

function saveStoredCookies(cookies) {
  if (!cookies || typeof cookies !== 'object') return;
  const current = getStoredCookies();
  const merged = { ...current, ...cookies };
  try {
    localStorage.setItem('pink-music-login', JSON.stringify(merged));
    localStorage.setItem('bilibili_cookies', JSON.stringify(merged));
    localStorage.setItem('bilibili-login-cookie', JSON.stringify(merged));
    localStorage.setItem('app-data-login', JSON.stringify(merged));
  } catch (e) {
    console.warn('[webElectronAPI] 保存 cookie 失败:', e);
  }
}

function clearStoredCookies() {
  try {
    localStorage.removeItem('pink-music-login');
    localStorage.removeItem('bilibili_cookies');
    localStorage.removeItem('bilibili-login-cookie');
    localStorage.removeItem('app-data-login');
  } catch (_) {}
}

function getCookieHeader() {
  const cookies = getStoredCookies();
  return Object.entries(cookies)
    .filter(([_, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function parseCookiesFromUrl(targetUrl) {
  if (!targetUrl) return {};
  try {
    const u = new URL(targetUrl);
    const cookies = {};
    for (const [key, val] of u.searchParams.entries()) {
      if (['DedeUserID', 'DedeUserID__ckMd5', 'SESSDATA', 'bili_jct'].includes(key)) {
        cookies[key] = val;
      }
    }
    return cookies;
  } catch (e) {
    return {};
  }
}

function proxyAudioUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('/proxy-audio') || url.startsWith('blob:') || url.startsWith('data:')) {
    return url;
  }
  return `/proxy-audio?url=${encodeURIComponent(url)}`;
}

function transformPlayUrlData(data) {
  if (!data) return data;
  const cloned = JSON.parse(JSON.stringify(data));
  if (cloned.dash) {
    if (Array.isArray(cloned.dash.audio)) {
      cloned.dash.audio.forEach((item) => {
        if (item.baseUrl) item.baseUrl = proxyAudioUrl(item.baseUrl);
        if (item.base_url) item.base_url = proxyAudioUrl(item.base_url);
        if (Array.isArray(item.backupUrl)) {
          item.backupUrl = item.backupUrl.map(proxyAudioUrl);
        }
        if (Array.isArray(item.backup_url)) {
          item.backup_url = item.backup_url.map(proxyAudioUrl);
        }
      });
    }
    if (cloned.dash.flac?.audio) {
      const flac = cloned.dash.flac.audio;
      if (flac.baseUrl) flac.baseUrl = proxyAudioUrl(flac.baseUrl);
      if (flac.base_url) flac.base_url = proxyAudioUrl(flac.base_url);
    }
    if (Array.isArray(cloned.dash.dolby?.audio)) {
      cloned.dash.dolby.audio.forEach((item) => {
        if (item.baseUrl) item.baseUrl = proxyAudioUrl(item.baseUrl);
        if (item.base_url) item.base_url = proxyAudioUrl(item.base_url);
      });
    }
  }
  if (Array.isArray(cloned.durl)) {
    cloned.durl.forEach((item) => {
      if (item.url) item.url = proxyAudioUrl(item.url);
    });
  }
  return cloned;
}

async function requestApi(path, options = {}) {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    ...(options.headers || {})
  };
  const cookieHeader = getCookieHeader();
  if (cookieHeader) {
    headers['X-Bilibili-Cookie'] = cookieHeader;
  }
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return await res.json();
}

export function setupWebElectronAPI() {
  if (typeof window === 'undefined' || window.electronAPI) return;

  console.info('[Web Mode] 未检测到 Electron 环境，已初始化 Web 模式 electronAPI 适配器。');

  // 若处于 Vite 开发/预览服务器，尝试同步本地磁盘中的凭证（免去重复扫码）
  try {
    fetch('/api-dev/cookies')
      .then(r => r.json())
      .then(res => {
        if (res?.code === 0 && res.data && (res.data.SESSDATA || Object.keys(res.data).length > 0)) {
          saveStoredCookies(res.data);
        }
      })
      .catch(() => {});
  } catch (_) {}

  window.electronAPI = {
    isWeb: true,

    // 搜索音乐
    async searchMusic(keyword, page = 1, pageSize = 20) {
      try {
        const url = `/api/x/web-interface/search/all/v2?keyword=${encodeURIComponent(keyword)}&page=${page}&page_size=${pageSize}`;
        return await requestApi(url);
      } catch (err) {
        console.error('[Web] searchMusic 失败:', err);
        return { code: -1, message: err.message };
      }
    },

    // 音乐区推荐
    async getMusicRegionFeed(displayId = 1, requestCnt = 15) {
      try {
        const url = `/api/x/web-interface/region/feed/rcmd?display_id=${displayId}&request_cnt=${requestCnt}&from_region=1003&device=web&plat=30&web_location=333.40138`;
        return await requestApi(url);
      } catch (err) {
        console.error('[Web] getMusicRegionFeed 失败:', err);
        return { code: -1, message: err.message, data: { archives: [] } };
      }
    },

    // 音乐综合排行
    async getMusicComprehensiveWebRank(pn = 1, ps = 20) {
      try {
        const url = `/api/x/centralization/interface/music/comprehensive/web/rank?pn=${pn}&ps=${ps}&web_location=333.1351`;
        return await requestApi(url);
      } catch (err) {
        console.error('[Web] getMusicComprehensiveWebRank 失败:', err);
        return { code: -1, message: err.message, data: { list: [] } };
      }
    },

    // 视频信息
    async getMusicInfo(bvid) {
      try {
        const url = `/api/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
        return await requestApi(url);
      } catch (err) {
        console.error('[Web] getMusicInfo 失败:', err);
        return { code: -1, message: err.message };
      }
    },

    // 视频播放流地址（音频流转代理地址）
    async getMusicPlayUrl(bvid, cid) {
      try {
        const url = `/api/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&qn=0&fnval=4048&fnver=0&fourk=1`;
        const res = await requestApi(url);
        if (res && res.code === 0 && res.data) {
          res.data = transformPlayUrlData(res.data);
        }
        return res;
      } catch (err) {
        console.error('[Web] getMusicPlayUrl 失败:', err);
        return { code: -1, message: err.message };
      }
    },

    // 分 P 列表
    async getVideoEpisodes(bvid) {
      try {
        const url = `/api/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`;
        return await requestApi(url);
      } catch (err) {
        console.error('[Web] getVideoEpisodes 失败:', err);
        return { code: -1, message: err.message };
      }
    },

    // 音频代理
    async proxyAudio(audioUrl) {
      return { code: 0, data: proxyAudioUrl(audioUrl) };
    },

    // 推荐
    async getRecommendations() {
      try {
        return await requestApi('/api/x/web-interface/index/top/rcmd');
      } catch (err) {
        return { code: -1, message: err.message };
      }
    },

    // 视频合集
    async getVideoSeries(bvid) {
      try {
        return await requestApi(`/api/x/series/series?bvid=${encodeURIComponent(bvid)}`);
      } catch (err) {
        return { code: -1, message: err.message };
      }
    },

    // 下载相关（Web 降级为提示）
    async downloadAudio(taskInfo) {
      console.warn('[Web] 网页端不支持本地下载');
      return { code: -1, message: 'Web 模式不支持本地下载文件' };
    },
    async getDownloadTasks() {
      return [];
    },
    async clearDownloadTasks() {
      return { code: 0 };
    },
    onDownloadProgress(callback) {
      return () => {};
    },
    async openDownloadFolder() {
      alert('Web 模式不支持打开系统下载目录');
      return { code: 0 };
    },

    // 设置与缓存
    async getCacheSize() {
      return { code: 0, size: '0 MB' };
    },
    async clearCache() {
      localStorage.clear();
      return { code: 0 };
    },
    async selectDownloadDirectory() {
      return null;
    },
    async getDownloadDirectory() {
      return '';
    },
    async setDownloadDirectory() {
      return { code: 0 };
    },
    async openGitHub() {
      window.open('https://github.com/LittleCatAlex/pink-music-app', '_blank');
      return { code: 0 };
    },

    // 版本检查
    async getAppVersion() {
      return '2.7.0';
    },
    async checkForUpdate() {
      return { hasUpdate: false };
    },
    async openExternalUrl(url) {
      window.open(url, '_blank');
      return { code: 0 };
    },

    // 窗口控制
    async minimizeWindow() {},
    async maximizeWindow() {},
    async closeWindow() {},
    async isWindowMaximized() {
      return false;
    },
    async getPlatform() {
      return 'web';
    },

    // 持久化存储
    appData: {
      async get(key) {
        try {
          const raw = localStorage.getItem(`app-data-${key}`);
          return raw ? JSON.parse(raw) : null;
        } catch (_) {
          return null;
        }
      },
      async set(key, value) {
        try {
          localStorage.setItem(`app-data-${key}`, JSON.stringify(value));
          return true;
        } catch (_) {
          return false;
        }
      },
      async remove(key) {
        try {
          localStorage.removeItem(`app-data-${key}`);
          return true;
        } catch (_) {
          return false;
        }
      }
    },

    onFlushRequired(callback) {
      return () => {};
    },
    notifyFlushDone() {},
    onDownloadDirChanged(callback) {
      return () => {};
    },

    // 歌词相关（通过 /netease-api 代理）
    async searchLyric(keyword, source = 'netease') {
      try {
        const cleanKw = String(keyword || '').replace(/[【】\[\]《》]/g, ' ').replace(/\s+/g, ' ').trim();
        const url = `/netease-api/api/search/get?s=${encodeURIComponent(cleanKw)}&type=1&offset=0&limit=10`;
        const res = await fetch(url).then(r => r.json());
        if (res.code === 200 && res.result?.songs) {
          const songs = res.result.songs.map((song) => ({
            id: song.id,
            name: song.name,
            artist: song.artists?.[0]?.name || song.ar?.[0]?.name || '',
            album: song.album?.name || song.al?.name || '',
            duration: song.duration || 0,
            source: 'netease'
          }));
          return { code: 0, data: songs };
        }
        return { code: 0, data: [] };
      } catch (err) {
        console.error('[Web] searchLyric 失败:', err);
        return { code: -1, message: '沒有歌詞', data: [] };
      }
    },

    async getLyricById(song) {
      try {
        const songId = typeof song === 'object' ? song.id : song;
        const res = await fetch(`/netease-api/api/song/lyric?id=${songId}&lv=-1&kv=-1&tv=-1&rv=-1`).then(r => r.json()).catch(() => null);
        const lrc = res?.lrc?.lyric || '';
        if (!lrc || res?.uncollected || res?.nolyric || lrc.includes('暂无歌词') || lrc.includes('纯音乐，无歌词') || lrc.includes('纯音乐，请欣赏')) {
          return { code: -1, message: '沒有歌詞' };
        }
        return {
          code: 0,
          data: {
            lrc: lrc,
            tv: res?.tlyric?.lyric || '',
            rv: res?.romalrc?.lyric || ''
          }
        };
      } catch (err) {
        console.error('[Web] getLyricById 失败:', err);
        return { code: -1, message: '沒有歌詞' };
      }
    },

        async getLyric({ bvid, cid, title, artist, preferredSource }) {
      try {
        let needLogin = false;
        // 若提供了 bvid，且 preferredSource 为 bilibili 或未指定，优先尝试从 B 站获取 CC 字幕
        if (bvid && (preferredSource === 'bilibili' || !preferredSource)) {
          try {
            let targetCid = cid;
            if (!targetCid || targetCid <= 1) {
              const pageRes = await requestApi('/api/x/player/pagelist?bvid=' + encodeURIComponent(bvid));
              if (pageRes?.code === 0 && Array.isArray(pageRes.data) && pageRes.data.length > 0) {
                targetCid = pageRes.data[0].cid;
              }
            }

            let subtitles = null;

            // 1. 尝试 /api/x/player/wbi/v2
            if (targetCid && targetCid > 1) {
              try {
                const subRes = await requestApi('/api/x/player/wbi/v2?bvid=' + encodeURIComponent(bvid) + '&cid=' + encodeURIComponent(targetCid));
                if (subRes?.data?.need_login_subtitle) {
                  needLogin = true;
                }
                if (Array.isArray(subRes?.data?.subtitle?.subtitles) && subRes.data.subtitle.subtitles.length > 0) {
                  subtitles = subRes.data.subtitle.subtitles;
                }
              } catch (_) {}
            }

            // 2. 尝试 /api/x/player/v2
            if (!subtitles && targetCid && targetCid > 1) {
              try {
                const subResV2 = await requestApi('/api/x/player/v2?bvid=' + encodeURIComponent(bvid) + '&cid=' + encodeURIComponent(targetCid));
                if (subResV2?.data?.need_login_subtitle) {
                  needLogin = true;
                }
                if (Array.isArray(subResV2?.data?.subtitle?.subtitles) && subResV2.data.subtitle.subtitles.length > 0) {
                  subtitles = subResV2.data.subtitle.subtitles;
                }
              } catch (_) {}
            }

            // 3. 兜底 /api/x/web-interface/view
            if (!subtitles) {
              try {
                const viewRes = await requestApi('/api/x/web-interface/view?bvid=' + encodeURIComponent(bvid));
                const viewList = viewRes?.data?.subtitle?.list || viewRes?.data?.subtitle?.subtitles;
                if (Array.isArray(viewList) && viewList.length > 0) {
                  subtitles = viewList;
                }
              } catch (_) {}
            }

            if (Array.isArray(subtitles) && subtitles.length > 0) {
              const isCreatorCC = (s) => {
                if (!s) return false;
                if (s.type === 1) return false;
                if (String(s.lan || '').toLowerCase().startsWith('ai-')) return false;
                if (typeof s.ai_status === 'number' && s.ai_status !== 0) return false;
                if (typeof s.ai_type === 'number' && s.ai_type !== 0) return false;
                return true;
              };
              const creatorSubs = subtitles.filter(isCreatorCC);
              if (creatorSubs.length > 0) {
                const isZh = (s) => (s.lan || '').toLowerCase().startsWith('zh') || (s.lan_doc || '').includes('中');
                const main = creatorSubs.find(isZh) || creatorSubs[0];
                let trans = null;
                if (creatorSubs.length > 1) {
                  trans = creatorSubs.find(s => s !== main && s.lan !== main.lan) || null;
                }

              const parseSubUrl = async (subObj) => {
                if (!subObj) return '';
                const rawUrl = subObj.subtitle_url || subObj.subtitle_url_v2;
                if (!rawUrl) return '';
                const url = rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl;
                try {
                  const res = await fetch(url);
                  const data = await res.json();
                  if (data && Array.isArray(data.body) && data.body.length > 0) {
                    const lines = [];
                    for (const item of data.body) {
                      if (!item || typeof item.from !== 'number' || item.content === undefined || item.content === null) continue;
                      const text = String(item.content).replace(/[\r\n]+/g, ' ').trim();
                      if (!text) continue;
                      const totalMs = Math.max(0, Math.round(Number(item.from) * 1000));
                      const m = Math.floor(totalMs / 60000);
                      const s = Math.floor((totalMs % 60000) / 1000);
                      const cs = Math.floor((totalMs % 1000) / 10);
                      lines.push('[' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(cs).padStart(2, '0') + ']' + text);
                    }
                    return lines.join('\n');
                  }
                } catch (subErr) {
                  console.warn('[Web] 解析字幕 JSON 失败:', subErr.message);
                }
                return '';
              };

              const mainLrc = await parseSubUrl(main);
              const tvLrc = trans ? await parseSubUrl(trans) : '';
              if (mainLrc) {
                return { code: 0, data: { lrc: mainLrc, rv: '', tv: tvLrc }, source: 'bilibili' };
              }
              }
            }
          } catch (e) {
            console.warn('[Web] 获取 B 站 CC 字幕失败，回退其他源:', e.message);
          }
        }

        // B 站无 CC 字幕时，通过智能清洗后的关键词从网易云等源获取歌词
        const { bookTitle, cleanTitle, cleanArtist, queries } = cleanTitleAndExtract(title, artist);

        for (const q of queries) {
          const searchRes = await this.searchLyric(q);
          if (searchRes.code === 0 && Array.isArray(searchRes.data) && searchRes.data.length > 0) {
            const matchedSong = matchSong(searchRes.data, cleanTitle, bookTitle, q, cleanArtist, title);
            if (matchedSong) {
              const lyricRes = await this.getLyricById(matchedSong);
              if (lyricRes.code === 0 && lyricRes.data?.lrc) {
                return { ...lyricRes, source: 'netease' };
              }
            }
          }
        }
        if (needLogin) {
          return { code: -1, needLogin: true, message: 'B站 CC 字幕需登录后使用' };
        }
        return { code: -1, message: '沒有歌詞' };
      } catch (err) {
        return { code: -1, message: '沒有歌詞' };
      }
    },

    // 登录与二维码
    async generateQrcode() {
      try {
        const res = await requestApi('/passport/x/passport-login/web/qrcode/generate');
        return res;
      } catch (err) {
        console.error('[Web] generateQrcode 失败:', err);
        return { code: -1, message: err.message };
      }
    },

    async pollQrcode(qrcodeKey) {
      try {
        const res = await requestApi(`/passport/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`);
        if (res && res.code === 0 && res.data) {
          if (res.data.code === 0 && res.data.url) {
            const cookies = parseCookiesFromUrl(res.data.url);
            saveStoredCookies(cookies);
          }
        }
        return { code: 0, data: res };
      } catch (err) {
        console.error('[Web] pollQrcode 失败:', err);
        return { code: -1, message: err.message };
      }
    },

    async getUserInfo() {
      try {
        return await requestApi('/api/x/web-interface/nav');
      } catch (err) {
        console.error('[Web] getUserInfo 失败:', err);
        return { code: -1, message: err.message };
      }
    },

    async getBilibiliCookies() {
      return { code: 0, data: getStoredCookies() };
    },

    async logoutBilibili() {
      clearStoredCookies();
      return { code: 0 };
    },

    // 收藏夹
    async getFavFolderCreatedList(upMid, pn = 1, ps = 50) {
      try {
        const url = `/api/x/v3/fav/folder/created/list?up_mid=${encodeURIComponent(upMid)}&pn=${pn}&ps=${ps}&web_location=333.1387`;
        return await requestApi(url);
      } catch (err) {
        return { code: -1, message: err.message };
      }
    },

    async getFavFolderCollectedList(upMid, pn = 1, ps = 50) {
      try {
        const url = `/api/x/v3/fav/folder/collected/list?up_mid=${encodeURIComponent(upMid)}&pn=${pn}&ps=${ps}&platform=web`;
        return await requestApi(url);
      } catch (err) {
        return { code: -1, message: err.message };
      }
    },

    async getFavResourceList(mediaId, pn = 1, ps = 20) {
      try {
        const safePs = Math.max(1, Math.min(20, Number(ps) || 20));
        const safePn = Math.max(1, Number(pn) || 1);
        const url = `/api/x/v3/fav/resource/list?media_id=${encodeURIComponent(mediaId)}&pn=${safePn}&ps=${safePs}&tid=0&type=0&platform=web&order=mtime`;
        return await requestApi(url);
      } catch (err) {
        return { code: -1, message: err.message };
      }
    },

    async getFavResourceIds(mediaId) {
      try {
        return await requestApi(`/api/x/v3/fav/resource/ids?media_id=${encodeURIComponent(mediaId)}&platform=web`);
      } catch (err) {
        return { code: -1, message: err.message };
      }
    },

    async getFavResourceInfos(resources) {
      return { code: 0, data: { list: [] } };
    },

    async showMessageBox(options) {
      const ok = window.confirm(options.message || options.title || '确认操作？');
      return { response: ok ? 0 : 1 };
    },

    async setWindowOpacity(opacity) {
      return { code: 0 };
    },

    discord: {
      async updateActivity(activity) {
        // Web 模式无本地 Discord IPC
        return { code: 0 };
      },
      async clearActivity() {
        return { code: 0 };
      },
      async setEnabled(enabled) {
        return { code: 0 };
      },
      async getStatus() {
        return { code: 0, data: { enabled: true, connected: false } };
      }
    },

    // 本地音乐库降级占位
    local: {
      async importFiles() {
        alert('Web 模式不支持直接导入本地音乐文件，请在 Electron 客户端中使用');
        return { code: 0, data: [] };
      },
      async importFolder() {
        alert('Web 模式不支持直接导入本地文件夹，请在 Electron 客户端中使用');
        return { code: 0, data: [] };
      },
      async scanPaths() {
        return [];
      },
      async parseMetadata() {
        return [];
      },
      async checkFiles() {
        return [];
      },
      async readLrc() {
        return null;
      },
      async findLrc() {
        return null;
      },
      async saveCover() {
        return '';
      },
      async revealFile() {},
      async relocateFile() {
        return null;
      },
      onParseProgress() {
        return () => {};
      }
    }
  };
}
