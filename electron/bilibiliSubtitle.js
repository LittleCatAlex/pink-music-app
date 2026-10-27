/**
 * 哔哩哔哩 CC 字幕 / AI 字幕获取与转换
 * ─────────────────────────────────────────
 * 将 B 站视频 CC 字幕 JSON 数据格式转换为行级 LRC 歌词：
 *   原文  → { lrc }   每行 "[mm:ss.xx]歌词"
 *   翻译  → { tv }    多语言字幕时作为翻译轨
 *   罗马音 → { rv }   空字符串
 * 输出与网易云/酷狗完全同构 { lrc, rv, tv }。
 */

const axios = require('axios');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 把秒数（浮点数）转换为 [mm:ss.xx] 标准 LRC 时间标签 */
function formatLrcTimestamp(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const m = Math.floor(totalMs / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const cs = Math.floor((totalMs % 1000) / 10);
  return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}]`;
}

/**
 * 将 B 站字幕 body 数组转换为 LRC 文本
 * @param {Array<{ from: number, to: number, content: string }>} body
 * @returns {string}
 */
function convertBiliSubtitleToLrc(body) {
  if (!Array.isArray(body) || body.length === 0) return '';
  const lines = [];
  for (const item of body) {
    if (!item || typeof item.from !== 'number' || item.content === undefined || item.content === null) continue;
    const text = String(item.content).replace(/[\r\n]+/g, ' ').trim();
    if (!text) continue;
    const timeTag = formatLrcTimestamp(item.from);
    lines.push(`${timeTag}${text}`);
  }
  return lines.join('\n');
}

/**
 * 从字幕列表中挑选主字幕和辅助翻译字幕
 * @param {Array<object>} subtitles
 * @returns {{ main: object|null, trans: object|null }}
 */
function pickSubtitles(subtitles) {
  if (!Array.isArray(subtitles) || subtitles.length === 0) return { main: null, trans: null };

  const isZh = (s) => (s.lan || '').toLowerCase().startsWith('zh') || (s.lan_doc || '').includes('中');
  // 人工 CC 字幕优先于 AI 生成字幕
  const manual = subtitles.filter(s => s.ai_type === 0 || s.type === 0);
  const ai = subtitles.filter(s => s.ai_type !== 0 && s.type !== 0);

  // 主字幕：人工中文 -> 人工其他 -> AI 中文 -> AI 其他
  let main = manual.find(isZh) || manual[0] || ai.find(isZh) || ai[0];

  // 辅助翻译字幕：如果有不同语言的字幕，作为 tv
  let trans = null;
  if (main) {
    trans = subtitles.find(s => s !== main && s.lan !== main.lan) || null;
  }

  return { main, trans };
}

/**
 * 下载并解析字幕 JSON（支持超时重试与指数避退）
 * @param {string} subtitleUrl
 * @param {number} [retries=2]
 * @param {number} [delayMs=500]
 * @returns {Promise<Array<object>|null>}
 */
async function fetchSubtitleBody(subtitleUrl, retries = 2, delayMs = 500) {
  if (!subtitleUrl) return null;
  const url = subtitleUrl.startsWith('//') ? `https:${subtitleUrl}` : subtitleUrl;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': BROWSER_UA
        }
      });
      if (res.data && Array.isArray(res.data.body)) {
        return res.data.body;
      }
      return null;
    } catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
      } else {
        console.error('下载 B 站 CC 字幕失败:', url, err.message);
      }
    }
  }
  return null;
}

/**
 * 获取 B 站 CC 字幕并转换为 { lrc, rv, tv }
 * 包含多接口回退（wbi/v2 -> player/v2 -> view）以及失败自动重试，
 * 防止因首次网络延迟或高并发请求而误回退到其他歌词源。
 *
 * @param {string} bvid
 * @param {number|string} [cid]
 * @param {object} [bilibiliAPI] 可选的 BilibiliAPI 实例
 * @param {number} [maxAttempts=2]
 * @returns {Promise<{ lrc: string, rv: string, tv: string }|null>}
 */
async function getBilibiliSubtitle(bvid, cid, bilibiliAPI, maxAttempts = 2) {
  if (!bvid) return null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      let targetCid = cid;
      // 如果没有 cid，尝试通过 pagelist 或 episodes 获取第一 P 的 cid
      if (!targetCid) {
        if (bilibiliAPI && typeof bilibiliAPI.getVideoEpisodes === 'function') {
          try {
            const ep = await bilibiliAPI.getVideoEpisodes(bvid);
            if (ep?.code === 0 && Array.isArray(ep.data) && ep.data.length > 0) {
              targetCid = ep.data[0].cid;
            }
          } catch (_) {}
        }
        if (!targetCid) {
          try {
            const res = await axios.get(`https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`, {
              timeout: 12000,
              headers: { 'User-Agent': BROWSER_UA }
            });
            if (res.data?.code === 0 && Array.isArray(res.data.data) && res.data.data.length > 0) {
              targetCid = res.data.data[0].cid;
            }
          } catch (_) {}
        }
      }

      let subtitleData = null;

      // 1. 优先通过主进程 bilibiliAPI 获取
      if (bilibiliAPI && typeof bilibiliAPI.getVideoSubtitles === 'function' && targetCid) {
        try {
          const res = await bilibiliAPI.getVideoSubtitles(bvid, targetCid);
          if (res?.code === 0 && Array.isArray(res.data?.subtitles) && res.data.subtitles.length > 0) {
            subtitleData = res.data.subtitles;
          }
        } catch (_) {}
      }

      // 2. 若 bilibiliAPI 未取到或不可用，直连请求 B 站播放器 v2 接口（先尝试 wbi/v2，再尝试 v2）
      if (!subtitleData && targetCid) {
        try {
          const res = await axios.get(`https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(targetCid)}`, {
            timeout: 12000,
            headers: {
              'User-Agent': BROWSER_UA,
              'Referer': `https://www.bilibili.com/video/${bvid}`
            }
          });
          const subs = res.data?.data?.subtitle?.subtitles;
          if (Array.isArray(subs) && subs.length > 0) {
            subtitleData = subs;
          }
        } catch (_) {}
      }

      if (!subtitleData && targetCid) {
        try {
          const resV2 = await axios.get(`https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(targetCid)}`, {
            timeout: 12000,
            headers: {
              'User-Agent': BROWSER_UA,
              'Referer': `https://www.bilibili.com/video/${bvid}`
            }
          });
          const subsV2 = resV2.data?.data?.subtitle?.subtitles;
          if (Array.isArray(subsV2) && subsV2.length > 0) {
            subtitleData = subsV2;
          }
        } catch (_) {}
      }

      // 3. 兜底尝试 /x/web-interface/view
      if (!subtitleData) {
        try {
          const viewRes = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
            timeout: 12000,
            headers: {
              'User-Agent': BROWSER_UA,
              'Referer': `https://www.bilibili.com/video/${bvid}`
            }
          });
          const viewSubs = viewRes.data?.data?.subtitle?.list || viewRes.data?.data?.subtitle?.subtitles;
          if (Array.isArray(viewSubs) && viewSubs.length > 0) {
            subtitleData = viewSubs;
          }
        } catch (_) {}
      }

      if (Array.isArray(subtitleData) && subtitleData.length > 0) {
        const { main, trans } = pickSubtitles(subtitleData);
        if (main && main.subtitle_url) {
          const mainBody = await fetchSubtitleBody(main.subtitle_url);
          if (mainBody && mainBody.length > 0) {
            const lrc = convertBiliSubtitleToLrc(mainBody);
            if (lrc) {
              let tv = '';
              if (trans && trans.subtitle_url) {
                const transBody = await fetchSubtitleBody(trans.subtitle_url);
                if (transBody && transBody.length > 0) {
                  tv = convertBiliSubtitleToLrc(transBody);
                }
              }
              return { lrc, rv: '', tv };
            }
          }
        }
      }

      // 若首次尝试失败，在重试前等待短暂避退
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 600));
      }
    } catch (error) {
      console.error('获取 B 站 CC 字幕异常 (attempt ' + (attempt + 1) + '):', bvid, cid, error.message);
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 600));
      }
    }
  }
  return null;
}

module.exports = {
  getBilibiliSubtitle,
  convertBiliSubtitleToLrc,
  formatLrcTimestamp,
  pickSubtitles,
  fetchSubtitleBody
};
