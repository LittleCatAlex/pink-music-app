/**
 * 歌词源扩展：酷狗
 * ─────────────────────────────────────────
 * 实现参照 LyricsX-Next（Vendor/LyricsKit）的 Kugou provider，移植到 Node（主进程）。
 * KRC 是逐字时间轴格式，本应用是行级歌词模型，统一降级为行级 LRC 文本：
 *   原文  → { lrc }   每行 "[mm:ss.SSS]歌词"
 *   翻译  → { tv }    同格式（渲染层 parseLyric 就近时间匹配，原有逻辑不动）
 *   罗马音 → { rv }   KRC language 头 type==0 时可用
 * 输出与网易云完全同构 { lrc, rv, tv }，渲染层零改动。
 */

const zlib = require('zlib');
const axios = require('axios');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

/** 把毫秒时间戳格式化成 [mm:ss.SSS] LRC 时间标签 */
function msToLrcTag(ms) {
  const total = Math.max(0, Math.round(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const frac = total % 1000;
  return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(frac).padStart(3, '0')}]`;
}

// ══════════════════════ 酷狗 ══════════════════════

const KRC_XOR_KEY = Buffer.from([64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105]);

/**
 * KRC 解密（对应 LyricsKit decryptKugouKrc）：
 * base64 → 校验 "krc1" 头 → 逐字节 XOR 16 字节 key → 去前2字节 → raw deflate → utf8
 */
function decryptKrc(base64) {
  try {
    const data = Buffer.from(base64, 'base64');
    if (data.length < 8 || data.subarray(0, 4).toString('ascii') !== 'krc1') return null;
    const out = Buffer.alloc(data.length - 4);
    for (let i = 4; i < data.length; i++) {
      out[i - 4] = data[i] ^ KRC_XOR_KEY[(i - 4) & 15];
    }
    return zlib.inflateRawSync(out.subarray(2)).toString('utf8');
  } catch (_) {
    return null;
  }
}

/**
 * 解析 KRC 文本 → { lrc, tv, rv }。
 * - 行格式 "[start,dur]<start,dur,0>字..." → 行级 LRC
 * - [language:<base64>] 头：type==1 翻译 / type==0 罗马音，按行索引对齐
 *   （对应 LyricsKit KugouKrcParser：translation 取 prefix(lines.count)）
 */
function parseKrc(content) {
  const lines = [];
  let languageRaw = '';

  // 先抽 language 头（base64 JSON），再处理歌词行
  let krcBody = '';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const langMatch = line.match(/^\[language:([^\]]+)\]$/);
    if (langMatch) {
      languageRaw = langMatch[1];
      continue;
    }
    krcBody += line + '\n';
  }

  for (const line of krcBody.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    const head = l.match(/^\[(\d+),(\d+)\]/);
    if (!head) continue;
    const startMs = parseInt(head[1], 10);
    const text = l
      .slice(head[0].length)
      .replace(/<\d+,\d+,\d+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    lines.push({ time: startMs, text });
  }
  if (lines.length === 0) return null;
  const parsedLines = lines;

  const lrc = lines
    .map((it) => (it.text ? `${msToLrcTag(it.time)}${it.text}` : ''))
    .filter(Boolean)
    .join('\n');

  // language 头解析
  let tv = '';
  let rv = '';
  if (languageRaw) {
    try {
      const header = JSON.parse(Buffer.from(languageRaw, 'base64').toString('utf8'));
      const contents = Array.isArray(header?.content) ? header.content : [];
      for (const entry of contents) {
        const rows = Array.isArray(entry?.lyricContent) ? entry.lyricContent : [];
        // 按行索引对齐主歌词（LyricsKit 同款：prefix(lines.count)）
        const merged = parsedLines
          .map((it, idx) => {
            if (idx >= rows.length) return '';
            const str = Array.isArray(rows[idx]) ? rows[idx].join('') : String(rows[idx] || '');
            const s = str.trim();
            return s ? `${msToLrcTag(it.time)}${s}` : '';
          })
          .filter(Boolean)
          .join('\n');
        if (entry?.type === 1 && !tv) tv = merged;
        else if (entry?.type === 0 && !rv) rv = merged;
      }
    } catch (_) { /* language 头解析失败则无翻译/罗马音 */ }
  }

  return { lrc, tv, rv };
}

/**
 * 酷狗搜索：mobiles.kugou.com v3 API
 * 返回 [{ id(=album_audio_id), name, artist, album, duration, hash, source: 'kugou' }]
 */
async function searchKugou(keyword) {
  const url = `https://mobiles.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(keyword)}&page=1&pagesize=10&showtype=1`;
  const res = await axios.get(url, {
    headers: { 'User-Agent': BROWSER_UA },
    timeout: 10000,
  });
  const info = res.data?.data?.info;
  if (!Array.isArray(info)) return [];
  return info
    .filter((it) => it?.hash)
    .map((it) => ({
      id: String(it.album_audio_id ?? ''),
      hash: it.hash,
      name: it.songname || '',
      artist: it.singername || '',
      album: it.album_name || '',
      duration: typeof it.duration === 'number' ? it.duration * 1000 : 0,
      source: 'kugou',
    }));
}

/**
 * 酷狗取词：hash+album_audio_id → krcs 候选 → lyrics.kugou.com 下载 KRC → 解密
 */
async function getKugouLyric(song) {
  const hash = song.hash || '';
  const albumAudioId = song.id || '';
  if (!hash && !albumAudioId) return null;

  const candidatesRes = await axios.get('https://krcs.kugou.com/search', {
    params: {
      ver: 1, man: 'yes', client: 'mobi', keyword: '', duration: '',
      hash, album_audio_id: albumAudioId,
    },
    headers: { 'User-Agent': BROWSER_UA },
    timeout: 10000,
  });
  const candidates = candidatesRes.data?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const candidate = candidates[0];
  const downloadRes = await axios.get('https://lyrics.kugou.com/download', {
    params: {
      id: candidate.id, accesskey: candidate.accesskey,
      fmt: 'krc', charset: 'utf8', client: 'pc', ver: 1,
    },
    headers: { 'User-Agent': BROWSER_UA },
    timeout: 10000,
  });
  const krc = decryptKrc(downloadRes.data?.content || '');
  if (!krc) return null;
  return parseKrc(krc);
}

module.exports = {
  searchKugou,
  getKugouLyric,
};
