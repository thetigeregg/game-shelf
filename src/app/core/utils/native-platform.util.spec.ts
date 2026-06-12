import { afterEach, describe, expect, it, vi } from 'vitest';

const isNativePlatformMock = vi.fn<() => boolean>();
const getPlatformMock = vi.fn<() => string>();

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatformMock(),
    getPlatform: () => getPlatformMock(),
  },
}));

import { getNativePlatform, isNativePlatform } from './native-platform.util';

describe('native-platform.util', () => {
  afterEach(() => {
    isNativePlatformMock.mockReset();
    getPlatformMock.mockReset();
  });

  it('delegates native detection to Capacitor', () => {
    isNativePlatformMock.mockReturnValue(true);
    expect(isNativePlatform()).toBe(true);

    isNativePlatformMock.mockReturnValue(false);
    expect(isNativePlatform()).toBe(false);
  });

  it('returns the Capacitor platform identifier', () => {
    getPlatformMock.mockReturnValue('ios');
    expect(getNativePlatform()).toBe('ios');

    getPlatformMock.mockReturnValue('web');
    expect(getNativePlatform()).toBe('web');
  });
});
