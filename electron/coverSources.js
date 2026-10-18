/**
 * 云端封面源
 * ─────────────────────────────────────────
 * 参考 HisAtri/LrcApi（https://github.com/HisAtri/LrcApi）的封面接口形态：
 *   GET /cover?title=<歌名>&artist=<歌手>&album=<专辑>   → 直接返回图片字节
 *   公开实例：https://api.lrc.cx/cover
 *   LrcApi 内部聚合搜索后反代真实图床，命中 302 时 Location 指向真实图片。
 *
 * 但实测发现 LrcApi 的 /cover 对**任意**查询都会「尽力」返回一张图：
 * 完全不相关的歌名也能拿到某个专辑封面。若直接采信，会把错误封面写到本地曲上。
 * 因此本模块的自动匹配采用「候选校验 + 取图」两步（对应歌词链路的 pickBestMatch）：
 *
 *   1) searchCoverCandidates —— 多源候选：
 *        · iTunes Search API（storefront hk/us）：能给出**原版**曲目与专辑，
 *          经实测 hk 同时覆盖华语（周杰倫《11月的蕭邦》）与欧美（Queen《A Night at the Opera》），
 *          是可靠性最高的校验源；us 作为欧美补充。
 *        · 网易云 cloudsearch：候选数量多、带 al.picUrl，用于手动挑选的多样性
 *   2) pickBestCoverMatch —— 相关性校验，只有可信命中才继续取图
 *   3) 取图：优先用命中的 iTunes 600x600 专辑图；否则走 LrcApi（保留 LrcApi 作为兜底来源）
 *
 * 尺寸策略：Apple 图床 URL 支持任意尺寸段替换（.../3000x3000bb.jpg → .../600x600bb.jpg），
 * 网易云支持 ?param=WyH。单张封面稳定在 60~130KB，避免把本地封面缓存撑爆。
 *
 * 手动搜索面板仍复用网易云候选（12 条，带 130x130 缩略图），与歌词的手动搜索体验对齐。
 */

const axios = require('axios');

// LrcApi 公开实例（自部署时改这里即可）
const LRCAPI_COVER_ENDPOINT = 'https://api.lrc.cx/cover';
// LrcApi 的 JSON 搜索接口：返回候选列表（含 title/artist/album/cover），
// 用它把 LrcApi 接入统一的候选校验流程，而不是直接采信 /cover 的"尽力返回"。
const LRCAPI_JSON_ENDPOINT = 'https://api.lrc.cx/jsonapi';
const NETEASE_SEARCH_ENDPOINT = 'https://music.163.com/api/cloudsearch/pc';
const ITUNES_SEARCH_ENDPOINT = 'https://itunes.apple.com/search';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

// iTunes storefront：hk 兼顾华语与欧美；us 补充欧美
// （cn 实测返回 0 条；jp 会把歌手名罗马音化，反而让歌手校验失效）
const ITUNES_STOREFRONTS = ['hk', 'us'];

// 单张封面下载上限：超过视为异常大图，直接放弃（防止缓存目录被撑爆）
const MAX_COVER_BYTES = 6 * 1024 * 1024;

// ───────── 尺寸改写 ─────────

/**
 * Apple 图床 URL 支持任意尺寸替换：
 *   .../3000x3000bb.jpg → .../600x600bb.jpg
 * 非 Apple 图床不匹配正则，原样返回。
 */
function resizeArtworkUrl(url, size = 600) {
  if (!url) return url;
  return String(url).replace(
    /\/(\d{2,5})x(\d{2,5})(bb|cc|sr|rw|w)\.(jpg|jpeg|png|webp)$/i,
    `/${size}x${size}$3.$4`
  );
}

/** 网易云图片 URL 的尺寸参数：?param=WyH */
function neteaseResize(url, size = 600) {
  if (!url) return url;
  const httpsUrl = url.startsWith('http://') ? url.replace(/^http:/, 'https:') : url;
  return `${httpsUrl.split('?')[0]}?param=${size}y${size}`;
}

