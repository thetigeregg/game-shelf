import { TestBed } from '@angular/core/testing';
import { COLOR_SCHEME_STORAGE_KEY, ColorSchemePreference, ThemeService } from './theme.service';

const DARK_CLASS = 'ion-palette-dark';

describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove(DARK_CLASS);

    TestBed.configureTestingModule({ providers: [ThemeService] });
    service = TestBed.inject(ThemeService);
  });

  afterEach(() => {
    document.documentElement.classList.remove(DARK_CLASS);
  });

  it('initializes with default preference when nothing stored', () => {
    service.initialize();
    expect(service.getColorSchemePreference()).toBe('system');
  });

  it('reads stored preference and applies it on initialize', () => {
    localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, 'dark');
    service.initialize();
    expect(service.getColorSchemePreference()).toBe('dark');
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it('applies light preference on initialize', () => {
    localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, 'light');
    service.initialize();
    expect(service.getColorSchemePreference()).toBe('light');
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });

  it('persists preference when set via setColorSchemePreference', () => {
    service.setColorSchemePreference('dark');
    expect(localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it('sets light preference and removes dark class', () => {
    document.documentElement.classList.add(DARK_CLASS);
    service.setColorSchemePreference('light');
    expect(service.getColorSchemePreference()).toBe('light');
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
    expect(localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBe('light');
  });

  it('sets system preference and persists it', () => {
    service.setColorSchemePreference('system');
    expect(service.getColorSchemePreference()).toBe('system');
    expect(localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBe('system');
  });

  it('ignores unknown values stored in localStorage', () => {
    localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, 'invalid-value');
    service.initialize();
    // Falls back to default 'system' when stored value is invalid
    expect(service.getColorSchemePreference()).toBe('system');
  });

  it('clears legacy primary color key on initialize', () => {
    localStorage.setItem('game-shelf-primary-color', '#ff0000');
    service.initialize();
    expect(localStorage.getItem('game-shelf-primary-color')).toBeNull();
  });

  it('returns the preference set by setColorSchemePreference', () => {
    const prefs: ColorSchemePreference[] = ['dark', 'light', 'system'];

    for (const pref of prefs) {
      service.setColorSchemePreference(pref);
      expect(service.getColorSchemePreference()).toBe(pref);
    }
  });
});
