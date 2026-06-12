import { Injectable, inject } from '@angular/core';
import { PreferenceStorageService } from '../storage/preference-storage.service';

export const CLIENT_WRITE_TOKEN_STORAGE_KEY = 'game-shelf:client-write-token';
export const CLIENT_WRITE_TOKEN_HEADER_NAME = 'X-Game-Shelf-Client-Token';

@Injectable({ providedIn: 'root' })
export class ClientWriteAuthService {
  private readonly preferenceStorage = inject(PreferenceStorageService);

  getToken(): string | null {
    try {
      const token = this.preferenceStorage.getItem(CLIENT_WRITE_TOKEN_STORAGE_KEY);
      const normalized = (token ?? '').trim();
      return normalized.length > 0 ? normalized : null;
    } catch {
      return null;
    }
  }

  hasToken(): boolean {
    return this.getToken() !== null;
  }

  setToken(token: string): void {
    const normalized = token.trim();

    if (normalized.length === 0) {
      this.clearToken();
      return;
    }

    try {
      this.preferenceStorage.setItem(CLIENT_WRITE_TOKEN_STORAGE_KEY, normalized);
    } catch {
      // Ignore local storage failures.
    }
  }

  clearToken(): void {
    try {
      this.preferenceStorage.removeItem(CLIENT_WRITE_TOKEN_STORAGE_KEY);
    } catch {
      // Ignore local storage failures.
    }
  }
}
