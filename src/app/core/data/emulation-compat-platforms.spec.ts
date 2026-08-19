import { isCompatTrackedPlatform } from './emulation-compat-platforms';

describe('isCompatTrackedPlatform', () => {
  it('returns true for platforms with compatibility tracking', () => {
    expect(isCompatTrackedPlatform(21)).toBe(true); // GameCube
    expect(isCompatTrackedPlatform(8)).toBe(true); // PlayStation 2
  });

  it('returns false for platforms without compatibility tracking', () => {
    expect(isCompatTrackedPlatform(130)).toBe(false); // Switch
    expect(isCompatTrackedPlatform(167)).toBe(false); // PS5
    expect(isCompatTrackedPlatform(18)).toBe(false); // NES
  });

  it('returns false for null, undefined, or non-numeric input', () => {
    expect(isCompatTrackedPlatform(null)).toBe(false);
    expect(isCompatTrackedPlatform(undefined)).toBe(false);
  });
});
