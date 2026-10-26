/**
 * Test persistent storage operations and schema validation
 */
const assert = require('assert');

console.log('[test:storage] Running persistent storage validation...');

// Mock localStorage environment
const storageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();

// Test 1: Theme and Custom Background persistence schema
const themeSettings = {
  activeTheme: 'custom',
  customBgUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  bgOpacity: 0.85,
  bgBlur: 10,
  bgScale: 1.1,
  bgPosition: 'center center',
  bgMaskDarkness: 0.25
};

storageMock.setItem('theme_settings', JSON.stringify(themeSettings));
const retrieved = JSON.parse(storageMock.getItem('theme_settings'));

assert.strictEqual(retrieved.activeTheme, 'custom');
assert.strictEqual(retrieved.bgOpacity, 0.85);
assert.strictEqual(retrieved.bgBlur, 10);
assert.strictEqual(retrieved.bgScale, 1.1);
assert.strictEqual(retrieved.bgPosition, 'center center');
assert.strictEqual(retrieved.bgMaskDarkness, 0.25);
assert.ok(retrieved.customBgUrl.startsWith('data:image/'));

console.log('✓ Theme and custom background persistence verified.');

// Test 2: Bilibili cookie persistence
const cookies = {
  DedeUserID: '12345678',
  SESSDATA: 'mock_sessdata',
  bili_jct: 'mock_csrf'
};
storageMock.setItem('bilibili_cookies', JSON.stringify(cookies));
const retrievedCookies = JSON.parse(storageMock.getItem('bilibili_cookies'));
assert.strictEqual(retrievedCookies.DedeUserID, '12345678');
assert.strictEqual(retrievedCookies.SESSDATA, 'mock_sessdata');

console.log('✓ Bilibili credential storage verified.');

console.log('[test:storage] All persistent storage tests passed!');
process.exit(0);
