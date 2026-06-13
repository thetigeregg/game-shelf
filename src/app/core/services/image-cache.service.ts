import { Injectable, inject } from '@angular/core';
import { ImageCacheRecord, STORAGE_ENGINE, isStorageConstraintError } from '../data/storage-engine';
import { ImageFileStore } from '../data/image-file-store';
import { DebugLogService } from './debug-log.service';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import { environment } from '../../../environments/environment';
import {
  buildProxyImageUrl,
  normalizeImageSourceUrl,
  withIgdbRetinaVariant,
} from '../utils/image-url.utils';
import { isNativePlatform } from '../utils/native-platform.util';

export type ImageCacheVariant = 'thumb' | 'detail';

@Injectable({ providedIn: 'root' })
export class ImageCacheService {
  private static readonly DEFAULT_LIMIT_MB = 200;
  private static readonly MIN_LIMIT_MB = 20;
  private static readonly MAX_LIMIT_MB = 2048;
  private static readonly LIMIT_STORAGE_KEY = 'game-shelf:image-cache-limit-mb';
  private static readonly IMAGE_DIAGNOSTIC_LIMIT = 120;

  private readonly engine = inject(STORAGE_ENGINE);
  private readonly imageFileStore = inject(ImageFileStore);
  private readonly debugLogService = inject(DebugLogService);
  private readonly preferenceStorage = inject(PreferenceStorageService);
  private readonly objectUrlsByCacheKey = new Map<string, string>();
  private imageDiagnosticsCount = 0;

  // Native stores cached image bytes as files (ImageFileStore) with metadata
  // in the storage engine; web keeps blobs inline in IndexedDB records.
  // Thumbs bypass the cache on all platforms and use direct URLs (see resolveImageUrl).
  private get isNative(): boolean {
    return isNativePlatform();
  }

  getLimitMb(): number {
    const raw = this.preferenceStorage.getItem(ImageCacheService.LIMIT_STORAGE_KEY);
    const parsed = Number.parseInt(raw ?? '', 10);

    if (!Number.isFinite(parsed)) {
      return ImageCacheService.DEFAULT_LIMIT_MB;
    }

    return this.clampLimitMb(parsed);
  }

  setLimitMb(limitMb: number): number {
    const normalized = this.clampLimitMb(limitMb);
    this.preferenceStorage.setItem(ImageCacheService.LIMIT_STORAGE_KEY, String(normalized));
    void this.enforceLimitBytes(normalized * 1024 * 1024);
    return normalized;
  }

  async getUsageBytes(): Promise<number> {
    const entries = await this.engine.listImageCacheOrderedByLastAccessedAt();
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
    await this.engine.clearImageCache();

    if (this.isNative) {
      await this.imageFileStore.clear();
    }
  }

