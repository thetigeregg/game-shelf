export const PREFERENCE_KEY_PREFIXES = ['game-shelf', 'game_shelf_'] as const;

export const PREFERENCE_STORAGE_MIGRATION_KEY = 'game-shelf:preference-storage-migration-v1';

export const SQLITE_MIGRATION_KEY = 'game-shelf:sqlite-migration-v1';

export const E2E_FIXTURE_STORAGE_KEY = 'game-shelf:e2e-fixture';

export const DEBUG_LOGS_STORAGE_KEY = 'game-shelf:debug-logs:v2';

export const DEBUG_LOGS_LEGACY_STORAGE_KEY = 'game-shelf:debug-logs:v1';

export const PREFERENCE_STORAGE_EXCLUDED_KEYS = [
  E2E_FIXTURE_STORAGE_KEY,
  DEBUG_LOGS_STORAGE_KEY,
  DEBUG_LOGS_LEGACY_STORAGE_KEY,
] as const;

export const SETTINGS_EXPORT_EXCLUDED_KEYS = [
  PREFERENCE_STORAGE_MIGRATION_KEY,
  SQLITE_MIGRATION_KEY,
  E2E_FIXTURE_STORAGE_KEY,
  DEBUG_LOGS_STORAGE_KEY,
  DEBUG_LOGS_LEGACY_STORAGE_KEY,
] as const;

export function isExcludedPreferenceStorageKey(key: string): boolean {
  return PREFERENCE_STORAGE_EXCLUDED_KEYS.includes(
    key as (typeof PREFERENCE_STORAGE_EXCLUDED_KEYS)[number]
  );
}

export function isPreferenceStorageKey(key: string): boolean {
  if (
    PREFERENCE_STORAGE_EXCLUDED_KEYS.includes(
      key as (typeof PREFERENCE_STORAGE_EXCLUDED_KEYS)[number]
    )
  ) {
    return false;
  }

  return PREFERENCE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function isExportableSettingsKey(key: string): boolean {
  return !SETTINGS_EXPORT_EXCLUDED_KEYS.includes(
    key as (typeof SETTINGS_EXPORT_EXCLUDED_KEYS)[number]
  );
}
