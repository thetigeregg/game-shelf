import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { isNativePlatform } from '../utils/native-platform.util';
import { isPreferenceStorageKey, PREFERENCE_STORAGE_MIGRATION_KEY } from './preference-keys';

let preferenceStorageInstance: PreferenceStorageService | null = null;

function setPreferenceStorageInstance(instance: PreferenceStorageService | null): void {
  preferenceStorageInstance = instance;
}

export function readPreference(key: string): string | null {
  return preferenceStorageInstance?.getItem(key) ?? readWebStorageItem(key);
}

export function writePreference(key: string, value: string): void {
  if (preferenceStorageInstance) {
    preferenceStorageInstance.setItem(key, value);
    return;
  }

  writeWebStorageItem(key, value);
}

export function removePreference(key: string): void {
  if (preferenceStorageInstance) {
    preferenceStorageInstance.removeItem(key);
    return;
  }

  removeWebStorageItem(key);
}

function readWebStorageItem(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeWebStorageItem(key: string, value: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
}

function removeWebStorageItem(key: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

@Injectable({ providedIn: 'root' })
export class PreferenceStorageService {
  private readonly cache = new Map<string, string>();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    setPreferenceStorageInstance(this);

    if (!isNativePlatform()) {
      this.initialized = true;
      return;
    }

    await this.migrateFromLocalStorageIfNeeded();
    await this.hydrateCacheFromPreferences();
    this.initialized = true;
  }

  getItem(key: string): string | null {
    if (!isNativePlatform()) {
      return readWebStorageItem(key);
    }

    return this.cache.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (!isNativePlatform()) {
      writeWebStorageItem(key, value);
      return;
    }

    this.cache.set(key, value);
    void Preferences.set({ key, value }).catch(() => undefined);
  }

  removeItem(key: string): void {
    if (!isNativePlatform()) {
      removeWebStorageItem(key);
      return;
    }

    this.cache.delete(key);
    void Preferences.remove({ key }).catch(() => undefined);
  }

  keys(): string[] {
    if (!isNativePlatform()) {
      return this.readWebStorageKeys();
    }

    return [...this.cache.keys()];
  }

  entriesWithPrefix(prefix: string): Array<[string, string]> {
    const entries: Array<[string, string]> = [];

    for (const key of this.keys()) {
      if (!key.startsWith(prefix)) {
        continue;
      }

      const value = this.getItem(key);

      if (typeof value === 'string') {
        entries.push([key, value]);
      }
    }

    return entries;
  }

  private async migrateFromLocalStorageIfNeeded(): Promise<void> {
    const migrationResult = await Preferences.get({ key: PREFERENCE_STORAGE_MIGRATION_KEY });

    if (migrationResult.value === '1') {
      return;
    }

    if (typeof window === 'undefined') {
      await Preferences.set({ key: PREFERENCE_STORAGE_MIGRATION_KEY, value: '1' });
      return;
    }

    const keysToMigrate = this.readWebStorageKeys().filter(isPreferenceStorageKey);

    for (const key of keysToMigrate) {
      const value = readWebStorageItem(key);

      if (typeof value !== 'string') {
        continue;
      }

      await Preferences.set({ key, value });
      removeWebStorageItem(key);
    }

    await Preferences.set({ key: PREFERENCE_STORAGE_MIGRATION_KEY, value: '1' });
  }

  private async hydrateCacheFromPreferences(): Promise<void> {
    const result = await Preferences.keys();
    const keys = result.keys;

    for (const key of keys) {
      const entry = await Preferences.get({ key });
      if (typeof entry.value === 'string') {
        this.cache.set(key, entry.value);
      }
    }
  }

  private readWebStorageKeys(): string[] {
    if (typeof window === 'undefined') {
      return [];
    }

    const keys: string[] = [];

    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);

        if (key) {
          keys.push(key);
        }
      }
    } catch {
      return [];
    }

    return keys;
  }
}
