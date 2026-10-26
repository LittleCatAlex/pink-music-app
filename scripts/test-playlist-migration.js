/**
 * Test playlist data migration and deduplication logic
 */
const assert = require('assert');

console.log('[test:playlist] Running playlist migration and integrity validation...');

// Test 1: Favorite item normalization
function normalizeMediaItem(item) {
  const bvid = item.bvid || item.bv_id || item.id || '';
  const cid = item.cid || item.ugc?.first_cid || 0;
  return {
    bvid,
    cid,
    favId: item.id,
    favType: item.type,
    title: item.title ? item.title.replace(/<[^>]+>/g, '') : '',
    artist: item.upper?.name || item.author || '未知歌手',
    cover: item.cover || item.pic || '',
    duration: item.duration || 0,
    source: 'bilibili'
  };
}

const rawItemWithUgc = {
  id: 11223344,
  bvid: 'BV1xx411c7mD',
  title: '<em>测试歌曲</em>',
  cover: 'https://i0.hdslb.com/bfs/archive/test.jpg',
  duration: 180,
  upper: { name: 'UP主' },
  ugc: { first_cid: 99887766 }
};

const normalized = normalizeMediaItem(rawItemWithUgc);
assert.strictEqual(normalized.bvid, 'BV1xx411c7mD');
assert.strictEqual(normalized.cid, 99887766, 'Fallback to ugc.first_cid should succeed');
assert.strictEqual(normalized.title, '测试歌曲', 'HTML tags should be stripped');
assert.strictEqual(normalized.artist, 'UP主');

console.log('✓ Favorite item normalization with UGC CID fallback verified.');

// Test 2: Playlist deduplication
const playlist = {
  id: 'bili-fav-123456',
  name: '我的收藏',
  music: [
    { bvid: 'BV1xx411c7mD', cid: 99887766, title: '测试歌曲' }
  ]
};

function appendMedia(targetPlaylist, newMedias) {
  let added = 0;
  for (const item of newMedias) {
    const norm = normalizeMediaItem(item);
    const exists = targetPlaylist.music.some(m => m.bvid === norm.bvid && (!norm.cid || m.cid === norm.cid));
    if (!exists) {
      targetPlaylist.music.push(norm);
      added++;
    }
  }
  return added;
}

const duplicateMedias = [
  rawItemWithUgc, // Duplicate
  {
    id: 55667788,
    bvid: 'BV2yy411c7mE',
    title: '新歌曲',
    cover: '',
    duration: 200,
    upper: { name: '另一个歌手' },
    cid: 12345678
  }
];

const addedCount = appendMedia(playlist, duplicateMedias);
assert.strictEqual(addedCount, 1, 'Only non-duplicate song should be appended');
assert.strictEqual(playlist.music.length, 2);
assert.strictEqual(playlist.music[1].bvid, 'BV2yy411c7mE');

console.log('✓ Playlist deduplication verified.');

console.log('[test:playlist] All playlist tests passed!');
process.exit(0);