function pickContentType(headers = {}, fallback = 'image/jpeg') {
  const ct = headers['content-type'] || headers['Content-Type'] || '';
  return /^image\//i.test(ct) ? ct : fallback;
}

// ───────── 候选搜索 ─────────

/**
 * iTunes Search API：能返回原版曲目与专辑图，是校验用最可靠的源。
 * @returns {Promise<Array<{id,name,artist,album,duration,cover,coverRaw,provider}>>}
 */
async function itunesCoverSearch(keyword, { storefront = 'hk', limit = 8 } = {}) {
  if (!keyword) return [];
  try {
    const res = await axios.get(ITUNES_SEARCH_ENDPOINT, {
      params: { term: keyword, entity: 'song', limit, country: storefront },
      headers: { 'User-Agent': BROWSER_UA },
      timeout: 12000,
    });
    const list = res.data?.results;
    if (!Array.isArray(list)) return [];
    return list
      .filter((r) => r?.trackName && r?.artworkUrl100)
      .map((r) => {
        const raw = r.artworkUrl100;
        return {
          id: `itunes-${storefront}-${r.trackId}`,
          name: r.trackName,
          artist: r.artistName || '',
          album: r.collectionName || '',
          duration: typeof r.trackTimeMillis === 'number' ? Math.round(r.trackTimeMillis / 1000) : 0,
          cover: raw,
          // 100x100 → 600x600（Apple 图床支持任意尺寸段）
          coverRaw: raw.replace(/\/\d{2,5}x\d{2,5}(bb|cc|sr|rw|w)\./i, '/600x600$1.'),
          provider: 'itunes',
        };
      });
  } catch (e) {
    console.warn('[coverSources] iTunes 搜索失败:', e.message);
    return [];
  }
}

/**
 * 网易云候选搜索（手动搜索面板用）。
 * 一次 cloudsearch 请求即可拿到带 al.picUrl 的候选，缩略图走 ?param=130y130。
 */
