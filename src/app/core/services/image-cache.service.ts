import { Injectable, inject } from '@angular/core';
import { AppDb, ImageCacheEntry } from '../data/app-db';
import { environment } from '../../../environments/environment';

export type ImageCacheVariant = 'thumb' | 'detail';

@Injectable({ providedIn: 'root' })
export class ImageCacheService {
  private static readonly DEFAULT_LIMIT_MB = 200;
  private static readonly MIN_LIMIT_MB = 20;
  private static readonly MAX_LIMIT_MB = 2048;
  private static readonly LIMIT_STORAGE_KEY = 'game-shelf:image-cache-limit-mb';

  private readonly db = inject(AppDb);
  private readonly objectUrlsByCacheKey = new Map<string, string>();

  getLimitMb(): number {
    const raw = localStorage.getItem(ImageCacheService.LIMIT_STORAGE_KEY);
    const parsed = Number.parseInt(String(raw ?? ''), 10);

    if (!Number.isFinite(parsed)) {
      return ImageCacheService.DEFAULT_LIMIT_MB;
    }

    return this.clampLimitMb(parsed);
  }

  setLimitMb(limitMb: number): number {
    const normalized = this.clampLimitMb(limitMb);
    localStorage.setItem(ImageCacheService.LIMIT_STORAGE_KEY, String(normalized));
    void this.enforceLimitBytes(normalized * 1024 * 1024);
    return normalized;
  }

  async getUsageBytes(): Promise<number> {
    const entries = await this.db.imageCache.toArray();
    return entries.reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0);
  }

  async resolveImageUrl(gameKey: string, sourceUrl: string | null | undefined, variant: ImageCacheVariant): Promise<string> {
    const normalizedSourceUrl = this.normalizeSourceUrl(sourceUrl, variant);

    if (!normalizedSourceUrl) {
      return 'assets/icon/favicon.png';
    }

    const cacheKey = this.buildCacheKey(gameKey, variant, normalizedSourceUrl);
    const existing = await this.db.imageCache.where('cacheKey').equals(cacheKey).first();

    if (existing) {
      await this.touchEntry(existing);
      return this.toObjectUrl(existing);
    }

    const response = await fetch(this.buildFetchUrl(normalizedSourceUrl));

    if (!response.ok) {
      return normalizedSourceUrl;
    }

    const blob = await response.blob();

    if (!(blob instanceof Blob) || blob.size <= 0) {
      return normalizedSourceUrl;
    }

    const now = new Date().toISOString();
    const entry: ImageCacheEntry = {
      cacheKey,
      gameKey,
      variant,
      sourceUrl: normalizedSourceUrl,
      blob,
      sizeBytes: blob.size,
      updatedAt: now,
      lastAccessedAt: now,
    };

    const limitBytes = this.getLimitMb() * 1024 * 1024;

    if (entry.sizeBytes <= limitBytes) {
      await this.db.imageCache.put(entry);
      await this.enforceLimitBytes(limitBytes);
      const stored = await this.db.imageCache.where('cacheKey').equals(cacheKey).first();

      if (stored) {
        return this.toObjectUrl(stored);
      }
    }

    return normalizedSourceUrl;
  }

  private async touchEntry(entry: ImageCacheEntry): Promise<void> {
    if (entry.id === undefined) {
      return;
    }

    await this.db.imageCache.update(entry.id, {
      lastAccessedAt: new Date().toISOString(),
    });
  }

  private toObjectUrl(entry: ImageCacheEntry): string {
    const existing = this.objectUrlsByCacheKey.get(entry.cacheKey);

    if (existing) {
      return existing;
    }

    const url = URL.createObjectURL(entry.blob);
    this.objectUrlsByCacheKey.set(entry.cacheKey, url);
    return url;
  }

  private normalizeSourceUrl(sourceUrl: string | null | undefined, variant: ImageCacheVariant): string | null {
    const normalized = typeof sourceUrl === 'string' ? sourceUrl.trim() : '';

    if (!normalized) {
      return null;
    }

    if (variant === 'thumb' && normalized.includes('cdn.thegamesdb.net/images/')) {
      return normalized.replace(/\/images\/(?:original|large|medium)\//, '/images/small/');
    }

    return normalized;
  }

  private buildFetchUrl(sourceUrl: string): string {
    if (sourceUrl.includes('cdn.thegamesdb.net/images/')) {
      return `${environment.gameApiBaseUrl}/v1/images/proxy?url=${encodeURIComponent(sourceUrl)}`;
    }

    return sourceUrl;
  }

  private buildCacheKey(gameKey: string, variant: ImageCacheVariant, sourceUrl: string): string {
    return `${gameKey}::${variant}::${sourceUrl}`;
  }

  private clampLimitMb(value: number): number {
    const rounded = Math.round(value);
    return Math.max(ImageCacheService.MIN_LIMIT_MB, Math.min(rounded, ImageCacheService.MAX_LIMIT_MB));
  }

  private async enforceLimitBytes(limitBytes: number): Promise<void> {
    const entries = await this.db.imageCache.orderBy('lastAccessedAt').toArray();
    let totalBytes = entries.reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0);

    for (const entry of entries) {
      if (totalBytes <= limitBytes) {
        break;
      }

      if (entry.id === undefined) {
        continue;
      }

      await this.db.imageCache.delete(entry.id);
      totalBytes -= entry.sizeBytes || 0;

      const existingObjectUrl = this.objectUrlsByCacheKey.get(entry.cacheKey);

      if (existingObjectUrl) {
        URL.revokeObjectURL(existingObjectUrl);
        this.objectUrlsByCacheKey.delete(entry.cacheKey);
      }
    }
  }
}
