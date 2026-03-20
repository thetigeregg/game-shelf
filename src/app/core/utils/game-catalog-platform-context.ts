import type { GameCatalogResult } from '../models/game.models';

export function applyGameCatalogPlatformContext(
  catalog: GameCatalogResult,
  platformIgdbId: number | null | undefined
): GameCatalogResult {
  if (!Number.isInteger(platformIgdbId) || (platformIgdbId as number) <= 0) {
    return catalog;
  }

  const normalizedPlatformIgdbId = platformIgdbId as number;
  const platformOption = Array.isArray(catalog.platformOptions)
    ? (catalog.platformOptions.find((option) => option.id === normalizedPlatformIgdbId) ?? null)
    : null;
  const selectedPlatformName =
    platformOption?.name.trim() ??
    (catalog.platformIgdbId === normalizedPlatformIgdbId &&
    typeof catalog.platform === 'string' &&
    catalog.platform.trim().length > 0
      ? catalog.platform.trim()
      : null);

  return {
    ...catalog,
    platformIgdbId: normalizedPlatformIgdbId,
    platform: selectedPlatformName,
  };
}
