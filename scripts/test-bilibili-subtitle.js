/**
 * Test Bilibili CC Subtitle parser and lyric source order
 */
const assert = require('assert');
const {
  formatLrcTimestamp,
  convertBiliSubtitleToLrc,
  pickSubtitles
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
function cleanLyricKeyword(raw) {
  return String(raw || '')
    .replace(/<[^>]+>/g, '')
    .replace(/[【】\[\]（）()《》<>「」『』]/g, ' ')
    .replace(/·|♪|♫|｜|\||~|～/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLyricKeywords(title, artist) {
  const cleanTitle = cleanLyricKeyword(title);
  const cleanArtist = cleanLyricKeyword(artist);

  const keywords = [];
  if (cleanTitle && cleanArtist) {
    keywords.push(`${cleanTitle} ${cleanArtist}`);
  }
  if (cleanTitle) {
    keywords.push(cleanTitle);
  }
  if (title && !keywords.includes(title)) {
    keywords.push(title);
  }

  return { keywords, cleanTitle, cleanArtist };
}

function pickBestMatch(allResults, cleanTitle, cleanArtist) {
  if (!allResults || !allResults.length) return null;

  let matchedSong = null;

  if (cleanArtist) {
    const artistMain = cleanArtist.split(/[、,，&/\\\s]+/)[0].trim().toLowerCase();
    matchedSong = allResults.find(song => {
      const sArtist = (song.artist || '').toLowerCase();
      const sName = (song.name || '').toLowerCase();
      return (artistMain && sArtist.includes(artistMain)) ||
             (cleanTitle && sName === cleanTitle.toLowerCase());
    });
  }

  if (!matchedSong && cleanTitle) {
    const t = cleanTitle.toLowerCase();
    matchedSong = allResults.find(song => {
      const sName = (song.name || '').toLowerCase();
      return sName === t || sName.includes(t) || t.includes(sName);
    });
  }

  if (!matchedSong && allResults[0]) {
    const first = allResults[0];
    const sName = (first.name || '').toLowerCase();
    const sArtist = (first.artist || '').toLowerCase();
    const t = (cleanTitle || '').toLowerCase();
    const a = (cleanArtist || '').toLowerCase();
    if ((t && (sName.includes(t) || t.includes(sName))) || (a && (sArtist.includes(a) || a.includes(sArtist)))) {
      matchedSong = first;
    }
  }

  return matchedSong || null;
}

const kw = buildLyricKeywords('晴天', '周杰伦');
assert.ok(kw.keywords.includes('晴天 周杰伦'));
assert.ok(kw.keywords.includes('晴天'));
assert.strictEqual(kw.keywords.length, 2); // No fragmented noise candidates

// Test strict matching vs unrelated results
const searchResults = [
  { id: '100', name: '完全不相干的歌曲', artist: '陌生歌手' },
  { id: '101', name: '另一首不相干的歌', artist: '路人' }
];
const matchUnrelated = pickBestMatch(searchResults, '晴天', '周杰伦');
assert.strictEqual(matchUnrelated, null, 'Unrelated songs must return null instead of blindly picking searchResults[0]');

const searchWithMatch = [
  { id: '200', name: '晴天', artist: '周杰伦' },
  { id: '201', name: '晴天 (伴奏)', artist: '周杰伦' }
];
const matchRelated = pickBestMatch(searchWithMatch, '晴天', '周杰伦');
assert.strictEqual(matchRelated.id, '200', 'Should match exact song');

console.log('✓ Strict keyword generation and relevance matching tests passed.');

console.log('[test:subtitle] All Bilibili CC subtitle tests passed!');
process.exit(0);
