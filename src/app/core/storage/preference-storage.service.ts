import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { isNativePlatform } from '../utils/native-platform.util';
import {
  isExcludedPreferenceStorageKey,
  isPreferenceStorageKey,
  PREFERENCE_STORAGE_MIGRATION_KEY,
} from './preference-keys';

let preferenceStorageInstance: PreferenceStorageService | null = null;

function setPreferenceStorageInstance(instance: PreferenceStorageService | null): void {
  preferenceStorageInstance = instance;
}

/** Clears the module-level singleton so Vitest suites do not leak storage state. */
export function resetPreferenceStorageForTesting(): void {
  setPreferenceStorageInstance(null);
}

export function readPreference(key: string): string | null {
  if (preferenceStorageInstance) {
    return preferenceStorageInstance.getItem(key);
  }

  return readWebStorageItem(key);
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

function writeWebStorageItem(key: string, value: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
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
  private nativePreferencesEnabled = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    setPreferenceStorageInstance(this);

    if (!isNativePlatform()) {
      this.initialized = true;
      return;
    }

    console.info('[preference-storage] initializing native preferences');

    let migratedKeys: string[] = [];
    let migrationPending = false;

    try {
      const migrationResult = await this.migrateFromLocalStorageIfNeeded();
      migratedKeys = migrationResult.migratedKeys;
      migrationPending = migrationResult.migrationPending;

      if (migrationResult.migrationPending) {
        console.info('[preference-storage] migrating_from_localstorage', {
          keyCount: migratedKeys.length,
        });
      }

      await this.reclaimExcludedKeysFromPreferences();
      await this.hydrateCacheFromPreferences();
      this.nativePreferencesEnabled = true;

      console.info('[preference-storage] native_preferences_ready', {
        cachedKeyCount: this.cache.size,
        migrationPending,
      });

      await this.finalizeMigration(migratedKeys, migrationPending);
    } catch (error: unknown) {
      this.nativePreferencesEnabled = false;
      this.cache.clear();
      console.warn(
        '[preference-storage] native_preferences_init_failed, falling back to localStorage',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    this.initialized = true;
  }

  private usesNativePreferences(key: string): boolean {
    return this.nativePreferencesEnabled && isPreferenceStorageKey(key);
  }

  getItem(key: string): string | null {
    if (!this.usesNativePreferences(key)) {
      return readWebStorageItem(key);
    }

    return this.cache.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (!this.usesNativePreferences(key)) {
      writeWebStorageItem(key, value);
      return;
    }

    const previousValue = this.cache.get(key);
    this.cache.set(key, value);
    void Preferences.set({ key, value }).catch(() => {
      if (this.cache.get(key) !== value) {
        return;
      }

      if (previousValue === undefined) {
        this.cache.delete(key);
        return;
      }

      this.cache.set(key, previousValue);
    });
  }

  removeItem(key: string): void {
    if (!this.usesNativePreferences(key)) {
      removeWebStorageItem(key);
      return;
    }

    const previousValue = this.cache.get(key);
    this.cache.delete(key);
    void Preferences.remove({ key }).catch(() => {
      if (this.cache.has(key)) {
        return;
      }

      if (previousValue !== undefined) {
        this.cache.set(key, previousValue);
      }
    });
  }

  keys(): string[] {
    if (!this.nativePreferencesEnabled) {
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

  private async migrateFromLocalStorageIfNeeded(): Promise<{
    migratedKeys: string[];
    migrationPending: boolean;
  }> {
    const migrationResult = await Preferences.get({ key: PREFERENCE_STORAGE_MIGRATION_KEY });

    if (migrationResult.value === '1') {
      return { migratedKeys: [], migrationPending: false };
    }

    if (typeof window === 'undefined') {
      return { migratedKeys: [], migrationPending: false };
    }

    const migratedKeys: string[] = [];
    const keysToMigrate = this.readWebStorageKeys().filter(isPreferenceStorageKey);

    for (const key of keysToMigrate) {
      const value = readWebStorageItem(key);

      if (typeof value !== 'string') {
        continue;
      }

      await Preferences.set({ key, value });
      migratedKeys.push(key);
    }

    return { migratedKeys, migrationPending: true };
  }

  private async finalizeMigration(
    migratedKeys: string[],
    migrationPending: boolean
  ): Promise<void> {
    if (!migrationPending) {
      return;
    }

    await Preferences.set({ key: PREFERENCE_STORAGE_MIGRATION_KEY, value: '1' });

    for (const key of migratedKeys) {
      removeWebStorageItem(key);
    }
  }

  private async reclaimExcludedKeysFromPreferences(): Promise<void> {
    const result = await Preferences.keys();

    for (const key of result.keys) {
      if (!isExcludedPreferenceStorageKey(key)) {
        continue;
      }

      const entry = await Preferences.get({ key });

      if (typeof entry.value === 'string') {
        if (!writeWebStorageItem(key, entry.value)) {
          continue;
        }
      }

      await Preferences.remove({ key });
    }
  }

  private async hydrateCacheFromPreferences(): Promise<void> {
    const result = await Preferences.keys();
    const keys = result.keys;

    for (const key of keys) {
      if (!isPreferenceStorageKey(key)) {
        continue;
      }

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
