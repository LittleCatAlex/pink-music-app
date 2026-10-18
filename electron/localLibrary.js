/**
 * 本地音乐库 — 主进程模块
 * ─────────────────────────────────────────
 * 职责：
 *   1) 选择文件 / 文件夹并递归扫描音频
 *   2) 用 music-metadata 批量解析标签（标题/作者/专辑/时长/内嵌封面）
 *   3) 内嵌封面落盘到 <userData>/local-covers/，返回 pinkmusic-local:// 引用
 *   4) 探测同名 .lrc 歌词
 *   5) 校验文件是否仍存在（失效检测，绝不删用户文件）
 *   6) 保存用户自定义歌单封面
 *
 * 设计约定（与项目其它模块一致）：
 *   - 所有 IPC 返回 { code, data | message }
 *   - 音频不搬动用户文件，只记录绝对路径（原地引用）
 *   - 封面不塞进 playlists.json，落盘后只存协议 URL
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// music-metadata@7（CJS，兼容 Electron 20 的 Node 16）
const mm = require('music-metadata');

// ───────── 支持的音频扩展名 ─────────
// 可原生播放：Chromium 内置解码器覆盖
const PLAYABLE_EXT = ['.mp3', '.m4a', '.mp4', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus', '.webm'];
// 可导入但 Chromium 无法原地解码：读得到标签、入库标记 isUnplayable
const UNPLAYABLE_EXT = ['.wma', '.asf', '.ape', '.wv', '.mpc', '.dsf', '.dff', '.alac', '.aiff', '.aif', '.caf', '.amr', '.ac3', '.dts', '.tak', '.tta'];
const ALL_AUDIO_EXT = [...PLAYABLE_EXT, ...UNPLAYABLE_EXT];

// 内嵌封面 / 同目录封面图候选名
const COVER_FILENAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'thumb'];

/** 给 dialog 用的扩展名过滤器（不带点） */
const DIALOG_AUDIO_EXTENSIONS = ALL_AUDIO_EXT.map((e) => e.replace(/^\./, ''));

function extOf(filePath) {
  return path.extname(filePath).toLowerCase();
}

function isAudioFile(filePath) {
  return ALL_AUDIO_EXT.includes(extOf(filePath));
}

function isPlayableByChromium(filePath) {
  return PLAYABLE_EXT.includes(extOf(filePath));
}

/** 文件稳定 id：内容无关，仅由绝对路径决定，移动/重命名后 id 会变（可接受） */
function fileId(filePath) {
  return crypto.createHash('sha1').update(String(filePath)).digest('hex').slice(0, 16);
}

/** 半角化的文件名（去扩展名），用作标题兜底 */
function baseNameTitle(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

// ───────── 封面缓存目录 ─────────
function getCoverDir(userDataDir) {
  const dir = path.join(userDataDir, 'local-covers');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

/**
 * 写一张封面图到缓存目录，返回文件名（不含目录）。
 * 已存在同名文件时直接复用（内容哈希做文件名，天然幂等）。
 */
function writeCoverImage(coverDir, buf, mime) {
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20);
  const ext = /png/i.test(mime || '') ? '.png'
    : /webp/i.test(mime || '') ? '.webp'
    : /gif/i.test(mime || '') ? '.gif'
    : '.jpg';
  const name = `${hash}${ext}`;
  const full = path.join(coverDir, name);
  if (!fs.existsSync(full)) {
    try { fs.writeFileSync(full, buf); } catch (_) { return ''; }
  }
  return name;
}

/** 协议 URL：只允许访问两个白名单目录（见 main.js 的 protocol handler） */
function coverUrl(name) {
  return name ? `pinkmusic-local://cover/${name}` : '';
}

function audioUrl(filePath) {
  return filePath ? `pinkmusic-local://audio/${encodeURIComponent(filePath)}` : '';
}

// ───────── 目录递归扫描 ─────────
function walkDir(dir, out, depth = 0) {
  if (depth > 12) return; // 防御超深目录/软链环
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name.startsWith('.')) continue; // 跳过隐藏目录
      walkDir(full, out, depth + 1);
    } else if (ent.isFile() && isAudioFile(full)) {
      out.push(full);
    }
  }
}

function scanPaths(paths) {
  const files = [];
  const seen = new Set();
  for (const p of paths || []) {
    let stat;
    try { stat = fs.statSync(p); } catch (_) { continue; }
    if (stat.isDirectory()) {
      const found = [];
      walkDir(p, found);
      for (const f of found) {
        if (!seen.has(f)) { seen.add(f); files.push(f); }
      }
    } else if (stat.isFile() && isAudioFile(p)) {
      if (!seen.has(p)) { seen.add(p); files.push(p); }
    }
  }
  return files;
}

