export const STEAM_WINDOWS_PLATFORM_IGDB_ID = 6;
/** Priced from the PlayStation Store (see playstation-store-prices.ts). */
export const PLAYSTATION_STORE_PLATFORM_BY_IGDB_ID: ReadonlyMap<number, string> = new Map([
  [48, 'PS4'],
  [167, 'PS5'],
]);
export const PLAYSTATION_STORE_PLATFORM_IGDB_IDS: ReadonlySet<number> = new Set(
  PLAYSTATION_STORE_PLATFORM_BY_IGDB_ID.keys()
);
/** Priced from psprices.com through psprices-scraper: Switch and Switch 2. */
export const PSPRICES_PLATFORM_IGDB_IDS: ReadonlySet<number> = new Set<number>([130, 508]);

export type PricingSource = 'steam_store' | 'playstation_store' | 'psprices';

/** Where a platform's prices come from, or null when it has no price source. */
export function resolvePricingSourceForPlatform(platformIgdbId: number): PricingSource | null {
  if (platformIgdbId === STEAM_WINDOWS_PLATFORM_IGDB_ID) {
    return 'steam_store';
  }
  if (PLAYSTATION_STORE_PLATFORM_IGDB_IDS.has(platformIgdbId)) {
    return 'playstation_store';
  }
  if (PSPRICES_PLATFORM_IGDB_IDS.has(platformIgdbId)) {
    return 'psprices';
  }
  return null;
}
