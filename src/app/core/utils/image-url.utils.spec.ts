import { describe, expect, it } from 'vitest';
import {
  buildProxyImageUrl,
  isDataOrBlobUrl,
  normalizeImageSourceUrl,
  toProxyEligibleImageUrl,
  withIgdbRetinaVariant,
} from './image-url.utils';

describe('image-url utils', () => {
  it('normalizes safe external URLs and rejects credential-bearing ones', () => {
    expect(normalizeImageSourceUrl('//images.igdb.com/igdb/image/upload/t_720p/hash.jpg')).toBe(
      'https://images.igdb.com/igdb/image/upload/t_720p/hash.jpg'
    );
    expect(
      normalizeImageSourceUrl('https://user:pass@images.igdb.com/igdb/image/upload/t_720p/hash.jpg')
    ).toBeNull();
  });

  it('applies retina variants and proxy routing with shared eligibility rules', () => {
    const retinaUrl = withIgdbRetinaVariant(
      'https://images.igdb.com/igdb/image/upload/t_720p/hash.jpg'
    );

    expect(retinaUrl).toBe('https://images.igdb.com/igdb/image/upload/t_720p_2x/hash.jpg');
    expect(toProxyEligibleImageUrl(retinaUrl)).toBe(retinaUrl);
    expect(buildProxyImageUrl(retinaUrl, 'https://api.example.com')).toContain(
      encodeURIComponent(retinaUrl)
    );
  });

  it('does not treat data or blob urls as proxy-eligible but flags them for prefetch skips', () => {
    expect(toProxyEligibleImageUrl('data:image/png;base64,AAA')).toBeNull();
    expect(isDataOrBlobUrl('data:image/png;base64,AAA')).toBe(true);
    expect(isDataOrBlobUrl('blob:https://example.com/id')).toBe(true);
    expect(isDataOrBlobUrl('https://example.com/image.jpg')).toBe(false);
  });
});
