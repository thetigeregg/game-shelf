export type NormalizedStorefrontProvider =
  | 'steam'
  | 'playstation'
  | 'xbox'
  | 'nintendo'
  | 'epic'
  | 'gog'
  | 'itch'
  | 'apple'
  | 'android'
  | 'amazon'
  | 'oculus'
  | 'gamejolt'
  | 'kartridge'
  | 'utomik'
  | 'unknown';

export type NormalizedStorefrontSourceKind = 'external_game' | 'website';

export interface NormalizedStorefrontLink {
  provider: NormalizedStorefrontProvider;
  providerLabel: string;
  url: string;
  sourceKind: NormalizedStorefrontSourceKind;
  sourceId: number | null;
  sourceName: string | null;
  uid: string | null;
  platformIgdbId: number | null;
  countryCode: string | null;
  releaseFormat: number | null;
  trusted: boolean | null;
}

export interface StorefrontNormalizationOptions {
  externalGameSourceNames?: ReadonlyMap<number, string> | null;
  websiteTypeNames?: ReadonlyMap<number, string> | null;
}

export function normalizeIgdbStorefrontLinks(
  input: { externalGames?: unknown; websites?: unknown },
  options?: StorefrontNormalizationOptions
): NormalizedStorefrontLink[];

export function deriveSteamAppIdFromStorefrontLinks(value: unknown): number | null;
