import { Injectable, inject } from '@angular/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import { isNativePlatform } from '../utils/native-platform.util';
import { DebugLogService } from './debug-log.service';

export const COLOR_SCHEME_STORAGE_KEY = 'game-shelf-color-scheme';
const DARK_CLASS_NAME = 'ion-palette-dark';
const LEGACY_PRIMARY_COLOR_STORAGE_KEY = 'game-shelf-primary-color';
const DEFAULT_COLOR_SCHEME_PREFERENCE: ColorSchemePreference = 'system';

export type ColorSchemePreference = 'system' | 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly preferenceStorage = inject(PreferenceStorageService);
  private readonly debugLogService = inject(DebugLogService);
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
    // Note: DebugLogService.initialize() is called after ThemeService.initialize() in app.component.ts.
    // These traces are only captured if the user had verbose tracing enabled from a prior session.
    this.debugLogService.trace('theme.init', { storedPreference: storedColorSchemePreference });
    this.applyColorSchemePreference(
      storedColorSchemePreference ?? DEFAULT_COLOR_SCHEME_PREFERENCE,
      false
    );
  }

  getColorSchemePreference(): ColorSchemePreference {
    return this.colorSchemePreference;
  }

  setColorSchemePreference(preference: ColorSchemePreference): void {
    this.applyColorSchemePreference(preference, true);
  }

  private applyColorSchemePreference(preference: ColorSchemePreference, persist: boolean): void {
    this.colorSchemePreference = preference;

    const isDarkMode =
      preference === 'dark' ? true : preference === 'light' ? false : this.prefersSystemDarkMode();
    this.debugLogService.trace('theme.preference_applied', { preference, isDarkMode, persist });

    this.applyDarkClass(isDarkMode);

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
    mediaQuery.addEventListener('change', this.onSystemColorSchemeChange);
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
    this.syncNativeStatusBarStyle(isDarkMode);
  }

  private syncNativeStatusBarStyle(isDarkMode: boolean): void {
    if (!isNativePlatform()) {
      return;
    }

    const style = isDarkMode ? Style.Dark : Style.Light;
    this.debugLogService.trace('theme.status_bar_style_set', { style });
    void StatusBar.setStyle({ style }).catch(() => undefined);
  }

  private readStoredColorSchemePreference(): ColorSchemePreference | null {
    try {
      const value = this.preferenceStorage.getItem(COLOR_SCHEME_STORAGE_KEY);

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
      this.preferenceStorage.setItem(COLOR_SCHEME_STORAGE_KEY, preference);
    } catch {
      // Ignore storage failures in constrained environments.
    }
  }

  private clearLegacyPrimaryColorSetting(): void {
    try {
      this.preferenceStorage.removeItem(LEGACY_PRIMARY_COLOR_STORAGE_KEY);
    } catch {
      // Ignore storage failures in constrained environments.
    }
  }
}
