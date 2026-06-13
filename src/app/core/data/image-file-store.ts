import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

const IMAGE_CACHE_DIR = 'image-cache';

/**
 * Native-only file storage for cached detail images. Image bytes live as
 * files under Directory.Cache/image-cache/<sha256-of-cacheKey>, served to the
 * WebView via Capacitor.convertFileSrc. Metadata (cacheKey, size, LRU
 * timestamps) is tracked separately in the storage engine's image cache
 * store. The OS may evict Directory.Cache under storage pressure, which is
 * acceptable: entries repopulate on demand.
 */
@Injectable({ providedIn: 'root' })
export class ImageFileStore {
  async writeImage(cacheKey: string, blob: Blob): Promise<{ filePath: string; sizeBytes: number }> {
    const filePath = `${IMAGE_CACHE_DIR}/${await this.hashCacheKey(cacheKey)}`;
    const data = await this.blobToBase64(blob);

    await Filesystem.writeFile({
      path: filePath,
      data,
      directory: Directory.Cache,
      recursive: true,
    });

    return { filePath, sizeBytes: blob.size };
  }

  /** Returns a WebView-displayable URL for the file, or null if it is gone. */
  async getDisplayUrl(filePath: string): Promise<string | null> {
    try {
      await Filesystem.stat({ path: filePath, directory: Directory.Cache });
    } catch {
      return null;
    }

    const { uri } = await Filesystem.getUri({ path: filePath, directory: Directory.Cache });
    return Capacitor.convertFileSrc(uri);
  }

  async deleteImage(filePath: string): Promise<void> {
    try {
      await Filesystem.deleteFile({ path: filePath, directory: Directory.Cache });
    } catch {
      // Already gone (e.g. evicted by the OS) — nothing to clean up.
    }
  }

  async clear(): Promise<void> {
    try {
      await Filesystem.rmdir({
        path: IMAGE_CACHE_DIR,
        directory: Directory.Cache,
        recursive: true,
      });
    } catch {
      // Directory may not exist yet.
    }
  }

  private async hashCacheKey(cacheKey: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cacheKey));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const separatorIndex = result.indexOf(',');
        resolve(separatorIndex >= 0 ? result.slice(separatorIndex + 1) : result);
      };
      reader.onerror = () => {
        reject(reader.error ?? new Error('Failed to read image blob.'));
      };
      reader.readAsDataURL(blob);
    });
  }
}
