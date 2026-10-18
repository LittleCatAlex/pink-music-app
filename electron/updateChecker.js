/**
 * 版本更新检查
 * 数据源：GitHub REST API —— GET /repos/:owner/:repo/releases/latest
 *   - 未鉴权限流 60 次/小时/IP，故结果带 TTL 缓存（默认 6 小时）
 *   - GitHub 要求请求带 User-Agent
 *   - releases/latest 自动排除 draft / prerelease
 * 仅做「检查 + 展示 + 跳转」，不负责下载安装。
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { app } = require('electron');

const REPO = 'Rayson-Liu/pink-music-app';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function cacheFile() {
  return path.join(app.getPath('userData'), 'update-check.json');
}

function readCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    if (raw && raw.at && raw.data && Date.now() - raw.at < CACHE_TTL_MS) {
      return raw;
    }
  } catch (_) { /* 缓存缺失/损坏按无缓存处理 */ }
  return null;
}

function writeCache(data) {
  try {
    fs.writeFileSync(cacheFile(), JSON.stringify({ at: Date.now(), data }), 'utf8');
  } catch (e) {
    console.warn('[updateChecker] 写入缓存失败:', e.message);
  }
}

/** 'v2.6.0' / '2.6' → [2, 6, 0] */
function parseVersion(v) {
  return String(v || '').trim().replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
}

/** 远端是否比本地新（缺位补 0 比较） */
function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function buildResult(currentVersion, rel) {
  if (!rel) {
    return { code: 0, currentVersion, hasUpdate: false, latest: null, checkedAt: Date.now() };
  }
  const latestVersion = String(rel.tag_name || '').replace(/^v/i, '');
  return {
    code: 0,
    currentVersion,
    hasUpdate: isNewer(latestVersion, currentVersion),
    checkedAt: Date.now(),
    latest: {
      version: latestVersion,
      name: rel.name || rel.tag_name || '',
      notes: rel.body || '',
      publishedAt: rel.published_at || '',
      htmlUrl: rel.html_url || RELEASES_PAGE,
      prerelease: !!rel.prerelease
    }
  };
}

/**
 * @param {{ force?: boolean }} [opts] force=true 时绕过缓存（手动检查）
 * @returns {Promise<object>} 统一结构，code=0 成功；code=-1 失败
 */
async function checkForUpdates(opts = {}) {
  const force = !!opts.force;
  const currentVersion = app.getVersion();

  if (!force) {
    const cached = readCache();
    if (cached) return { ...cached.data, cached: true };
  }

  try {
    const res = await axios.get(API_URL, {
      timeout: 8000,
      headers: {
        'User-Agent': `PinkMusic/${currentVersion}`,
        Accept: 'application/vnd.github+json'
      },
      validateStatus: () => true
    });

    // 仓库暂无 release（404）→ 视为已是最新
    if (res.status === 404) {
      const result = buildResult(currentVersion, null);
      writeCache(result);
      return result;
    }
    if (res.status !== 200) {
      return {
        code: -1,
        currentVersion,
        error: res.status === 403 ? 'rate_limited' : `http_${res.status}`
      };
    }

    const result = buildResult(currentVersion, res.data);
    writeCache(result);
    return result;
  } catch (e) {
    return { code: -1, currentVersion, error: 'network', message: e.message };
  }
}

module.exports = { checkForUpdates, REPO, RELEASES_PAGE };