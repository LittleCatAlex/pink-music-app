/**
 * Test Bilibili CC Subtitle parser and lyric source order
 */
const assert = require('assert');
const {
  formatLrcTimestamp,
  convertBiliSubtitleToLrc,
  pickSubtitles,
  resolveCookieHeader,
  getBilibiliSubtitle
} = require('../electron/bilibiliSubtitle');
const {
  LYRIC_SOURCES,
  DEFAULT_LYRIC_SOURCE,
  resolveLyricSourceOrder
} = require('../electron/lyricSourceOrder');

console.log('[test:subtitle] Running Bilibili CC subtitle and source order tests...');

// Test 1: Lyric source order
assert.strictEqual(DEFAULT_LYRIC_SOURCE, 'bilibili', 'DEFAULT_LYRIC_SOURCE must be bilibili');
assert.deepStrictEqual(LYRIC_SOURCES, ['bilibili', 'kugou', 'netease']);

assert.deepStrictEqual(
  resolveLyricSourceOrder('bilibili'),
  ['bilibili', 'kugou', 'netease'],
  'bilibili should be first when chosen or default'
);

assert.deepStrictEqual(
  resolveLyricSourceOrder(undefined),
  ['bilibili', 'kugou', 'netease'],
  'undefined source should fallback to bilibili as default'
);

assert.deepStrictEqual(
  resolveLyricSourceOrder('unknown_source'),
  ['bilibili', 'kugou', 'netease'],
  'unknown source should fallback to bilibili'
);

assert.deepStrictEqual(
  resolveLyricSourceOrder('kugou'),
  ['kugou', 'bilibili', 'netease'],
  'kugou should be prioritized when preferred'
);

assert.deepStrictEqual(
  resolveLyricSourceOrder('netease'),
  ['netease', 'bilibili', 'kugou'],
  'netease should be prioritized when preferred'
);

console.log('✓ Lyric source order tests passed.');

// Test 2: Timestamp formatting
assert.strictEqual(formatLrcTimestamp(0), '[00:00.00]');
assert.strictEqual(formatLrcTimestamp(1.25), '[00:01.25]');
assert.strictEqual(formatLrcTimestamp(65.4), '[01:05.40]');
assert.strictEqual(formatLrcTimestamp(125.789), '[02:05.78]');
assert.strictEqual(formatLrcTimestamp(3661.05), '[61:01.05]');

console.log('✓ Timestamp formatting tests passed.');

// Test 3: Subtitle conversion to LRC
const mockBody = [
  { from: 1.25, to: 3.45, content: '第一句歌词内容' },
  { from: 4.50, to: 8.10, content: '第二句歌词带换行\n空格' },
  { from: 10.0, to: 12.0, content: '   ' }, // Should be skipped (whitespace only)
  null, // Should be safely ignored
  { from: 15.2, to: 18.0, content: '第三句歌词' }
];

const lrc = convertBiliSubtitleToLrc(mockBody);
const lrcLines = lrc.split('\n');
assert.strictEqual(lrcLines.length, 3, 'Should produce 3 valid lines');
assert.strictEqual(lrcLines[0], '[00:01.25]第一句歌词内容');
assert.strictEqual(lrcLines[1], '[00:04.50]第二句歌词带换行 空格');
assert.strictEqual(lrcLines[2], '[00:15.20]第三句歌词');

console.log('✓ Subtitle to LRC conversion tests passed.');

// Test 4: Subtitle language and priority selection
const mockSubtitles = [
  { id: 1, lan: 'en-US', lan_doc: '英语', ai_type: 0, type: 0, subtitle_url: '//sub/en.json' },
  { id: 2, lan: 'ai-zh', lan_doc: '中文（自动生成）', ai_type: 1, type: 1, subtitle_url: '//sub/ai-zh.json' },
  { id: 3, lan: 'zh-CN', lan_doc: '中文（中国）', ai_type: 0, type: 0, subtitle_url: '//sub/zh.json' }
];

const picked = pickSubtitles(mockSubtitles);
assert.strictEqual(picked.main.id, 3, 'Should prefer manual Chinese subtitle (id 3)');
assert.strictEqual(picked.trans.id, 1, 'Should pick English subtitle as translation (id 1)');

