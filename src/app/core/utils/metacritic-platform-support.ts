const SUPPORTED_IGDB_PLATFORM_IDS = [
  3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 20, 21, 24, 34, 37, 38, 39, 41, 46, 48, 49, 130, 167, 169, 471
] as const;

export const METACRITIC_SUPPORTED_IGDB_PLATFORM_IDS = new Set<number>(SUPPORTED_IGDB_PLATFORM_IDS);

export function isMetacriticPlatformSupported(platformIgdbId: number | null | undefined): boolean {
  return (
    typeof platformIgdbId === 'number' &&
    Number.isFinite(platformIgdbId) &&
    Number.isInteger(platformIgdbId) &&
    METACRITIC_SUPPORTED_IGDB_PLATFORM_IDS.has(platformIgdbId)
  );
}
