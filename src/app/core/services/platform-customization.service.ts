import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { PLATFORM_CATALOG } from '../data/platform-catalog';

export const PLATFORM_DISPLAY_NAMES_STORAGE_KEY = 'game-shelf:platform-display-names-v1';

export type PlatformDisplayNameMap = Record<string, string>;

@Injectable({ providedIn: 'root' })
export class PlatformCustomizationService {
  private static readonly PLATFORM_DISPLAY_ALIAS_MAP: Record<string, string> = {
    'family computer': 'Nintendo Entertainment System',
    'family computer disk system': 'Nintendo Entertainment System',
    'super famicom': 'Super Nintendo Entertainment System',
    'new nintendo 3ds': 'Nintendo 3DS',
    'nintendo dsi': 'Nintendo DS',
    'e-reader / card-e reader': 'Game Boy Advance'
  };
  private readonly platformNameById = PLATFORM_CATALOG.reduce((map, entry) => {
    const platformId =
      typeof entry.id === 'number' && Number.isInteger(entry.id) && entry.id > 0 ? entry.id : null;
    const platformName = String(entry.name ?? '').trim();

    if (platformId !== null && platformName.length > 0) {
      map.set(platformId, platformName);
    }

    return map;
  }, new Map<number, string>());
  private readonly displayNamesSubject = new BehaviorSubject<PlatformDisplayNameMap>(
    this.loadFromStorage()
  );
  readonly displayNames$ = this.displayNamesSubject.asObservable();

  getDisplayNames(): PlatformDisplayNameMap {
    return { ...this.displayNamesSubject.value };
  }

  getDisplayName(
    platformName: string | null | undefined,
    platformIgdbId: number | null | undefined
  ): string {
    const fallback = String(platformName ?? '').trim();
    const aliasedFallback = this.getAliasedPlatformName(fallback);
    const fallbackKey = this.normalizePlatformKey(fallback);
    const aliasedFallbackKey = this.normalizePlatformKey(aliasedFallback);
    const aliasWasApplied =
      fallbackKey.length > 0 && aliasedFallbackKey.length > 0 && fallbackKey !== aliasedFallbackKey;

    if (aliasWasApplied) {
      const canonicalCustom = this.getCanonicalCustomName(aliasedFallback);

      if (canonicalCustom !== null) {
        return canonicalCustom;
      }
    }

    const platformId = this.normalizePlatformIgdbId(platformIgdbId);
    const custom =
      platformId !== null ? this.displayNamesSubject.value[String(platformId)] : undefined;
    const normalizedCustom = typeof custom === 'string' ? custom.trim() : '';

    if (normalizedCustom.length > 0) {
      return normalizedCustom;
    }

    return aliasedFallback;
  }

  getDisplayNameWithAliasSource(
    platformName: string | null | undefined,
    platformIgdbId: number | null | undefined
  ): string {
    const fallback = String(platformName ?? '').trim();

    if (fallback.length === 0) {
      return '';
    }

    const aliasedFallback = this.getAliasedPlatformName(fallback);
    const fallbackKey = this.normalizePlatformKey(fallback);
    const aliasedFallbackKey = this.normalizePlatformKey(aliasedFallback);
    const aliasWasApplied =
      fallbackKey.length > 0 && aliasedFallbackKey.length > 0 && fallbackKey !== aliasedFallbackKey;

    if (!aliasWasApplied) {
      return this.getDisplayName(fallback, platformIgdbId);
    }

    const canonicalCustom = this.getCanonicalCustomName(aliasedFallback);
    const canonicalLabel = canonicalCustom ?? aliasedFallback;
    const sourceCustom = this.getCustomName(platformIgdbId);
    const sourceLabel = sourceCustom ?? fallback;

    if (
      sourceLabel.trim().length === 0 ||
      this.normalizePlatformKey(sourceLabel) === this.normalizePlatformKey(canonicalLabel)
    ) {
      return canonicalLabel;
    }

    return `${canonicalLabel} (${sourceLabel})`;
  }

  private getCanonicalCustomName(canonicalPlatformName: string): string | null {
    const canonicalKey = this.normalizePlatformKey(canonicalPlatformName);

    if (canonicalKey.length === 0) {
      return null;
    }

    let aliasedSourceCustom: string | null = null;

    for (const [platformIdKey, customName] of Object.entries(this.displayNamesSubject.value)) {
      const platformId = Number.parseInt(platformIdKey, 10);
      const normalizedCustom = String(customName ?? '').trim();

      if (!Number.isInteger(platformId) || platformId <= 0 || normalizedCustom.length === 0) {
        continue;
      }

      const platformName = this.platformNameById.get(platformId) ?? '';

      if (platformName.length === 0) {
        continue;
      }

      const platformKey = this.normalizePlatformKey(platformName);
      const canonicalFromPlatform = this.getAliasedPlatformName(platformName);

      if (this.normalizePlatformKey(canonicalFromPlatform) !== canonicalKey) {
        continue;
      }

      // Prefer the custom name set on the canonical platform destination itself.
      if (platformKey === canonicalKey) {
        return normalizedCustom;
      }

      if (aliasedSourceCustom === null) {
        aliasedSourceCustom = normalizedCustom;
      }
    }

    return aliasedSourceCustom;
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

  setCustomName(
    platformIgdbId: number | null | undefined,
    customName: string | null | undefined
  ): void {
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
    return typeof platformIgdbId === 'number' &&
      Number.isInteger(platformIgdbId) &&
      platformIgdbId > 0
      ? platformIgdbId
      : null;
  }

  private getAliasedPlatformName(value: string | null | undefined): string {
    const trimmed = String(value ?? '').trim();

    if (trimmed.length === 0) {
      return '';
    }

    const key = trimmed.toLowerCase().replace(/\s+/g, ' ');
    return PlatformCustomizationService.PLATFORM_DISPLAY_ALIAS_MAP[key] ?? trimmed;
  }

  private normalizePlatformKey(value: string | null | undefined): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
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
