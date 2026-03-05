import { describe, expect, it } from 'vitest';
import { isValidYouTubeVideoId } from './youtube-video.util';

describe('youtube-video.util', () => {
  it('accepts valid youtube ids', () => {
    expect(isValidYouTubeVideoId('PIF_fqFZEuk')).toBe(true);
    expect(isValidYouTubeVideoId(' Qf8JjQvYUFs ')).toBe(true);
  });

  it('rejects invalid youtube ids', () => {
    expect(isValidYouTubeVideoId('abc def')).toBe(false);
    expect(isValidYouTubeVideoId('short')).toBe(false);
    expect(isValidYouTubeVideoId(null)).toBe(false);
  });
});