  async purgeGameCache(gameKey: string): Promise<void> {
    const normalizedGameKey = gameKey.trim();

    if (normalizedGameKey.length === 0) {
      return;
    }

    const entries = await this.engine.listImageCacheByGameKey(normalizedGameKey);

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

    if (this.isNative) {
      for (const entry of entries) {
        if (entry.filePath) {
          await this.imageFileStore.deleteImage(entry.filePath);
        }
      }
    }

    await this.engine.deleteImageCacheByGameKey(normalizedGameKey);
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
      sourceUrl: normalizedSourceUrl,
    });

    if (!normalizedSourceUrl) {
      this.debugLogService.trace('image_cache.resolve_placeholder', {
        gameKey,
        variant,
        reason: 'missing_source_url',
      });
      return 'assets/icon/placeholder.png';
    }

    // Thumbnails are rendered in large volumes and have shown unreliable behavior
    // when persisted as IndexedDB blobs on some clients (notably iOS WebKit contexts).
    // Use direct URL rendering for thumbs and reserve blob cache for detail art.
    if (variant === 'thumb') {
      this.debugLogService.trace('image_cache.resolve_direct', {
        gameKey,
        variant,
        reason: 'thumb_variant',
      });
      return normalizedSourceUrl;
    }

    const cacheKey = this.buildCacheKey(gameKey, variant, normalizedSourceUrl);
    const existing = await this.engine.getImageCacheByCacheKey(cacheKey);

    if (existing) {
      const cachedUrl = this.isNative
        ? await this.resolveNativeCachedUrl(existing, cacheKey, gameKey, variant)
        : await this.resolveWebCachedUrl(existing, cacheKey, gameKey, variant);

      if (cachedUrl) {
        return cachedUrl;
      }
    }
    this.debugLogService.trace('image_cache.resolve_miss', { cacheKey, gameKey, variant });

    let blob: Blob;
    try {
      const response = await fetch(this.buildFetchUrl(normalizedSourceUrl));

      if (!response.ok) {
        this.logImageDiagnostic('image_cache_fetch_non_ok', {
          cacheKey,
          gameKey,
          variant,
          status: response.status,
          statusText: response.statusText,
        });
        return normalizedSourceUrl;
      }

      blob = await response.blob();
    } catch (error) {
      this.logImageDiagnostic('image_cache_fetch_failed', {
        cacheKey,
        gameKey,
        variant,
        message: error instanceof Error ? error.message : String(error),
      });
      this.debugLogService.trace('image_cache.resolve_direct', {
        gameKey,
        variant,
        reason: 'fetch_failed',
      });
      return normalizedSourceUrl;
    }

    if (!(blob instanceof Blob) || blob.size <= 0 || !(await this.isCacheableImageBlob(blob))) {
      this.logImageDiagnostic('image_cache_rejected_fetched_blob', {
        cacheKey,
        gameKey,
        variant,
        blobType: blob instanceof Blob ? blob.type : null,
        blobSize: blob instanceof Blob ? blob.size : null,
      });
      return normalizedSourceUrl;
    }

    const limitBytes = this.getLimitMb() * 1024 * 1024;

    if (blob.size <= limitBytes) {
      try {
        const storedUrl = this.isNative
          ? await this.storeNativeEntry(cacheKey, gameKey, variant, normalizedSourceUrl, blob)
          : await this.storeWebEntry(cacheKey, gameKey, variant, normalizedSourceUrl, blob);

        this.debugLogService.trace('image_cache.store_put', {
          cacheKey,
          gameKey,
          variant,
          sizeBytes: blob.size,
          limitBytes,
        });

        if (storedUrl) {
          return storedUrl;
        }
      } catch (error) {
        if (isStorageConstraintError(error)) {
          const racedUrl = await this.resolveStoredCacheUrl(cacheKey, gameKey, variant);

          if (racedUrl) {
            this.debugLogService.trace('image_cache.resolve_stored_hit', {
              cacheKey,
              gameKey,
              variant,
              reason: 'concurrent_store_race',
            });
            return racedUrl;
          }
        }

        this.logImageDiagnostic('image_cache_store_failed', {
          cacheKey,
          gameKey,
          variant,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.debugLogService.trace('image_cache.resolve_direct', {
      gameKey,
      variant,
      reason: 'store_skipped_or_missing',
    });
    return normalizedSourceUrl;
  }

  private async resolveWebCachedUrl(
    existing: ImageCacheRecord,
    cacheKey: string,
    gameKey: string,
    variant: ImageCacheVariant
  ): Promise<string | null> {
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
        blobSize: existing.blob instanceof Blob ? existing.blob.size : null,
      });

      if (existing.id !== undefined) {
        await this.engine.deleteImageCache(existing.id);
      }

      return null;
    }

    this.debugLogService.trace('image_cache.resolve_hit', {
      cacheKey,
      gameKey,
      variant,
      blobSize: existing.blob.size,
    });
    await this.touchEntry(existing);
    return this.toObjectUrl(cacheKey, existing.blob);
  }

  private async resolveNativeCachedUrl(
    existing: ImageCacheRecord,
    cacheKey: string,
    gameKey: string,
    variant: ImageCacheVariant
  ): Promise<string | null> {
    const displayUrl = existing.filePath
      ? await this.imageFileStore.getDisplayUrl(existing.filePath)
      : null;

    if (!displayUrl) {
      // File evicted by the OS or metadata without a file; drop the stale
      // record so the image is re-fetched below.
      this.logImageDiagnostic('image_cache_native_file_missing', {
        cacheKey,
        gameKey,
        variant,
        filePath: existing.filePath ?? null,
      });

      if (existing.id !== undefined) {
        await this.engine.deleteImageCache(existing.id);
      }

      return null;
    }

    this.debugLogService.trace('image_cache.resolve_hit', {
      cacheKey,
      gameKey,
      variant,
      filePath: existing.filePath,
    });
    await this.touchEntry(existing);
    return displayUrl;
  }

  private async storeWebEntry(
    cacheKey: string,
    gameKey: string,
    variant: ImageCacheVariant,
    sourceUrl: string,
    blob: Blob
  ): Promise<string | null> {
    const now = new Date().toISOString();
    await this.engine.putImageCache({
      cacheKey,
      gameKey,
      variant,
      sourceUrl,
      blob,
      sizeBytes: blob.size,
      updatedAt: now,
      lastAccessedAt: now,
    });
    await this.enforceLimitBytes(this.getLimitMb() * 1024 * 1024);
    const stored = await this.engine.getImageCacheByCacheKey(cacheKey);

    if (stored && stored.blob instanceof Blob && stored.blob.size > 0) {
      this.debugLogService.trace('image_cache.resolve_stored_hit', {
        cacheKey,
        gameKey,
        variant,
        blobSize: stored.blob.size,
      });
      return this.toObjectUrl(cacheKey, stored.blob);
    }

    return null;
  }

  private async storeNativeEntry(
    cacheKey: string,
    gameKey: string,
    variant: ImageCacheVariant,
    sourceUrl: string,
    blob: Blob
  ): Promise<string | null> {
    let filePath: string;
    let sizeBytes: number;

    try {
      ({ filePath, sizeBytes } = await this.imageFileStore.writeImage(cacheKey, blob));
    } catch (error) {
      this.logImageDiagnostic('image_cache_native_write_failed', {
        cacheKey,
        gameKey,
        variant,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    const now = new Date().toISOString();

    try {
      await this.engine.putImageCache({
        cacheKey,
        gameKey,
        variant,
        sourceUrl,
        filePath,
        sizeBytes,
        updatedAt: now,
        lastAccessedAt: now,
      });
      await this.enforceLimitBytes(this.getLimitMb() * 1024 * 1024);
    } catch (error) {
      await this.imageFileStore.deleteImage(filePath);

      if (isStorageConstraintError(error)) {
        return this.resolveStoredCacheUrl(cacheKey, gameKey, variant);
      }

      this.logImageDiagnostic('image_cache_native_metadata_write_failed', {
        cacheKey,
        gameKey,
        variant,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    const stored = await this.engine.getImageCacheByCacheKey(cacheKey);

    if (stored?.filePath) {
      const displayUrl = await this.imageFileStore.getDisplayUrl(stored.filePath);

      if (displayUrl) {
        this.debugLogService.trace('image_cache.resolve_stored_hit', {
          cacheKey,
          gameKey,
          variant,
          filePath: stored.filePath,
        });
        return displayUrl;
      }
    }

    return null;
  }

  private async resolveStoredCacheUrl(
    cacheKey: string,
    gameKey: string,
    variant: ImageCacheVariant
  ): Promise<string | null> {
    const stored = await this.engine.getImageCacheByCacheKey(cacheKey);

    if (!stored) {
      return null;
    }

    return this.isNative
      ? this.resolveNativeCachedUrl(stored, cacheKey, gameKey, variant)
      : this.resolveWebCachedUrl(stored, cacheKey, gameKey, variant);
  }

  private async touchEntry(entry: ImageCacheRecord): Promise<void> {
    if (entry.id === undefined) {
      return;
    }

    await this.engine.updateImageCacheLastAccessedAt(entry.id, new Date().toISOString());
  }

  private toObjectUrl(cacheKey: string, blob: Blob): string {
    const existing = this.objectUrlsByCacheKey.get(cacheKey);

    if (existing) {
      return existing;
    }

    const url = URL.createObjectURL(blob);
    this.objectUrlsByCacheKey.set(cacheKey, url);
    return url;
  }

  private normalizeSourceUrl(
    sourceUrl: string | null | undefined,
    variant: ImageCacheVariant
  ): string | null {
    const normalized = normalizeImageSourceUrl(sourceUrl);

    if (!normalized) {
      return null;
    }

    if (variant === 'thumb' && normalized.includes('cdn.thegamesdb.net/images/')) {
      return normalized.replace(/\/images\/(?:original|large|medium)\//, '/images/small/');
    }

    return withIgdbRetinaVariant(normalized);
  }

  private buildFetchUrl(sourceUrl: string): string {
    return buildProxyImageUrl(sourceUrl, environment.gameApiBaseUrl);
  }

  private buildCacheKey(gameKey: string, variant: ImageCacheVariant, sourceUrl: string): string {
    return `${gameKey}::${variant}::${sourceUrl}`;
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
    const entries = await this.engine.listImageCacheOrderedByLastAccessedAt();
    let totalBytes = entries.reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0);

    for (const entry of entries) {
      if (totalBytes <= limitBytes) {
        break;
      }

      if (entry.id === undefined) {
        continue;
      }

      await this.engine.deleteImageCache(entry.id);

      if (this.isNative && entry.filePath) {
        await this.imageFileStore.deleteImage(entry.filePath);
      }

      totalBytes -= entry.sizeBytes || 0;
      // Keep active object URLs alive even after backing cache eviction.
      // Revoking here can break currently-rendered rows and force placeholder fallback.
    }
  }
}
