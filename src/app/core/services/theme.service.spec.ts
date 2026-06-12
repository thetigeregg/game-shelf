import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Style } from '@capacitor/status-bar';
import {
  PreferenceStorageService,
  resetPreferenceStorageForTesting,
} from '../storage/preference-storage.service';
import { ThemeService } from './theme.service';

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

describe('ThemeService', () => {
  let service: ThemeService;
  let preferenceStorage: PreferenceStorageService;

  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.classList.remove('ion-palette-dark');
    isNativePlatformMock.mockReturnValue(false);
    setStyleMock.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [ThemeService, PreferenceStorageService],
    });
    preferenceStorage = TestBed.inject(PreferenceStorageService);
    await preferenceStorage.initialize();
    service = TestBed.inject(ThemeService);
  });

  afterEach(() => {
    localStorage.clear();
    resetPreferenceStorageForTesting();
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

  it('matches native status bar style to the active color scheme', () => {
    isNativePlatformMock.mockReturnValue(true);

    service.setColorSchemePreference('dark');
    expect(setStyleMock).toHaveBeenCalledWith({ style: Style.Dark });

    service.setColorSchemePreference('light');
    expect(setStyleMock).toHaveBeenLastCalledWith({ style: Style.Light });
  });

  it('reads stored color scheme preferences and ignores storage failures', async () => {
    preferenceStorage.setItem('game-shelf-color-scheme', 'dark');
    service.initialize();
    expect(service.getColorSchemePreference()).toBe('dark');

    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [ThemeService, PreferenceStorageService],
    });
    const freshPreferenceStorage = TestBed.inject(PreferenceStorageService);
    await freshPreferenceStorage.initialize();
    const freshService = TestBed.inject(ThemeService);
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
