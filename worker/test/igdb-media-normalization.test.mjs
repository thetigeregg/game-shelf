import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIgdbScreenshotList,
  normalizeIgdbVideoList
} from '../../shared/igdb-media-normalization.mjs';

test('normalizeIgdbScreenshotList handles defaults, dedupe, ids, and cap', () => {
  const normalized = normalizeIgdbScreenshotList(
    [
      null,
      { id: '5', image_id: '  abc  ', width: '1280', height: '720' },
      { id: 5, image_id: 'abc', width: 2000, height: 1000 },
      { imageId: 'def', width: 0, height: 'x' },
      { imageId: 'ghi' }
    ],
    { limit: 2 }
  );

  assert.deepEqual(normalized, [
    {
      id: 5,
      imageId: 'abc',
      url: 'https://images.igdb.com/igdb/image/upload/t_screenshot_huge/abc.jpg',
      width: 1280,
      height: 720
    },
    {
      id: null,
      imageId: 'def',
      url: 'https://images.igdb.com/igdb/image/upload/t_screenshot_huge/def.jpg',
      width: null,
      height: null
    }
  ]);
});

test('normalizeIgdbScreenshotList supports custom size and ignores invalid input', () => {
  const withCustomSize = normalizeIgdbScreenshotList([{ image_id: 'xyz' }], {
    size: 't_screenshot_big',
    limit: 1
  });
  assert.equal(
    withCustomSize[0]?.url,
    'https://images.igdb.com/igdb/image/upload/t_screenshot_big/xyz.jpg'
  );

  const withBlankSize = normalizeIgdbScreenshotList([{ image_id: 'xyz' }], { size: '   ' });
  assert.equal(
    withBlankSize[0]?.url,
    'https://images.igdb.com/igdb/image/upload/t_screenshot_huge/xyz.jpg'
  );

  assert.deepEqual(normalizeIgdbScreenshotList(undefined), []);
  assert.deepEqual(normalizeIgdbScreenshotList('bad'), []);
});

test('normalizeIgdbVideoList handles trimming, dedupe, ids, and URL encoding', () => {
  const normalized = normalizeIgdbVideoList(
    [
      null,
      { id: '9', name: '  Trailer  ', video_id: 'PIF_fqFZEuk' },
      { id: 9, name: 'duplicate', video_id: 'DUPLICATE11' },
      { id: -1, name: '', videoId: 'a b c' },
      { id: null, name: 'Also duplicate', videoId: 'a b c' }
    ],
    { limit: 3 }
  );

  assert.deepEqual(normalized, [
    {
      id: 9,
      name: 'Trailer',
      videoId: 'PIF_fqFZEuk',
      url: 'https://www.youtube.com/watch?v=PIF_fqFZEuk'
    },
    {
      id: null,
      name: null,
      videoId: 'a b c',
      url: 'https://www.youtube.com/watch?v=a%20b%20c'
    }
  ]);
});

test('normalizeIgdbVideoList applies default limits and rejects invalid input', () => {
  const many = Array.from({ length: 10 }, (_, index) => ({
    video_id: `abcdefghij${String(index)}`
  }));
  const capped = normalizeIgdbVideoList(many);
  assert.equal(capped.length, 5);

  assert.deepEqual(normalizeIgdbVideoList(undefined), []);
  assert.deepEqual(normalizeIgdbVideoList('bad', { limit: 0 }), []);
});
