import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Style } from '@capacitor/status-bar';

const isNativePlatformMock = vi.fn<() => boolean>();
const setStyleMock = vi.fn<() => Promise<void>>();

vi.mock('../utils/native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

vi.mock('@capacitor/status-bar', () => ({
  Style: {
    Dark: 'DARK',
    Light: 'LIGHT',
  },
  StatusBar: {
    setStyle: (...args: unknown[]) => setStyleMock(...args),
  },
}));

import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('ion-palette-dark');
    isNativePlatformMock.mockReturnValue(false);
    setStyleMock.mockResolvedValue(undefined);
    service = new ThemeService();
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('ion-palette-dark');
    vi.restoreAllMocks();
    isNativePlatformMock.mockReset();
    setStyleMock.mockReset();
  });

  it('applies dark class and skips status bar updates on web', () => {
    service.setColorSchemePreference('dark');

    expect(document.documentElement.classList.contains('ion-palette-dark')).toBe(true);
    expect(setStyleMock).not.toHaveBeenCalled();
  });

  it('uses light status bar content on dark UI in the native shell', () => {
    isNativePlatformMock.mockReturnValue(true);

    service.setColorSchemePreference('dark');
    expect(setStyleMock).toHaveBeenCalledWith({ style: Style.Light });

    service.setColorSchemePreference('light');
    expect(setStyleMock).toHaveBeenLastCalledWith({ style: Style.Dark });
  });

  it('reads stored color scheme preferences and ignores storage failures', () => {
    localStorage.setItem('game-shelf-color-scheme', 'dark');
    service.initialize();
    expect(service.getColorSchemePreference()).toBe('dark');

    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    const freshService = new ThemeService();
    freshService.initialize();
    expect(freshService.getColorSchemePreference()).toBe('system');
    getItemSpy.mockRestore();
  });

  it('ignores status bar update failures', async () => {
    isNativePlatformMock.mockReturnValue(true);
    setStyleMock.mockRejectedValueOnce(new Error('status bar unavailable'));

    expect(() => {
      service.setColorSchemePreference('dark');
    }).not.toThrow();
    await Promise.resolve();
  });
});
