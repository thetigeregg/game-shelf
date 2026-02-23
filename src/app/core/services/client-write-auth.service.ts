import { Injectable } from '@angular/core';

export const CLIENT_WRITE_TOKEN_STORAGE_KEY = 'game-shelf:client-write-token';
export const CLIENT_WRITE_TOKEN_HEADER_NAME = 'X-Game-Shelf-Client-Token';

@Injectable({ providedIn: 'root' })
export class ClientWriteAuthService {
  getToken(): string | null {
    try {
      const token = localStorage.getItem(CLIENT_WRITE_TOKEN_STORAGE_KEY);
      const normalized = String(token ?? '').trim();
      return normalized.length > 0 ? normalized : null;
    } catch {
      return null;
    }
  }

  hasToken(): boolean {
    return this.getToken() !== null;
  }

  setToken(token: string): void {
    const normalized = String(token ?? '').trim();

    if (normalized.length === 0) {
      this.clearToken();
      return;
    }

    try {
      localStorage.setItem(CLIENT_WRITE_TOKEN_STORAGE_KEY, normalized);
    } catch {
      // Ignore local storage failures.
    }
  }

  clearToken(): void {
    try {
      localStorage.removeItem(CLIENT_WRITE_TOKEN_STORAGE_KEY);
    } catch {
      // Ignore local storage failures.
    }
  }
}
