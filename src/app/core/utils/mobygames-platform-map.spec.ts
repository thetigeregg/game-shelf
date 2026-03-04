import { describe, expect, it } from 'vitest';
import { resolveMobyGamesPlatformId } from './mobygames-platform-map';

describe('mobygames-platform-map', () => {
  it('returns mapped MobyGames platform id for known IGDB ids', () => {
    expect(resolveMobyGamesPlatformId(6)).toBe(3);
  });

  it('returns null for invalid or unmapped IGDB platform ids', () => {
    expect(resolveMobyGamesPlatformId(null)).toBeNull();
    expect(resolveMobyGamesPlatformId(undefined)).toBeNull();
    expect(resolveMobyGamesPlatformId(0)).toBeNull();
    expect(resolveMobyGamesPlatformId(-1)).toBeNull();
    expect(resolveMobyGamesPlatformId(4.2)).toBeNull();
    expect(resolveMobyGamesPlatformId(999999)).toBeNull();
  });
});
