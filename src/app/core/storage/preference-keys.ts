export const PREFERENCE_KEY_PREFIXES = ['game-shelf', 'game_shelf_'] as const;

export const PREFERENCE_STORAGE_MIGRATION_KEY = 'game-shelf:preference-storage-migration-v1';

export const E2E_FIXTURE_STORAGE_KEY = 'game-shelf:e2e-fixture';

export const PREFERENCE_STORAGE_EXCLUDED_KEYS = [E2E_FIXTURE_STORAGE_KEY] as const;

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