// When only AI subtitle exists
const mockAiOnly = [
  { id: 10, lan: 'ai-zh', lan_doc: '中文（自动生成）', ai_type: 1, type: 1, subtitle_url: '//sub/ai.json' }
];
const pickedAi = pickSubtitles(mockAiOnly);
assert.strictEqual(pickedAi.main.id, 10, 'Should fall back to AI subtitle if no manual subtitle');
assert.strictEqual(pickedAi.trans, null);

console.log('✓ Subtitle priority and translation selection tests passed.');

// Test 5: Strict keyword building & relevance matching
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

// 严格校验候选歌曲是否真正匹配目标歌曲
function isStrictMatch(candidate, cleanTitle, cleanArtist, bookTitle = '') {
  if (!candidate || !candidate.name) return false;

  const targetTitle = bookTitle || cleanTitle;
  const normTarget = normalizeForComparison(targetTitle);
  const normCandidate = normalizeForComparison(candidate.name);

  if (!normTarget || !normCandidate) return false;

  // 1. 完全相同
  if (normCandidate === normTarget) return true;

  // 2. 核心歌名完全相同（去除 feat、噪声括号等）
  const coreTarget = extractCoreTitle(targetTitle);
  const coreCandidate = extractCoreTitle(candidate.name);
  if (coreTarget && coreCandidate && coreTarget === coreCandidate) return true;

  // 3. 高覆盖率的子串包含关系（如 "晴天" 与 "晴天 (Live)"）
  if (normTarget.includes(normCandidate) || normCandidate.includes(normTarget)) {
    const shorter = normTarget.length <= normCandidate.length ? normTarget : normCandidate;
    const longer = normTarget.length > normCandidate.length ? normTarget : normCandidate;
    const coverage = shorter.length / longer.length;
    if (coverage >= 0.6) return true;
    const remainder = longer.replace(shorter, '').trim();
    if (extractMeaningfulTokens(remainder).length === 0) return true;
  }

  if (coreTarget && coreCandidate && (coreTarget.includes(coreCandidate) || coreCandidate.includes(coreTarget))) {
    const shorter = coreTarget.length <= coreCandidate.length ? coreTarget : coreCandidate;
    const longer = coreTarget.length > coreCandidate.length ? coreTarget : coreCandidate;
    if (shorter.length / longer.length >= 0.6) return true;
    const remainder = longer.replace(shorter, '').trim();
    if (extractMeaningfulTokens(remainder).length === 0) return true;
  }

  // 4. 有效核心词/词组匹配（需覆盖 70% 以上有意义词，杜绝依靠 feat / 噪声词误匹配）
  const targetTokens = extractMeaningfulTokens(coreTarget || normTarget);
  const candidateTokens = extractMeaningfulTokens(coreCandidate || normCandidate);

  if (targetTokens.length > 0 && candidateTokens.length > 0) {
    const matchedCount = targetTokens.filter(t => {
      return candidateTokens.some(ct => ct === t || ct.includes(t) || t.includes(ct));
    }).length;

    const ratio = matchedCount / targetTokens.length;
    if (ratio >= 0.7 && matchedCount >= 1) {
      if (candidateTokens.length <= targetTokens.length * 2) {
        return true;
      }
    }
  }

  return false;
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

  // 若存在书名号
  if (bookTitle) {
    const artistInTitle = cleaned.replace(bookTitle, '').replace(noiseWordsRegex, ' ').replace(/\s+/g, ' ').trim();
    if (artistInTitle) {
      queries.push(bookTitle + ' ' + artistInTitle);
    }
    queries.push(bookTitle);
  }

  const coreTitle = extractCoreTitle(cleaned.replace(noiseWordsRegex, ' '));
  const cleanWithoutNoise = cleaned.replace(noiseWordsRegex, ' ').replace(/\s+/g, ' ').trim();

  // 若包含 " - " 或 " / " 分隔
  const dashMatch = raw.replace(noiseTagRegex, '').replace(noiseParenRegex, '').match(/([^-–—/|｜]+)\s*[-–—/|｜]\s*([^-–—/|｜]+)/);
  if (dashMatch) {
    const p1 = extractCoreTitle(dashMatch[1].replace(/[【】\[\]()（）《》]/g, ' ').replace(noiseWordsRegex, ' '));
    const p2 = extractCoreTitle(dashMatch[2].replace(/[【】\[\]()（）《》]/g, ' ').replace(noiseWordsRegex, ' '));
    if (p1 && p1.length >= 2) queries.push(p1);
    if (p2 && p2.length >= 2) queries.push(p2);
  }

  if (coreTitle && coreTitle.length >= 2 && !queries.includes(coreTitle)) {
    queries.push(coreTitle);
  }

  if (cleanWithoutNoise && cleanWithoutNoise.length >= 2 && !queries.includes(cleanWithoutNoise)) {
    queries.push(cleanWithoutNoise);
  }

  if (rawArtist && coreTitle && !queries.includes(coreTitle + ' ' + rawArtist)) {
    queries.push(coreTitle + ' ' + rawArtist);
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
function pickBestMatch(allResults, cleanTitle, cleanArtist, bookTitle = '') {
  if (!allResults || !allResults.length) return null;
  return allResults.find(s => isStrictMatch(s, cleanTitle, cleanArtist, bookTitle)) || null;
}


const kw = buildLyricKeywords('晴天', '周杰伦');
assert.ok(kw.keywords.includes('晴天'));
assert.ok(kw.keywords.includes('晴天 周杰伦'));

// Test strict matching vs unrelated results
const searchResults = [
  { id: '100', name: '完全不相干的歌曲', artist: '陌生歌手' },
  { id: '101', name: '另一首不相干的歌', artist: '路人' }
];
const matchUnrelated = pickBestMatch(searchResults, '晴天', '周杰伦');
assert.strictEqual(matchUnrelated, null, 'Unrelated songs must return null');

// BV1TVpE6dE5x: niche vocaloid song with no CC subtitles must NOT match unrelated Adachi Rei songs
const adachiSearchResults = [
  { id: '301', name: 'Bubblyday Everyday feat. Adachi Rei', artist: '夜静海/足立レイ' },
  { id: '302', name: '熱異常 (feat. 足立レイ)', artist: 'いよわ/足立レイ' },
  { id: '303', name: 'これからバーブ', artist: '稲むり、足立レイ、初音ミク' }
];
const titleBV1TVpE6dE5x = 'これが「　」ならば feat.足立レイ/If this is " " then feat. Adachi Rei　【公式】';
const matchBV = pickBestMatch(adachiSearchResults, titleBV1TVpE6dE5x, 'Jumb_Official');
assert.strictEqual(matchBV, null, 'BV1TVpE6dE5x must NOT match unrelated Adachi Rei songs');

const searchWithMatch = [
  { id: '200', name: '晴天', artist: '周杰伦' },
  { id: '201', name: '晴天 (伴奏)', artist: '周杰伦' }
];
const matchRelated = pickBestMatch(searchWithMatch, '晴天', '周杰伦');
assert.strictEqual(matchRelated.id, '200', 'Should match exact song');

console.log('✓ Strict keyword generation and relevance matching tests passed.');

// Test 6: resolveCookieHeader tests
assert.strictEqual(resolveCookieHeader({ SESSDATA: 'abc', bili_jct: 'def' }), 'SESSDATA=abc; bili_jct=def');
assert.strictEqual(resolveCookieHeader(['SESSDATA=abc', 'bili_jct=def']), 'SESSDATA=abc; bili_jct=def');
assert.strictEqual(resolveCookieHeader({ cookies: { SESSDATA: 'abc' } }), 'SESSDATA=abc');
assert.strictEqual(typeof resolveCookieHeader(null), 'string');
console.log('✓ resolveCookieHeader tests passed.');

// Test 7: subtitle_url_v2 fallback and needLogin handling
const mockV2Sub = [
  { id: 99, lan: 'zh-CN', lan_doc: '中文', ai_type: 0, type: 0, subtitle_url_v2: '//sub/v2.json' }
];
const pickedV2 = pickSubtitles(mockV2Sub);
assert.strictEqual(pickedV2.main.id, 99);
assert.strictEqual(pickedV2.main.subtitle_url_v2, '//sub/v2.json');

(async () => {
  const mockApiNeedLogin = {
    getVideoSubtitles: async () => ({
      code: 0,
      data: { subtitles: [], needLogin: true }
    })
  };
  const res = await getBilibiliSubtitle('BVmock', 12345, mockApiNeedLogin);
  assert.strictEqual(res.needLogin, true, 'Should preserve needLogin flag');
  assert.strictEqual(res.lrc, '', 'LRC should be empty when login is needed');
  console.log('✓ needLogin and subtitle_url_v2 fallback tests passed.');

  console.log('[test:subtitle] All Bilibili CC subtitle tests passed!');
  process.exit(0);
})();
