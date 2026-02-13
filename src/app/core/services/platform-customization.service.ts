import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export const PLATFORM_DISPLAY_NAMES_STORAGE_KEY = 'game-shelf:platform-display-names-v1';

export type PlatformDisplayNameMap = Record<string, string>;

@Injectable({ providedIn: 'root' })
export class PlatformCustomizationService {
  private readonly displayNamesSubject = new BehaviorSubject<PlatformDisplayNameMap>(this.loadFromStorage());
  readonly displayNames$ = this.displayNamesSubject.asObservable();

  getDisplayNames(): PlatformDisplayNameMap {
    return { ...this.displayNamesSubject.value };
  }

  getDisplayName(platformName: string | null | undefined, platformIgdbId: number | null | undefined): string {
    const fallback = String(platformName ?? '').trim();
    const platformId = this.normalizePlatformIgdbId(platformIgdbId);
    const custom = platformId !== null ? this.displayNamesSubject.value[String(platformId)] : undefined;
    const normalizedCustom = typeof custom === 'string' ? custom.trim() : '';

    if (normalizedCustom.length > 0) {
      return normalizedCustom;
    }

    return fallback;
  }

  getCustomName(platformIgdbId: number | null | undefined): string | null {
    const platformId = this.normalizePlatformIgdbId(platformIgdbId);

    if (platformId === null) {
      return null;
    }

    const value = this.displayNamesSubject.value[String(platformId)];
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > 0 ? normalized : null;
  }

  setCustomName(platformIgdbId: number | null | undefined, customName: string | null | undefined): void {
    const platformId = this.normalizePlatformIgdbId(platformIgdbId);

    if (platformId === null) {
      return;
    }

    const next = { ...this.displayNamesSubject.value };
    const normalizedName = String(customName ?? '').trim();
    const key = String(platformId);

    if (normalizedName.length === 0) {
      delete next[key];
    } else {
      next[key] = normalizedName;
    }

    const normalized = this.normalizeMap(next);
    this.displayNamesSubject.next(normalized);
    this.saveToStorage(normalized);
  }

  setDisplayNames(map: PlatformDisplayNameMap): void {
    const normalized = this.normalizeMap(map);
    this.displayNamesSubject.next(normalized);
    this.saveToStorage(normalized);
  }

  clearCustomNames(): void {
    this.displayNamesSubject.next({});

    try {
      localStorage.removeItem(PLATFORM_DISPLAY_NAMES_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  refreshFromStorage(): void {
    this.displayNamesSubject.next(this.loadFromStorage());
  }

  private normalizeMap(map: PlatformDisplayNameMap | null | undefined): PlatformDisplayNameMap {
    const source = map && typeof map === 'object' ? map : {};
    const normalized: PlatformDisplayNameMap = {};

    Object.entries(source).forEach(([rawKey, rawValue]) => {
      const platformId = Number.parseInt(String(rawKey ?? ''), 10);
      const key = Number.isInteger(platformId) && platformId > 0 ? String(platformId) : null;

      if (!key) {
        return;
      }

      const value = String(rawValue ?? '').trim();

      if (value.length > 0) {
        normalized[key] = value;
      }
    });

    return normalized;
  }

  private normalizePlatformIgdbId(platformIgdbId: number | null | undefined): number | null {
    return typeof platformIgdbId === 'number' && Number.isInteger(platformIgdbId) && platformIgdbId > 0
      ? platformIgdbId
      : null;
  }

  private loadFromStorage(): PlatformDisplayNameMap {
    try {
      const raw = localStorage.getItem(PLATFORM_DISPLAY_NAMES_STORAGE_KEY);

      if (!raw) {
        return {};
      }

      return this.normalizeMap(JSON.parse(raw) as PlatformDisplayNameMap);
    } catch {
      return {};
    }
  }

  private saveToStorage(map: PlatformDisplayNameMap): void {
    try {
      localStorage.setItem(PLATFORM_DISPLAY_NAMES_STORAGE_KEY, JSON.stringify(map));
    } catch {
      // Ignore storage failures.
    }
  }
}
