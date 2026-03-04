import { describe, expect, it } from 'vitest';
import { isMetacriticPlatformSupported } from './metacritic-platform-support';

describe('metacritic-platform-support', () => {
  it('returns true for supported IGDB platform ids', () => {
    expect(isMetacriticPlatformSupported(48)).toBe(true);
  });

  it('returns false for invalid and unsupported ids', () => {
    expect(isMetacriticPlatformSupported(null)).toBe(false);
    expect(isMetacriticPlatformSupported(undefined)).toBe(false);
    expect(isMetacriticPlatformSupported(48.5)).toBe(false);
    expect(isMetacriticPlatformSupported(Number.NaN)).toBe(false);
    expect(isMetacriticPlatformSupported(9999)).toBe(false);
  });
});
