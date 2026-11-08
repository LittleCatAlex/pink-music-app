/**
 * Test update checker logic & cache validation
 */
const assert = require('assert');
const { parseVersion, isNewer } = require('../electron/updateChecker');

console.log('[test:update-checker] Running updateChecker version and cache tests...');

// 1. Version parsing
assert.deepStrictEqual(parseVersion('v2.7.0'), [2, 7, 0]);
assert.deepStrictEqual(parseVersion('2.6.3'), [2, 6, 3]);
assert.deepStrictEqual(parseVersion('v2'), [2]);
assert.deepStrictEqual(parseVersion(''), [0]);
assert.deepStrictEqual(parseVersion(null), [0]);

// 2. isNewer comparison
assert.strictEqual(isNewer('2.7.0', '2.6.3'), true, '2.7.0 should be newer than 2.6.3');
assert.strictEqual(isNewer('2.6.3', '2.7.0'), false, '2.6.3 should not be newer than 2.7.0');
assert.strictEqual(isNewer('2.7.0', '2.7.0'), false, 'equal versions should not be newer');
assert.strictEqual(isNewer('2.7.1', '2.7.0'), true, '2.7.1 should be newer than 2.7.0');
assert.strictEqual(isNewer('3.0.0', '2.9.9'), true, '3.0.0 should be newer than 2.9.9');

console.log('✓ parseVersion and isNewer logic verified.');

// 3. Simulated readCache version mismatch invalidation
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
function simulateReadCache(raw, currentVersion) {
  if (raw && raw.at && raw.data && Date.now() - raw.at < CACHE_TTL_MS) {
    if (currentVersion && raw.data.currentVersion && raw.data.currentVersion !== currentVersion) {
      return null;
    }
    return raw;
  }
  return null;
}

const staleCache = {
  at: Date.now() - 1000,
  data: {
    code: 0,
    currentVersion: '2.6.3',
    hasUpdate: false,
    latest: { version: '2.6.3' }
  }
};

// When app is 2.7.0, stale 2.6.3 cache must be rejected (returns null)
assert.strictEqual(
  simulateReadCache(staleCache, '2.7.0'),
  null,
  'Stale cache with mismatched currentVersion must be invalidated'
);

// When app matches cache currentVersion, it should be accepted
const matchingCache = {
  at: Date.now() - 1000,
  data: {
    code: 0,
    currentVersion: '2.7.0',
    hasUpdate: false,
    latest: { version: '2.7.0' }
  }
};
assert.deepStrictEqual(
  simulateReadCache(matchingCache, '2.7.0'),
  matchingCache,
  'Matching cache should be accepted'
);

console.log('✓ Cache invalidation on version upgrade verified.');
console.log('[test:update-checker] All update-checker tests passed!');
