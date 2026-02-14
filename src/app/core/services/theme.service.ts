import { Injectable } from '@angular/core';

export const COLOR_SCHEME_STORAGE_KEY = 'game-shelf-color-scheme';
const DARK_CLASS_NAME = 'ion-palette-dark';
const LEGACY_PRIMARY_COLOR_STORAGE_KEY = 'game-shelf-primary-color';
const DEFAULT_COLOR_SCHEME_PREFERENCE: ColorSchemePreference = 'system';

export type ColorSchemePreference = 'system' | 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private colorSchemePreference: ColorSchemePreference = DEFAULT_COLOR_SCHEME_PREFERENCE;
  private systemColorSchemeMediaQuery: MediaQueryList | null = null;
  private readonly onSystemColorSchemeChange = (event: MediaQueryListEvent) => {
    if (this.colorSchemePreference === 'system') {
      this.applyDarkClass(event.matches);
    }
  };

  initialize(): void {
    this.clearLegacyPrimaryColorSetting();
    this.initializeSystemColorSchemeListener();

    const storedColorSchemePreference = this.readStoredColorSchemePreference();
    this.applyColorSchemePreference(storedColorSchemePreference ?? DEFAULT_COLOR_SCHEME_PREFERENCE, false);
  }

  getColorSchemePreference(): ColorSchemePreference {
    return this.colorSchemePreference;
  }

  setColorSchemePreference(preference: ColorSchemePreference): void {
    this.applyColorSchemePreference(preference, true);
  }

  private applyColorSchemePreference(preference: ColorSchemePreference, persist: boolean): void {
    this.colorSchemePreference = preference;

    if (preference === 'dark') {
      this.applyDarkClass(true);
    } else if (preference === 'light') {
      this.applyDarkClass(false);
    } else {
      this.applyDarkClass(this.prefersSystemDarkMode());
    }

    if (persist) {
      this.writeStoredColorSchemePreference(preference);
    }
  }

  private initializeSystemColorSchemeListener(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.systemColorSchemeMediaQuery = mediaQuery;

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', this.onSystemColorSchemeChange);
      return;
    }

    if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(this.onSystemColorSchemeChange);
    }
  }

  private prefersSystemDarkMode(): boolean {
    if (this.systemColorSchemeMediaQuery) {
      return this.systemColorSchemeMediaQuery.matches;
    }

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    return false;
  }

  private applyDarkClass(isDarkMode: boolean): void {
    document.documentElement.classList.toggle(DARK_CLASS_NAME, isDarkMode);
  }

  private readStoredColorSchemePreference(): ColorSchemePreference | null {
    try {
      const value = localStorage.getItem(COLOR_SCHEME_STORAGE_KEY);

      if (value === 'system' || value === 'light' || value === 'dark') {
        return value;
      }

      return null;
    } catch {
      return null;
    }
  }

  private writeStoredColorSchemePreference(preference: ColorSchemePreference): void {
    try {
      localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, preference);
    } catch {
      // Ignore storage failures in constrained environments.
    }
  }

  private clearLegacyPrimaryColorSetting(): void {
    try {
      localStorage.removeItem(LEGACY_PRIMARY_COLOR_STORAGE_KEY);
    } catch {
      // Ignore storage failures in constrained environments.
    }
  }

}
