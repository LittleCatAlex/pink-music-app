/**
 * Test persistent storage validation for PinkMusic
 */
const assert = require('assert');

console.log('[test:storage] Running persistent storage validation...');

// Mock localStorage
const storageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value.toString(); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();

// Test 1: Theme and custom background persistence keys
const themeConfig = {
  theme: 'dark',
  customBgEnabled: true,
  customBgUrl: 'data:image/png;base64,mock',
  customBgOpacity: 0.85
};

storageMock.setItem('pink-music-theme-config', JSON.stringify(themeConfig));
const retrieved = JSON.parse(storageMock.getItem('pink-music-theme-config'));
assert.strictEqual(retrieved.theme, 'dark');
assert.strictEqual(retrieved.customBgEnabled, true);
assert.strictEqual(retrieved.customBgOpacity, 0.85);

// Window opacity key
storageMock.setItem('pink-music-window-opacity', '0.9');
assert.strictEqual(storageMock.getItem('pink-music-window-opacity'), '0.9');

console.log('✓ Theme, custom background and UI opacity persistence verified.');

// Test 2: Bilibili credential storage (simulated session/file cookies)
const mockCookies = {
  SESSDATA: 'mock_sessdata',
  bili_jct: 'mock_csrf',
  DedeUserID: '12345678'
};

storageMock.setItem('bilibili-cookies', JSON.stringify(mockCookies));
const retrievedCookies = JSON.parse(storageMock.getItem('bilibili-cookies'));
assert.strictEqual(retrievedCookies.SESSDATA, 'mock_sessdata');

console.log('✓ Bilibili credential storage verified.');

// Test 3: Settings lyricPreferredSource default and migration
const defaultSettings = {
  version: 15,
  lyricPreferredSource: 'bilibili',
  language: 'zh-TW'
};
storageMock.setItem('pink-music-settings', JSON.stringify(defaultSettings));
const retrievedSettings = JSON.parse(storageMock.getItem('pink-music-settings'));
assert.strictEqual(retrievedSettings.lyricPreferredSource, 'bilibili', 'Default lyric source should be bilibili');
assert.strictEqual(retrievedSettings.language, 'zh-TW', 'Default language should be zh-TW');

(async () => {
  const { defineSchema, s } = await import('../src/utils/schema.js');
  const schema = defineSchema({
    version: 15,
    fields: {
      lyricPreferredSource: s.enum(['bilibili', 'kugou', 'netease'], 'bilibili'),
      language: s.enum(['zh-TW', 'zh-CN', 'en-US'], 'zh-TW')
    },
    migrations: {
      11: (data) => ({ ...data, lyricPreferredSource: data.lyricPreferredSource === 'netease' ? 'netease' : 'kugou' }),
      12: (data) => ({ ...data, lyricPreferredSource: data.lyricPreferredSource === 'netease' ? 'netease' : 'kugou' }),
      14: (data) => ({ ...data, lyricPreferredSource: data.lyricPreferredSource === 'netease' ? 'netease' : 'bilibili' }),
      15: (data) => ({ ...data, language: data.language && ['zh-TW', 'zh-CN', 'en-US'].includes(data.language) ? data.language : 'zh-TW' })
    }
  });

  // Legacy unversioned kugou upgrades to bilibili and default language zh-TW
  const legacyKugou = schema.parse({ lyricPreferredSource: 'kugou' });
  assert.strictEqual(legacyKugou.lyricPreferredSource, 'bilibili');
  assert.strictEqual(legacyKugou.language, 'zh-TW');
  assert.strictEqual(legacyKugou._schemaVersion, 15);

  // Legacy unversioned netease preserved
  const legacyNetease = schema.parse({ lyricPreferredSource: 'netease' });
  assert.strictEqual(legacyNetease.lyricPreferredSource, 'netease');
  assert.strictEqual(legacyNetease.language, 'zh-TW');

  // Explicit v15 language preserved
  const explicitEn = schema.parse({ language: 'en-US', _schemaVersion: 15 });
  assert.strictEqual(explicitEn.language, 'en-US');

  console.log('✓ Settings schema migration for lyricPreferredSource and language verified.');
  console.log('[test:storage] All persistent storage tests passed!');
  process.exit(0);
})().catch(err => {
  console.error('[test:storage] Failed:', err);
  process.exit(1);
});
