import { describe, expect, it } from 'vitest';
import {
  getDetailMediaPlaceholderSrc,
  toDetailMediaBackdropUrl,
  toDetailMediaRenderUrl,
} from './detail-media-url.utils';

describe('detail-media-url utils', () => {
  it('returns null for blank urls and exposes the shared placeholder', () => {
    expect(toDetailMediaRenderUrl('   ')).toBeNull();
    expect(toDetailMediaBackdropUrl(undefined)).toBeNull();
    expect(getDetailMediaPlaceholderSrc()).toBe('assets/icon/placeholder.png');
  });

  it('routes proxy-eligible image urls through the backend and upgrades IGDB to retina', () => {
    const result = toDetailMediaRenderUrl(
      'https://images.igdb.com/igdb/image/upload/t_720p/hash.jpg'
    );

    expect(result).toContain('/v1/images/proxy?url=');
    expect(result).toContain(
      encodeURIComponent('https://images.igdb.com/igdb/image/upload/t_720p_2x/hash.jpg')
    );
  });

  it('keeps non-proxy urls unchanged and downsizes IGDB backdrops', () => {
    expect(toDetailMediaRenderUrl('https://example.com/image.jpg')).toBe(
      'https://example.com/image.jpg'
    );

    const backdrop = toDetailMediaBackdropUrl(
      'https://images.igdb.com/igdb/image/upload/t_screenshot_big/hash.jpg'
    );
    expect(backdrop).toContain(
      encodeURIComponent('https://images.igdb.com/igdb/image/upload/t_screenshot_med/hash.jpg')
    );
  });
});
