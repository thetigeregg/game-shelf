import { Injectable, inject } from '@angular/core';
import { AppDb, ImageCacheEntry } from '../data/app-db';
import { DebugLogService } from './debug-log.service';
import { environment } from '../../../environments/environment';

export type ImageCacheVariant = 'thumb' | 'detail';

@Injectable({ providedIn: 'root' })
export class ImageCacheService {
  private static readonly DEFAULT_LIMIT_MB = 200;
  private static readonly MIN_LIMIT_MB = 20;
  private static readonly MAX_LIMIT_MB = 2048;
  private static readonly LIMIT_STORAGE_KEY = 'game-shelf:image-cache-limit-mb';
  private static readonly THE_GAMES_DB_HOST = 'cdn.thegamesdb.net';
  private static readonly IGDB_HOST = 'images.igdb.com';
  private static readonly IMAGE_DIAGNOSTIC_LIMIT = 120;

  private readonly db = inject(AppDb);
  private readonly debugLogService = inject(DebugLogService);
  private readonly objectUrlsByCacheKey = new Map<string, string>();
  private imageDiagnosticsCount = 0;

  getLimitMb(): number {
    const raw = localStorage.getItem(ImageCacheService.LIMIT_STORAGE_KEY);
    const parsed = Number.parseInt(raw ?? '', 10);

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

  async purgeLocalCache(): Promise<void> {
    this.objectUrlsByCacheKey.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore URL revoke failures.
      }
    });
    this.objectUrlsByCacheKey.clear();
    await this.db.imageCache.clear();
  }

  async purgeGameCache(gameKey: string): Promise<void> {
    const normalizedGameKey = gameKey.trim();

    if (normalizedGameKey.length === 0) {
      return;
    }

    const entries = await this.db.imageCache.where('gameKey').equals(normalizedGameKey).toArray();

    entries.forEach((entry) => {
      const objectUrl = this.objectUrlsByCacheKey.get(entry.cacheKey);

      if (!objectUrl) {
        return;
      }

      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // Ignore URL revoke failures.
      }

      this.objectUrlsByCacheKey.delete(entry.cacheKey);
    });

    await this.db.imageCache.where('gameKey').equals(normalizedGameKey).delete();
  }

  async resolveImageUrl(
    gameKey: string,
    sourceUrl: string | null | undefined,
    variant: ImageCacheVariant
  ): Promise<string> {
    const normalizedSourceUrl = this.normalizeSourceUrl(sourceUrl, variant);
    this.debugLogService.trace('image_cache.resolve_start', {
      gameKey,
      variant,
      sourceUrl: normalizedSourceUrl
    });

    if (!normalizedSourceUrl) {
      this.debugLogService.trace('image_cache.resolve_placeholder', {
        gameKey,
        variant,
        reason: 'missing_source_url'
      });
      return 'assets/icon/placeholder.png';
    }

    // Thumbnails are rendered in large volumes and have shown unreliable behavior
    // when persisted as IndexedDB blobs on some clients (notably iOS/PWA contexts).
    // Use direct URL rendering for thumbs and reserve blob cache for detail art.
    if (variant === 'thumb') {
      this.debugLogService.trace('image_cache.resolve_direct', {
        gameKey,
        variant,
        reason: 'thumb_variant'
      });
      return normalizedSourceUrl;
    }

    // In standalone PWA mode (especially iOS), blob/object URLs used for detail art
    // can intermittently fail after first paint and trigger placeholder fallbacks.
    // Prefer direct source URLs in that environment for rendering stability.
    if (this.shouldBypassDetailBlobCache()) {
      this.debugLogService.trace('image_cache.resolve_direct', {
        gameKey,
        variant,
        reason: 'pwa_blob_bypass'
      });
      return normalizedSourceUrl;
    }

    const cacheKey = this.buildCacheKey(gameKey, variant, normalizedSourceUrl);
    const existing = await this.db.imageCache.where('cacheKey').equals(cacheKey).first();

    if (existing) {
      if (
        !(existing.blob instanceof Blob) ||
        existing.blob.size <= 0 ||
        !(await this.isCacheableImageBlob(existing.blob))
      ) {
        this.logImageDiagnostic('image_cache_rejected_existing_blob', {
          cacheKey,
          gameKey,
          variant,
          blobType: existing.blob instanceof Blob ? existing.blob.type : null,
          blobSize: existing.blob instanceof Blob ? existing.blob.size : null
        });
        if (existing.id !== undefined) {
          await this.db.imageCache.delete(existing.id);
        }
      } else {
        this.debugLogService.trace('image_cache.resolve_hit', {
          cacheKey,
          gameKey,
          variant,
          blobSize: existing.blob.size
        });
        await this.touchEntry(existing);
        return this.toObjectUrl(existing);
      }
    }
    this.debugLogService.trace('image_cache.resolve_miss', { cacheKey, gameKey, variant });

    try {
      const response = await fetch(this.buildFetchUrl(normalizedSourceUrl));

      if (!response.ok) {
        this.logImageDiagnostic('image_cache_fetch_non_ok', {
          cacheKey,
          gameKey,
          variant,
          status: response.status,
          statusText: response.statusText
        });
        return normalizedSourceUrl;
      }

      const blob = await response.blob();

      if (!(blob instanceof Blob) || blob.size <= 0 || !(await this.isCacheableImageBlob(blob))) {
        this.logImageDiagnostic('image_cache_rejected_fetched_blob', {
          cacheKey,
          gameKey,
          variant,
          blobType: blob instanceof Blob ? blob.type : null,
          blobSize: blob instanceof Blob ? blob.size : null
        });
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
        lastAccessedAt: now
      };

      const limitBytes = this.getLimitMb() * 1024 * 1024;

      if (entry.sizeBytes <= limitBytes) {
        await this.db.imageCache.put(entry);
        this.debugLogService.trace('image_cache.store_put', {
          cacheKey,
          gameKey,
          variant,
          sizeBytes: entry.sizeBytes,
          limitBytes
        });
        await this.enforceLimitBytes(limitBytes);
        const stored = await this.db.imageCache.where('cacheKey').equals(cacheKey).first();

        if (stored && stored.blob instanceof Blob && stored.blob.size > 0) {
          this.debugLogService.trace('image_cache.resolve_stored_hit', {
            cacheKey,
            gameKey,
            variant,
            blobSize: stored.blob.size
          });
          return this.toObjectUrl(stored);
        }
      }

      this.debugLogService.trace('image_cache.resolve_direct', {
        gameKey,
        variant,
        reason: 'store_skipped_or_missing'
      });
      return normalizedSourceUrl;
    } catch {
      this.logImageDiagnostic('image_cache_fetch_failed', {
        cacheKey,
        gameKey,
        variant
      });
      this.debugLogService.trace('image_cache.resolve_direct', {
        gameKey,
        variant,
        reason: 'fetch_failed'
      });
      return normalizedSourceUrl;
    }
  }

  private async touchEntry(entry: ImageCacheEntry): Promise<void> {
    if (entry.id === undefined) {
      return;
    }

    await this.db.imageCache.update(entry.id, {
      lastAccessedAt: new Date().toISOString()
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

  private normalizeSourceUrl(
    sourceUrl: string | null | undefined,
    variant: ImageCacheVariant
  ): string | null {
    const normalized = typeof sourceUrl === 'string' ? sourceUrl.trim() : '';

    if (!normalized) {
      return null;
    }

    if (variant === 'thumb' && normalized.includes('cdn.thegamesdb.net/images/')) {
      return normalized.replace(/\/images\/(?:original|large|medium)\//, '/images/small/');
    }

    return this.withIgdbRetinaVariant(normalized);
  }

  private withIgdbRetinaVariant(url: string): string {
    return url.replace(
      /(\/igdb\/image\/upload\/)(t_[^/]+)(\/)/,
      (_match, prefix: string, sizeToken: string, suffix: string) => {
        if (sizeToken.endsWith('_2x')) {
          return `${prefix}${sizeToken}${suffix}`;
        }

        return `${prefix}${sizeToken}_2x${suffix}`;
      }
    );
  }

  private buildFetchUrl(sourceUrl: string): string {
    const proxyEligibleUrl = this.toProxyEligibleImageUrl(sourceUrl);

    if (proxyEligibleUrl) {
      return `${environment.gameApiBaseUrl}/v1/images/proxy?url=${encodeURIComponent(proxyEligibleUrl)}`;
    }

    return sourceUrl;
  }

  private toProxyEligibleImageUrl(sourceUrl: string): string | null {
    const normalizedSourceUrl = sourceUrl.startsWith('//') ? `https:${sourceUrl}` : sourceUrl;

    try {
      const parsed = new URL(normalizedSourceUrl);

      if (parsed.protocol !== 'https:') {
        return null;
      }

      const hostname = parsed.hostname.toLowerCase();
      const isTheGamesDb =
        hostname === ImageCacheService.THE_GAMES_DB_HOST && parsed.pathname.startsWith('/images/');
      const isIgdb =
        hostname === ImageCacheService.IGDB_HOST &&
        parsed.pathname.startsWith('/igdb/image/upload/');

      if (!isTheGamesDb && !isIgdb) {
        return null;
      }

      return parsed.toString();
    } catch {
      return null;
    }
  }

  private buildCacheKey(gameKey: string, variant: ImageCacheVariant, sourceUrl: string): string {
    return `${gameKey}::${variant}::${sourceUrl}`;
  }

  private shouldBypassDetailBlobCache(): boolean {
    if (
      typeof window === 'undefined' ||
      typeof navigator === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return false;
    }

    const nav = navigator as Navigator & { standalone?: boolean };
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;

    if (!isStandalone) {
      return false;
    }

    return true;
  }

  private clampLimitMb(value: number): number {
    const rounded = Math.round(value);
    return Math.max(
      ImageCacheService.MIN_LIMIT_MB,
      Math.min(rounded, ImageCacheService.MAX_LIMIT_MB)
    );
  }

  private async isCacheableImageBlob(blob: Blob): Promise<boolean> {
    const mimeType = blob.type.trim().toLowerCase();

    if (mimeType.startsWith('image/')) {
      return true;
    }

    if (!mimeType || mimeType === 'application/octet-stream') {
      return this.hasImageSignature(blob);
    }

    return false;
  }

  private async hasImageSignature(blob: Blob): Promise<boolean> {
    try {
      const buffer = await blob.slice(0, 16).arrayBuffer();
      const bytes = new Uint8Array(buffer);

      if (bytes.length >= 8) {
        const isPng =
          bytes[0] === 0x89 &&
          bytes[1] === 0x50 &&
          bytes[2] === 0x4e &&
          bytes[3] === 0x47 &&
          bytes[4] === 0x0d &&
          bytes[5] === 0x0a &&
          bytes[6] === 0x1a &&
          bytes[7] === 0x0a;

        if (isPng) {
          return true;
        }
      }

      if (bytes.length >= 3) {
        const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

        if (isJpeg) {
          return true;
        }
      }

      if (bytes.length >= 6) {
        const isGif =
          bytes[0] === 0x47 &&
          bytes[1] === 0x49 &&
          bytes[2] === 0x46 &&
          bytes[3] === 0x38 &&
          (bytes[4] === 0x37 || bytes[4] === 0x39) &&
          bytes[5] === 0x61;

        if (isGif) {
          return true;
        }
      }

      if (bytes.length >= 12) {
        const isWebp =
          bytes[0] === 0x52 &&
          bytes[1] === 0x49 &&
          bytes[2] === 0x46 &&
          bytes[3] === 0x46 &&
          bytes[8] === 0x57 &&
          bytes[9] === 0x45 &&
          bytes[10] === 0x42 &&
          bytes[11] === 0x50;

        if (isWebp) {
          return true;
        }
      }
    } catch {
      return false;
    }

    return false;
  }

  private logImageDiagnostic(message: string, payload: Record<string, unknown>): void {
    if (this.imageDiagnosticsCount >= ImageCacheService.IMAGE_DIAGNOSTIC_LIMIT) {
      return;
    }

    this.imageDiagnosticsCount += 1;
    this.debugLogService.warn(message, payload);
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
      // Keep active object URLs alive even after backing cache eviction.
      // Revoking here can break currently-rendered rows and force placeholder fallback.
    }
  }
}
