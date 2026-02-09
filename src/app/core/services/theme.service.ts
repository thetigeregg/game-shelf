import { Injectable } from '@angular/core';

const STORAGE_KEY = 'game-shelf-primary-color';
const DEFAULT_PRIMARY_COLOR = '#3880ff';
const PRIMARY_CONTRAST_COLOR = '#ffffff';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private primaryColor = DEFAULT_PRIMARY_COLOR;

  initialize(): void {
    const storedColor = this.readStoredColor();
    this.applyPrimaryColor(storedColor ?? DEFAULT_PRIMARY_COLOR, false);
  }

  getPrimaryColor(): string {
    return this.primaryColor;
  }

  setPrimaryColor(color: string): void {
    this.applyPrimaryColor(color, true);
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
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private writeStoredColor(color: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, color);
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
