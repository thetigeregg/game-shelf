import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COLOR_SCHEME_STORAGE_KEY, ThemeService } from './theme.service';

const DARK_CLASS = 'ion-palette-dark';
const LEGACY_COLOR_KEY = 'game-shelf-primary-color';

function makeMediaQueryListMock(matches = false) {
  return {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  };
}

describe('ThemeService', () => {
  let service: ThemeService;
  let mediaQueryListMock: ReturnType<typeof makeMediaQueryListMock>;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove(DARK_CLASS);

    mediaQueryListMock = makeMediaQueryListMock(false);
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(mediaQueryListMock)
    });

    service = new ThemeService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.classList.remove(DARK_CLASS);
    localStorage.clear();
  });

  describe('initialize()', () => {
    it('defaults to system preference when nothing is stored', () => {
      service.initialize();
      expect(service.getColorSchemePreference()).toBe('system');
    });

    it('applies stored dark preference and adds dark class', () => {
      localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, 'dark');
      service.initialize();
      expect(service.getColorSchemePreference()).toBe('dark');
      expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    });

    it('applies stored light preference and removes dark class', () => {
      document.documentElement.classList.add(DARK_CLASS);
      localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, 'light');
      service.initialize();
      expect(service.getColorSchemePreference()).toBe('light');
      expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
    });

    it('applies stored system preference using media query result', () => {
      localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, 'system');
      mediaQueryListMock.matches = true;
      service.initialize();
      expect(service.getColorSchemePreference()).toBe('system');
      expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    });

    it('ignores unknown stored preference values and falls back to system', () => {
      localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, 'banana');
      service.initialize();
      expect(service.getColorSchemePreference()).toBe('system');
    });

    it('clears the legacy primary color setting', () => {
      localStorage.setItem(LEGACY_COLOR_KEY, '#ff0000');
      service.initialize();
      expect(localStorage.getItem(LEGACY_COLOR_KEY)).toBeNull();
    });

    it('registers a change listener on the matchMedia list', () => {
      service.initialize();
      expect(mediaQueryListMock.addEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function)
      );
    });
  });

  describe('setColorSchemePreference()', () => {
    it('stores and applies dark preference', () => {
      service.setColorSchemePreference('dark');
      expect(service.getColorSchemePreference()).toBe('dark');
      expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
      expect(localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBe('dark');
    });

    it('stores and applies light preference, removing dark class', () => {
      document.documentElement.classList.add(DARK_CLASS);
      service.setColorSchemePreference('light');
      expect(service.getColorSchemePreference()).toBe('light');
      expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
      expect(localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBe('light');
    });

    it('stores system preference and follows media query', () => {
      mediaQueryListMock.matches = true;
      service.setColorSchemePreference('system');
      expect(service.getColorSchemePreference()).toBe('system');
      expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
      expect(localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBe('system');
    });
  });

  describe('system color scheme change listener', () => {
    it('adds dark class when system switches to dark while preference is system', () => {
      service.initialize();
      service.setColorSchemePreference('system');
      const changeHandler = mediaQueryListMock.addEventListener.mock.calls[0][1] as (
        e: MediaQueryListEvent
      ) => void;
      changeHandler({ matches: true } as MediaQueryListEvent);
      expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    });

    it('removes dark class when system switches to light while preference is system', () => {
      document.documentElement.classList.add(DARK_CLASS);
      service.initialize();
      service.setColorSchemePreference('system');
      const changeHandler = mediaQueryListMock.addEventListener.mock.calls[0][1] as (
        e: MediaQueryListEvent
      ) => void;
      changeHandler({ matches: false } as MediaQueryListEvent);
      expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
    });

    it('ignores system changes when preference is explicitly dark', () => {
      service.initialize();
      service.setColorSchemePreference('dark');
      const changeHandler = mediaQueryListMock.addEventListener.mock.calls[0][1] as (
        e: MediaQueryListEvent
      ) => void;
      // Simulate system going light — dark preference should hold
      changeHandler({ matches: false } as MediaQueryListEvent);
      expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    });
  });

  describe('when matchMedia is unavailable (SSR / constrained environments)', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: undefined
      });
      service = new ThemeService();
    });

    it('initializes without throwing', () => {
      expect(() => {
        service.initialize();
      }).not.toThrow();
    });

    it('returns default system preference after initialization', () => {
      service.initialize();
      expect(service.getColorSchemePreference()).toBe('system');
    });

    it('treats system preference as light when media query unavailable', () => {
      service.initialize();
      expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
    });
  });

  describe('localStorage error handling', () => {
    it('handles read error in initialize gracefully', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      expect(() => {
        service.initialize();
      }).not.toThrow();
    });

    it('handles write error in setColorSchemePreference gracefully', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      expect(() => {
        service.setColorSchemePreference('dark');
      }).not.toThrow();
    });

    it('handles removeItem error in initialize gracefully', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      expect(() => {
        service.initialize();
      }).not.toThrow();
    });
  });
});
