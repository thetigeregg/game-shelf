export const STEAM_WINDOWS_PLATFORM_IGDB_ID = 6;
/** Priced from the PlayStation Store (see playstation-store-prices.ts). */
export const PLAYSTATION_STORE_PLATFORM_BY_IGDB_ID: ReadonlyMap<number, string> = new Map([
  [48, 'PS4'],
  [167, 'PS5'],
]);
export const PLAYSTATION_STORE_PLATFORM_IGDB_IDS: ReadonlySet<number> = new Set(
  PLAYSTATION_STORE_PLATFORM_BY_IGDB_ID.keys()
);
/** Priced from the Nintendo eShop (see nintendo-eshop-prices.ts). */
export const NINTENDO_ESHOP_PLATFORM_BY_IGDB_ID: ReadonlyMap<number, string> = new Map([
  [130, 'Switch'],
  [508, 'Switch 2'],
]);
export const NINTENDO_ESHOP_PLATFORM_IGDB_IDS: ReadonlySet<number> = new Set(
  NINTENDO_ESHOP_PLATFORM_BY_IGDB_ID.keys()
);
/**
 * Platforms priced from psprices.com through psprices-scraper: none any more (PS4/PS5 moved to the
 * PlayStation Store, Switch/Switch 2 to the Nintendo eShop). 'psprices' stays a known source so
 * prices saved from it are still read until the stores replace them.
 */
export const PSPRICES_PLATFORM_IGDB_IDS: ReadonlySet<number> = new Set<number>();

export type PricingSource = 'steam_store' | 'playstation_store' | 'nintendo_eshop' | 'psprices';

/** Where a platform's prices come from, or null when it has no price source. */
export function resolvePricingSourceForPlatform(platformIgdbId: number): PricingSource | null {
  if (platformIgdbId === STEAM_WINDOWS_PLATFORM_IGDB_ID) {
    return 'steam_store';
  }
  if (PLAYSTATION_STORE_PLATFORM_IGDB_IDS.has(platformIgdbId)) {
    return 'playstation_store';
  }
  if (NINTENDO_ESHOP_PLATFORM_IGDB_IDS.has(platformIgdbId)) {
    return 'nintendo_eshop';
  }
  if (PSPRICES_PLATFORM_IGDB_IDS.has(platformIgdbId)) {
    return 'psprices';
  }
  return null;
}
