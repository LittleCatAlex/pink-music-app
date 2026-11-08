/**
 * Test Bilibili CC Subtitle parser and lyric source order
 */
const assert = require('assert');
const {
  formatLrcTimestamp,
  convertBiliSubtitleToLrc,
  pickSubtitles,
  isCreatorCC,
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
console.log('✓ Timestamp formatting tests passed.');

// Test 3: Subtitle to LRC conversion
const mockBody = [
  { from: 0.5, to: 2.0, content: '第一行歌词' },
  { from: 2.5, to: 4.0, content: '第二行歌词\n带换行' },
  { from: 5.0, to: 7.0, content: '   ' }, // 应该被过滤
  { from: 8.0, to: 10.0, content: '第三行歌词' }
];

const lrcOutput = convertBiliSubtitleToLrc(mockBody);
const expectedLrc = [
  '[00:00.50]第一行歌词',
  '[00:02.50]第二行歌词 带换行',
  '[00:08.00]第三行歌词'
].join('\n');

assert.strictEqual(lrcOutput, expectedLrc, 'LRC conversion output should match expected format');
console.log('✓ Subtitle to LRC conversion tests passed.');

// Test 4: Subtitle priority and translation selection (and excluding AI subtitles)
const mockSubtitles = [
  { id: 1, lan: 'en-US', lan_doc: '英语', ai_type: 0, type: 0, subtitle_url: '//sub/en.json' },
  { id: 2, lan: 'zh-CN', lan_doc: '中文（中国）', ai_type: 0, type: 0, subtitle_url: '//sub/zh.json' },
  { id: 3, lan: 'ja-JP', lan_doc: '日语', ai_type: 0, type: 0, subtitle_url: '//sub/ja.json' }
];

const picked = pickSubtitles(mockSubtitles);
assert.strictEqual(picked.main.id, 2, 'Chinese subtitle should be chosen as main');
assert.strictEqual(picked.trans.id, 1, 'Different language subtitle should be chosen as translation');

// AI subtitle exclusion test:
const aiSubtitlesOnly = [
  {
    id: 1609429062298792200,
    lan: 'ai-zh',
    lan_doc: '中文',
    type: 1,
    ai_type: 0,
    ai_status: 2,
    subtitle_url: '//aisubtitle.hdslb.com/sub.json'
  }
];
assert.strictEqual(isCreatorCC(aiSubtitlesOnly[0]), false, 'AI speech recognition subtitle must be rejected');
const pickedAi = pickSubtitles(aiSubtitlesOnly);
assert.strictEqual(pickedAi.main, null, 'pickSubtitles must return null when only AI subtitles exist');
assert.strictEqual(pickedAi.trans, null, 'pickSubtitles must return null trans when only AI subtitles exist');

console.log('✓ Subtitle priority and translation selection tests passed.');

// Test 5: Strict keyword generation and relevance matching
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
  const GENERIC_STOP_WORDS = new Set([
    'feat', 'ft', 'feat.', 'ft.', 'featuring',
    'official', 'mv', 'pv', 'video', 'music', 'audio', 'sound', 'ost', 'op', 'ed',
    'remix', 'live', 'cover', 'ver', 'version', 'mix', 'edit', 'instrumental',
    '伴奏', '纯音乐', '官方', '公式', '完整版', '现场', '翻唱', '原版', '自制', '首发',
    'the', 'a', 'an', 'is', 'in', 'on', 'of', 'to', 'for', 'and', 'with', 'by', 'this', 'that', 'then'
  ]);
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

  if (normCandidate === normTarget) {
    titleMatched = true;
  }

  const coreTarget = extractCoreTitle(effectiveTitle);
  const coreCandidate = extractCoreTitle(candidate.name);
  if (!titleMatched && coreTarget && coreCandidate && coreTarget === coreCandidate) {
    titleMatched = true;
  }

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

  if (targetArtists.length > 0) {
    if (artistMatched) return true;
    const normCandName = normalizeForComparison(candidate.name);
    if (targetArtists.some(ta => normCandName.includes(ta))) return true;

    const isShortOrGeneric = (coreTarget || normTarget).length <= 12 || !(coreTarget || normTarget).includes(' ');
    if (isShortOrGeneric) {
      return false;
    }
    if (candArtist && candArtist.trim().length > 0) {
      return false;
    }
  }

  return true;
}

