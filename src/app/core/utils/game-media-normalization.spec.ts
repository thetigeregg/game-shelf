import { describe, expect, it } from 'vitest';
import { normalizeGameScreenshots, normalizeGameVideos } from './game-media-normalization';

describe('game-media-normalization', () => {
  it('normalizes screenshots, dedupes, caps, and canonicalizes URL', () => {
    const normalized = normalizeGameScreenshots(
      [
        null,
        { imageId: '   ' },
        { id: '7', image_id: '  abc123  ', width: '1280', height: '720' },
        { id: 7, imageId: 'abc123', width: 2000, height: 1000 },
        { id: -1, imageId: 'abc123' },
        { imageId: 'def456', width: 0, height: 'bad' },
        { imageId: 'ghi789' },
      ],
      { maxItems: 2 }
    );

    expect(normalized).toEqual([
      {
        id: 7,
        imageId: 'abc123',
        url: 'https://images.igdb.com/igdb/image/upload/t_720p/abc123.jpg',
        width: 1280,
        height: 720,
      },
      {
        id: null,
        imageId: 'abc123',
        url: 'https://images.igdb.com/igdb/image/upload/t_720p/abc123.jpg',
        width: null,
        height: null,
      },
    ]);
  });

  it('returns empty screenshots for non-array input and invalid maxItems', () => {
    expect(normalizeGameScreenshots(undefined)).toEqual([]);
    expect(normalizeGameScreenshots('bad', { maxItems: -1 })).toEqual([]);
  });

  it('normalizes videos, trims names, dedupes, caps, and canonicalizes URL', () => {
    const normalized = normalizeGameVideos(
      [
        null,
        { videoId: '   ' },
        { id: '11', name: '  Trailer  ', video_id: 'PIF_fqFZEuk' },
        { id: 11, name: 'Duplicate id', videoId: 'DIFFERENT123' },
        { id: -2, name: '', videoId: 'a b c' },
        { name: '  ', videoId: 'A_B-C123456' },
        { videoId: 'A_B-C123456' },
      ],
      { maxItems: 2 }
    );

    expect(normalized).toEqual([
      {
        id: 11,
        name: 'Trailer',
        videoId: 'PIF_fqFZEuk',
        url: 'https://www.youtube.com/watch?v=PIF_fqFZEuk',
      },
      {
        id: null,
        name: null,
        videoId: 'a b c',
        url: 'https://www.youtube.com/watch?v=a%20b%20c',
      },
    ]);
  });

  it('returns empty videos for non-array input and invalid maxItems', () => {
    expect(normalizeGameVideos(undefined)).toEqual([]);
    expect(normalizeGameVideos('bad', { maxItems: 0 })).toEqual([]);
  });
});
