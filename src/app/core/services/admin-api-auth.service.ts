import { Injectable } from '@angular/core';

export const ADMIN_API_TOKEN_STORAGE_KEY = 'game-shelf:admin-api-token';

@Injectable({ providedIn: 'root' })
export class AdminApiAuthService {
  getToken(): string | null {
    try {
      const token = localStorage.getItem(ADMIN_API_TOKEN_STORAGE_KEY);
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
      localStorage.setItem(ADMIN_API_TOKEN_STORAGE_KEY, normalized);
    } catch {
      // Ignore local storage failures.
    }
  }

  clearToken(): void {
    try {
      localStorage.removeItem(ADMIN_API_TOKEN_STORAGE_KEY);
    } catch {
      // Ignore local storage failures.
    }
  }
}