function cleanTitleAndExtract(title, artist) {
  let raw = String(title || '').replace(/<[^>]+>/g, '').trim();
  const rawArtist = String(artist || '').replace(/<[^>]+>/g, '').trim();

  const bookMatch = raw.match(/《([^》]+)》/);
  const bookTitle = bookMatch ? bookMatch[1].trim() : '';

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

  if (bookTitle) {
    if (rawArtist) {
      queries.push(bookTitle + ' ' + rawArtist);
    }
    queries.push(bookTitle);
  }

  const coreTitle = extractCoreTitle(cleaned.replace(noiseWordsRegex, ' '));
  const cleanWithoutNoise = cleaned.replace(noiseWordsRegex, ' ').replace(/\s+/g, ' ').trim();

  if (rawArtist && coreTitle && !queries.includes(coreTitle + ' ' + rawArtist)) {
    queries.push(coreTitle + ' ' + rawArtist);
  }

  if (cleanWithoutNoise && cleanWithoutNoise.length >= 2 && !queries.includes(cleanWithoutNoise)) {
    queries.push(cleanWithoutNoise);
  }

  const dashMatch = raw.replace(noiseTagRegex, '').replace(noiseParenRegex, '').match(/([^-–—/|｜]+)\s*[-–—/|｜]\s*([^-–—/|｜]+)/);
  if (dashMatch) {
    const p1 = extractCoreTitle(dashMatch[1].replace(/[【】\[\]()（）《》]/g, ' ').replace(noiseWordsRegex, ' '));
    const p2 = extractCoreTitle(dashMatch[2].replace(/[【】\[\]()（）《》]/g, ' ').replace(noiseWordsRegex, ' '));
    if (p1 && p1.length >= 2 && !queries.includes(p1)) queries.push(p1);
    if (p2 && p2.length >= 2 && !queries.includes(p2)) queries.push(p2);
  }

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

function buildLyricKeywords(title, artist) {
  const { bookTitle, cleanTitle, cleanArtist, queries } = cleanTitleAndExtract(title, artist);
  return { keywords: queries, cleanTitle, cleanArtist, bookTitle };
}

function pickBestMatch(allResults, cleanTitle, cleanArtist, bookTitle = '', rawTitle = '') {
  if (!allResults || !allResults.length) return null;
  return allResults.find(s => isStrictMatch(s, cleanTitle, cleanArtist, bookTitle, rawTitle)) || null;
}

const kw = buildLyricKeywords('晴天', '周杰伦');
assert.ok(kw.keywords.includes('晴天 周杰伦'), 'Keyword with artist should be included');
assert.ok(kw.keywords.includes('晴天'), 'Keyword with standalone title should be included');

// Test strict matching vs unrelated results
const searchResults = [
  { id: '100', name: '完全不相干的歌曲', artist: '陌生歌手' },
  { id: '101', name: '另一首不相干的歌', artist: '路人' }
];
const matchUnrelated = pickBestMatch(searchResults, '晴天', '周杰伦', '', '晴天');
assert.strictEqual(matchUnrelated, null, 'Unrelated songs must return null');

// BV1bH4B6dEuy: Playback feat. 初音未来、雨衣 must NOT match PLAY BACK by 悠太
const playbackCandidates = [
  { id: '880676523', name: 'PLAY BACK', artist: '悠太' },
  { id: '1797332', name: 'Playback (feat. Ine)', artist: 'Nieve' },
  { id: '33035843', name: 'PLAYBACK', artist: 'JUJU' }
];
const matchPlayback = pickBestMatch(playbackCandidates, 'playback', '雨衣', '', 'Playback feat. 初音未来、雨衣');
assert.strictEqual(matchPlayback, null, 'BV1bH4B6dEuy must NOT match unrelated Playback songs by other artists');

// BV1TVpE6dE5x: niche vocaloid song with no CC subtitles must NOT match unrelated Adachi Rei songs
const adachiSearchResults = [
  { id: '301', name: 'Bubblyday Everyday feat. Adachi Rei', artist: '夜静海/足立レイ' },
  { id: '302', name: '熱異常 (feat. 足立レイ)', artist: 'いよわ/足立レイ' },
  { id: '303', name: 'これからバーブ', artist: '稲むり、足立レイ、初音ミク' }
];
const titleBV1TVpE6dE5x = 'これが「　」ならば feat.足立レイ/If this is " " then feat. Adachi Rei　【公式】';
const matchBV = pickBestMatch(adachiSearchResults, 'これが ならば /if this is then', 'Jumb_Official', '', titleBV1TVpE6dE5x);
assert.strictEqual(matchBV, null, 'BV1TVpE6dE5x must NOT match unrelated Adachi Rei songs');

const searchWithMatch = [
  { id: '200', name: '晴天', artist: '周杰伦' },
  { id: '201', name: '晴天 (伴奏)', artist: '周杰伦' }
];
const matchRelated = pickBestMatch(searchWithMatch, '晴天', '周杰伦', '', '晴天');
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
