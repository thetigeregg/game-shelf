import { Injectable } from '@angular/core';

export const PRIMARY_COLOR_STORAGE_KEY = 'game-shelf-primary-color';
export const COLOR_SCHEME_STORAGE_KEY = 'game-shelf-color-scheme';
const DARK_CLASS_NAME = 'ion-palette-dark';
const DEFAULT_PRIMARY_COLOR = '#3880ff';
const PRIMARY_CONTRAST_COLOR = '#ffffff';
const DEFAULT_COLOR_SCHEME_PREFERENCE: ColorSchemePreference = 'system';

export type ColorSchemePreference = 'system' | 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private primaryColor = DEFAULT_PRIMARY_COLOR;
  private colorSchemePreference: ColorSchemePreference = DEFAULT_COLOR_SCHEME_PREFERENCE;
  private systemColorSchemeMediaQuery: MediaQueryList | null = null;
  private readonly onSystemColorSchemeChange = (event: MediaQueryListEvent) => {
    if (this.colorSchemePreference === 'system') {
      this.applyDarkClass(event.matches);
    }
  };

  initialize(): void {
    const storedColor = this.readStoredColor();
    this.applyPrimaryColor(storedColor ?? DEFAULT_PRIMARY_COLOR, false);
    this.initializeSystemColorSchemeListener();

    const storedColorSchemePreference = this.readStoredColorSchemePreference();
    this.applyColorSchemePreference(storedColorSchemePreference ?? DEFAULT_COLOR_SCHEME_PREFERENCE, false);
  }

  getPrimaryColor(): string {
    return this.primaryColor;
  }

  setPrimaryColor(color: string): void {
    this.applyPrimaryColor(color, true);
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

  private applyPrimaryColor(color: string, persist: boolean): void {
    const normalizedColor = this.normalizeHexColor(color);

    if (!normalizedColor) {
      return;
    }

    const rgb = this.hexToRgb(normalizedColor);
    const shade = this.adjustColor(normalizedColor, -0.1);
    const tint = this.adjustColor(normalizedColor, 0.1);
    const contrast = PRIMARY_CONTRAST_COLOR;
    const contrastRgb = this.hexToRgb(contrast);
    const rootStyle = document.documentElement.style;

    rootStyle.setProperty('--ion-color-primary', normalizedColor);
    rootStyle.setProperty('--ion-color-primary-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    rootStyle.setProperty('--ion-color-primary-contrast', contrast);
    rootStyle.setProperty('--ion-color-primary-contrast-rgb', `${contrastRgb.r}, ${contrastRgb.g}, ${contrastRgb.b}`);
    rootStyle.setProperty('--ion-color-primary-shade', shade);
    rootStyle.setProperty('--ion-color-primary-tint', tint);

    this.primaryColor = normalizedColor;

    if (persist) {
      this.writeStoredColor(normalizedColor);
    }
  }

  private readStoredColor(): string | null {
    try {
      return localStorage.getItem(PRIMARY_COLOR_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private writeStoredColor(color: string): void {
    try {
      localStorage.setItem(PRIMARY_COLOR_STORAGE_KEY, color);
    } catch {
      // Ignore storage failures in constrained environments.
    }
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

  private normalizeHexColor(color: string): string | null {
    const normalized = color.trim().toLowerCase();

    if (/^#[0-9a-f]{6}$/.test(normalized)) {
      return normalized;
    }

    if (/^#[0-9a-f]{3}$/.test(normalized)) {
      const [, red, green, blue] = normalized;
      return `#${red}${red}${green}${green}${blue}${blue}`;
    }

    return null;
  }

  private hexToRgb(hexColor: string): { r: number; g: number; b: number } {
    const value = parseInt(hexColor.slice(1), 16);

    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255,
    };
  }

  private adjustColor(hexColor: string, amount: number): string {
    const { r, g, b } = this.hexToRgb(hexColor);
    const adjustChannel = (channel: number) => {
      const next = amount >= 0
        ? channel + (255 - channel) * amount
        : channel * (1 + amount);

      return Math.max(0, Math.min(255, Math.round(next)));
    };

    const nextR = adjustChannel(r).toString(16).padStart(2, '0');
    const nextG = adjustChannel(g).toString(16).padStart(2, '0');
    const nextB = adjustChannel(b).toString(16).padStart(2, '0');

    return `#${nextR}${nextG}${nextB}`;
  }

}