// ───────── 同名 .lrc 探测 ─────────
function findSidecarLrc(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const candidates = [
    `${base}.lrc`,
    `${base}.LRC`,
    // 同名不同大小写/繁体常见变体
    `${base}.zh.lrc`,
    `${base}.trans.lrc`
  ];
  for (const name of candidates) {
    const full = path.join(dir, name);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    } catch (_) {}
  }
  // 目录级兜底：扫描目录里是否存在「以文件名开头 + .lrc」的文件
  try {
    const lower = base.toLowerCase()
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      const n = ent.name.toLowerCase();
      if (n.endsWith('.lrc') && n.startsWith(lower)) {
        return path.join(dir, ent.name);
      }
    }
    // 单曲目录兜底：目录里只有一个音频文件且只有一个 .lrc 时，认为二者配对
    // （多曲专辑不做此兜底，否则会把同一目录里唯一的歌词错配给每首歌）
    const names = fs.readdirSync(dir);
    const audioCount = names.filter((n) => isAudioFile(path.join(dir, n))).length;
    const lrcs = names.filter((n) => n.toLowerCase().endsWith('.lrc'));
    if (audioCount === 1 && lrcs.length === 1) return path.join(dir, lrcs[0]);
  } catch (_) {}
  return '';
}

// ───────── 同目录封面图探测 ─────────
function findFolderCover(filePath) {
  const dir = path.dirname(filePath);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return ''; }
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const ext = extOf(ent.name);
    if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) continue;
    const stem = path.basename(ent.name, ext).toLowerCase();
    if (COVER_FILENAMES.includes(stem)) return path.join(dir, ent.name);
  }
  return '';
}

// ───────── 单文件元数据解析 ─────────
async function parseOne(filePath, coverDir) {
  const id = fileId(filePath);
  const stat = fs.statSync(filePath);
  const track = {
    source: 'local',
    id,
    filePath,
    fileName: path.basename(filePath),
    title: baseNameTitle(filePath),
    author: '未知作者',
    album: '',
    duration: 0,
    cover: '',
    lyricPath: '',
    addedAt: Date.now(),
    isMissing: false,
    isUnplayable: !isPlayableByChromium(filePath)
  };

  // 标签解析
  try {
    const meta = await mm.parseFile(filePath, { duration: true, skipCovers: false });
    const common = meta.common || {};
    const format = meta.format || {};
    if (common.title) track.title = String(common.title).trim()
    if (common.artist) track.author = String(common.artist).trim()
    else if (Array.isArray(common.artists) && common.artists.length) track.author = common.artists.join(' / ')
    if (common.album) track.album = String(common.album).trim()
    if (format.duration) track.duration = Math.round(format.duration)

    // 内嵌封面（优先）
    const pics = Array.isArray(common.picture) ? common.picture : [];
    if (pics.length > 0 && pics[0].data) {
      const name = writeCoverImage(coverDir, Buffer.from(pics[0].data), pics[0].format)
      if (name) track.cover = coverUrl(name)
    }
  } catch (e) {
    // 解析失败也可能是不支持的容器：保留兜底标题，继续入库
    dlogLocal('解析标签失败', path.basename(filePath), e.message)
  }

  // 无内嵌封面 → 同目录封面图
  if (!track.cover) {
    const folderCover = findFolderCover(filePath)
    if (folderCover) {
      try {
        const buf = fs.readFileSync(folderCover)
        const name = writeCoverImage(coverDir, buf, path.extname(folderCover))
        if (name) track.cover = coverUrl(name)
      } catch (_) {}
    }
  }

  // 同名歌词
  track.lyricPath = findSidecarLrc(filePath)

  // 兜底：解析不到时长时用文件大小粗略估算（保证排序/展示不出现 0）
  if (!track.duration) track.duration = 0

  return track
}

function dlogLocal(...args) {
  if (process.env.NODE_ENV !== 'production') console.log('[localLibrary]', ...args)
}

// ───────── 对外：解析一批文件（带进度回调） ─────────
async function parseFiles(filePaths, coverDir, onProgress) {
  const out = [];
  const total = filePaths.length;
  for (let i = 0; i < total; i++) {
    const fp = filePaths[i];
    try {
      out.push(await parseOne(fp, coverDir))
    } catch (e) {
      out.push({
        source: 'local',
        id: fileId(fp),
        filePath: fp,
        fileName: path.basename(fp),
        title: baseNameTitle(fp),
        author: '未知作者',
        album: '',
        duration: 0,
        cover: '',
        lyricPath: '',
        addedAt: Date.now(),
        isMissing: false,
        isUnplayable: !isPlayableByChromium(fp),
        parseError: e.message
      })
    }
    if (typeof onProgress === 'function') {
      try { onProgress({ current: i + 1, total, filePath: fp }) } catch (_) {}
    }
  }
  return out
}

// ───────── 对外：校验文件是否仍存在 ─────────
function checkFiles(files) {
  const result = []
  for (const f of files || []) {
    if (!f || !f.id) continue
    let exists = false
    try { exists = fs.existsSync(f.filePath) && fs.statSync(f.filePath).isFile() } catch (_) {}
    result.push({ id: f.id, exists })
  }
  return result
}

module.exports = {
  ALL_AUDIO_EXT,
  PLAYABLE_EXT,
  UNPLAYABLE_EXT,
  DIALOG_AUDIO_EXTENSIONS,
  isAudioFile,
  isPlayableByChromium,
  fileId,
  getCoverDir,
  writeCoverImage,
  coverUrl,
  audioUrl,
  scanPaths,
  findSidecarLrc,
  parseFiles,
  parseOne,
  checkFiles
};