async function neteaseCoverSearch(keyword, limit = 12) {
  if (!keyword) return [];
  try {
    const res = await axios.post(
      NETEASE_SEARCH_ENDPOINT,
      new URLSearchParams({ s: keyword, type: '1', limit: String(limit), offset: '0' }).toString(),
      {
        headers: {
          'User-Agent': BROWSER_UA,
          Referer: 'https://music.163.com/',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 12000,
      }
    );
    const songs = res.data?.result?.songs;
    if (!Array.isArray(songs)) return [];
    return songs
      .map((s) => {
        const raw = s?.al?.picUrl || s?.album?.picUrl || '';
        return {
          id: `netease-${s?.id}`,
          name: s?.name || '',
          artist: (s?.ar || s?.artists || [])[0]?.name || '',
          album: s?.al?.name || s?.album?.name || '',
          duration: typeof s?.dt === 'number' ? Math.round(s.dt / 1000) : 0,
          cover: raw ? neteaseResize(raw, 130) : '',
          coverRaw: raw,
          provider: 'netease',
        };
      })
      .filter((s) => s.name);
  } catch (e) {
    console.warn('[coverSources] 网易云候选搜索失败:', e.message);
    return [];
  }
}

/**
 * LrcApi JSON 搜索（/jsonapi）：返回候选列表，作为 LrcApi 的候选来源。
 * 字段：title / artist / album / cover(3000x3000) / cover_format({w}x{h} 模板)
 * @returns {Promise<Array<{id,name,artist,album,duration,cover,coverRaw,provider}>>}
 */
async function lrcapiCoverSearch({ title = '', artist = '', limit = 10 } = {}) {
  const t = String(title || '').trim();
  if (!t) return [];
  try {
    const res = await axios.get(LRCAPI_JSON_ENDPOINT, {
      params: { title: t, artist: String(artist || '').trim(), album: '', limit, path: 'None', api: 'lrcapi' },
      headers: { 'User-Agent': BROWSER_UA },
      timeout: 15000,
    });
    const list = res.data;
    if (!Array.isArray(list)) return [];
    return list
      .filter((it) => it?.title && it?.cover)
      .map((it) => {
        // cover_format 是 {w}x{h} 模板，直接替换即可；没有时用正则改写 Apple 尺寸段
        const raw = it.cover_format
          ? String(it.cover_format).replace('{w}', '600').replace('{h}', '600')
          : resizeArtworkUrl(it.cover, 600);
        const thumb = it.cover_format
          ? String(it.cover_format).replace('{w}', '130').replace('{h}', '130')
          : resizeArtworkUrl(it.cover, 130);
        return {
          id: `lrcapi-${it.id || it.object_id || it.hash || it.title}`,
          name: it.title,
          artist: it.artist || it.composerName || '',
          album: it.album || '',
          duration: typeof it.duration === 'number' ? Math.round(it.duration) : 0,
          cover: thumb,
          coverRaw: raw,
          provider: 'lrcapi',
        };
      });
  } catch (e) {
    console.warn('[coverSources] LrcApi JSON 搜索失败:', e.message);
    return [];
  }
}

/**
 * 合并候选：iTunes（原版优先）→ LrcApi → 网易云（多样性）。
 * 去重键：归一化后的「歌名 + 歌手 + 专辑」。
 */
async function searchCoverCandidates(keyword, { title = '', artist = '' } = {}) {
  const kw = String(keyword || '').trim();
  if (!kw) return [];
  const tasks = ITUNES_STOREFRONTS.map((sf) => itunesCoverSearch(kw, { storefront: sf }));
  tasks.push(lrcapiCoverSearch({ title: title || kw, artist }))
  tasks.push(neteaseCoverSearch(kw));
  const groups = await Promise.all(tasks);
  const seen = new Set();
  const out = [];
  for (const group of groups) {
    for (const item of group) {
      if (!item.coverRaw) continue;
      const key = `${normalizeName(item.name)}|${normalizeName(item.artist)}|${normalizeName(item.album)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

// ───────── 相关性校验（对应歌词链路的 pickBestMatch） ─────────

/** 归一化：去装饰符号与空白，便于比较 */
function normalizeName(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[【】\[\]（）()《》<>·、,，&/\\|♪♫"']/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/** 标题相似度：完全相同 1；互相包含 0.8；否则 0 */
function titleScore(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.8;
  return 0;
}

function hasHan(s) {
  return /[\u4e00-\u9fff]/.test(String(s || ''));
}

/** 歌手是否匹配（取首个歌手名做包含判断） */
function artistMatches(targetArtist, candidateArtist) {
  const t = normalizeName(String(targetArtist || '').split(/[、,，&/\\\s]+/)[0]);
  const c = normalizeName(candidateArtist);
  if (!t || !c) return false;
  return c.includes(t) || t.includes(c);
}

/**
 * 汉字相似度：公共字符数 / 较短串长度。
 * 用于识别「简繁差异 / 同名字不同写法」，例如：
 *   周杰伦 ↔ 周杰倫 → 2/3 ≈ 0.67
 *   邓紫棋 ↔ 鄧紫棋 → 2/3 ≈ 0.67
 *   周杰伦 ↔ 林俊杰 → 0
 */
function hanSimilarity(a, b) {
  const A = Array.from(new Set(normalizeName(a)));
  const B = Array.from(new Set(normalizeName(b)));
  if (A.length === 0 || B.length === 0) return 0;
  const inter = A.filter((ch) => B.includes(ch)).length;
  return inter / Math.min(A.length, B.length);
}

// 简繁/别名容差阈值：仅当两边都是汉字且字符重合度过半时才放行
const HAN_SIMILARITY_THRESHOLD = 0.5;

/**
 * 从候选里挑最匹配的一条（**有歌手信息时的严格校验路径**）。
 *
 * 规则（宁可不匹配，也不写错封面）：
 *   1. 标题必须相似度 ≥ 0.6（完全一致或互相包含）
 *   2. 歌手匹配 → 直接采信
 *   3. 歌手不匹配但双方都含汉字 → 视为简繁/别名差异（如 周杰伦 ↔ 周杰倫）放行，
 *      此时以「标题完全一致」作为唯一硬门槛
 *   4. 其余情况 → null
 *
 * 专辑一致额外加权，用于同名不同版本时挑选。
 * 注：无歌手信息时不走此函数，改走 pickFirstCoverMatch（按歌名取第一个）。
 */
function pickBestCoverMatch(candidates, { title = '', artist = '', album = '' } = {}) {
  const list = Array.isArray(candidates) ? candidates.filter((c) => c && c.coverRaw) : [];
  if (list.length === 0) return null;

  const cleanTitle = String(title || '').trim();
  const cleanArtist = String(artist || '').trim();
  if (!cleanTitle) return null;

  let best = null;
  let bestScore = 0;
  for (const c of list) {
    const ts = titleScore(cleanTitle, c.name);
    if (ts < 0.6) continue;
    const am = artistMatches(cleanArtist, c.artist);
    const albumHit = album && normalizeName(album) && normalizeName(album) === normalizeName(c.album);
    // iTunes 命中视为更可信（返回的是原版而非翻唱）
    const providerBonus = c.provider === 'itunes' ? 0.2 : 0;
    const score = ts + (am ? 0.5 : 0) + (albumHit ? 0.3 : 0) + providerBonus;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (!best) return null;

  const ts = titleScore(cleanTitle, best.name);
  if (artistMatches(cleanArtist, best.artist)) return best;

  // 简繁/别名容差：两边都是汉字、字符重合度过半（如 周杰伦 ↔ 周杰倫），
  // 且标题完全一致时才放行。仅靠"都是汉字"会误放行完全不相关的歌手。
  if (cleanArtist && hasHan(cleanArtist) && hasHan(best.artist) && ts === 1 &&
      hanSimilarity(cleanArtist, best.artist) >= HAN_SIMILARITY_THRESHOLD) {
    return best;
  }

  return null;
}

/**
 * 无歌手信息时的兜底选择：按歌名搜索后取「第一个」封面。
 *
 * 用户诉求：本地文件没有歌手标签时，不要因为校验不通过就完全不匹配，
 * 至少按歌名搜到的第一个结果要有封面。
 *
 * 选择顺序（searchCoverCandidates 已把 iTunes 原版排在前面）：
 *   1. 标题**完全一致**的第一条（最理想）
 *   2. 标题相似（互相包含，如 夜曲 ↔ 夜曲(Live)）的第一条
 *   3. 都没有则退回搜索结果的第一条
 */
function pickFirstCoverMatch(candidates, title = '') {
  const list = Array.isArray(candidates) ? candidates.filter((c) => c && c.coverRaw) : [];
  if (list.length === 0) return null;
  const cleanTitle = String(title || '').trim();
  if (cleanTitle) {
    const exact = list.find((c) => titleScore(cleanTitle, c.name) === 1);
    if (exact) return exact;
    const similar = list.find((c) => titleScore(cleanTitle, c.name) >= 0.6);
    if (similar) return similar;
  }
  return list[0];
}

// ───────── 下载 ─────────

/**
 * 按 歌名/歌手/专辑 走 LrcApi 取封面并下载字节。
 * LrcApi 的 /cover 常 302 到 Apple 图床（3000x3000 原图），
 * 这里手动接住 302、把尺寸段改写为 600x600 再拉，单张从 ~2MB 降到 ~100KB。
 * @returns {Promise<{buffer:Buffer, contentType:string, sourceUrl:string}|null>}
 */
async function downloadCoverByQuery(query = {}, { size = 600 } = {}) {
  const { title = '', artist = '', album = '' } = query;
  if (!title && !artist && !album) return null;

  try {
    const res = await axios.get(LRCAPI_COVER_ENDPOINT, {
      params: { title, artist, album },
      headers: { 'User-Agent': BROWSER_UA },
      timeout: 15000,
      maxRedirects: 0,
      responseType: 'arraybuffer',
      validateStatus: (s) => s >= 200 && s < 400,
    });

    // 情况一：LrcApi 直接返回图片字节
    if (res.status === 200) {
      const buffer = Buffer.from(res.data);
      if (buffer.length < 100 || buffer.length > MAX_COVER_BYTES) return null;
      return { buffer, contentType: pickContentType(res.headers), sourceUrl: '' };
    }

    // 情况二：302 到真实图床 —— 改写尺寸后重新拉取
    const location = res.headers.location || res.headers.Location;
    if (location) {
      return await downloadCoverByUrl(location, { size });
    }
    return null;
  } catch (e) {
    // 404（未匹配到封面）属正常情况，不刷错误日志
    if (e?.response?.status !== 404) {
      console.warn('[coverSources] LrcApi 取封面失败:', e.message);
    }
    return null;
  }
}

/**
 * 下载指定 URL 的封面（iTunes 候选 / 手动选择候选 / LrcApi 重定向目标）。
 * 按图床特征自动选择尺寸改写方式。
 */
async function downloadCoverByUrl(url, { size = 600 } = {}) {
  if (!url) return null;
  const target = /126\.net/.test(url) ? neteaseResize(url, size) : resizeArtworkUrl(url, size);
  try {
    const img = await axios.get(target, {
      headers: { 'User-Agent': BROWSER_UA, Referer: 'https://music.163.com/' },
      timeout: 20000,
      maxRedirects: 5,
      responseType: 'arraybuffer',
      validateStatus: (s) => s === 200,
    });
    const buffer = Buffer.from(img.data);
    if (buffer.length < 100 || buffer.length > MAX_COVER_BYTES) return null;
    return { buffer, contentType: pickContentType(img.headers), sourceUrl: url };
  } catch (e) {
    console.warn('[coverSources] 按 URL 取封面失败:', e.message);
    return null;
  }
}

/** 通用占位曲名（无标签本地文件常见），不允许自动匹配 */
const GENERIC_TITLE_RE = /^(track|audio|song|music|untitled|unknown|new recording|voice|recording|未知|未命名|无题|新录音|录音)[\s._-]*\d{0,3}$/i;

function isGenericTitle(title) {
  const t = String(title || '').trim();
  if (!t) return true;
  if (t.length < 2) return true;
  return GENERIC_TITLE_RE.test(t);
}

/**
 * 自动匹配封面。
 *
 * 有歌手 → 走严格校验（pickBestCoverMatch），校验不过就留空，避免写错封面。
 * 无歌手 → 走宽松兜底（pickFirstCoverMatch）：按歌名搜索后取第一个结果，
 *          让缺少歌手标签的本地文件也能有封面。
 *
 * 两种情况都拒绝「通用占位名」（track01 / 未命名 等），
 * 因为拿这种名字去搜必然匹配到无关内容。
 *
 * 说明：LrcApi 的 /cover 对任意查询都会「尽力」返回一张图，
 * 因此本实现不直接采信它，而是通过其 /jsonapi 候选接入统一流程。
 * @returns {Promise<{buffer, contentType, sourceUrl, matched}|null>}
 */
async function matchCoverByQuery(query = {}) {
  const title = String(query.title || '').trim();
  const artist = String(query.artist || '').trim();
  const album = String(query.album || '').trim();

  if (!title) return null;
  if (isGenericTitle(title)) return null;

  const keyword = [title, artist].filter(Boolean).join(' ');
  const candidates = await searchCoverCandidates(keyword, { title, artist });

  const matched = artist
    ? pickBestCoverMatch(candidates, { title, artist, album })
    : pickFirstCoverMatch(candidates, title);
  if (!matched) return null;

  const hit = await downloadCoverByUrl(matched.coverRaw);
  return hit ? { ...hit, matched } : null;
}

module.exports = {
  LRCAPI_COVER_ENDPOINT,
  LRCAPI_JSON_ENDPOINT,
  ITUNES_STOREFRONTS,
  resizeArtworkUrl,
  neteaseResize,
  isGenericTitle,
  titleScore,
  hanSimilarity,
  itunesCoverSearch,
  lrcapiCoverSearch,
  neteaseCoverSearch,
  searchCoverCandidates,
  pickBestCoverMatch,
  pickFirstCoverMatch,
  matchCoverByQuery,
  downloadCoverByQuery,
  downloadCoverByUrl,
};