export type NormalizedWebsiteProvider =
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

export interface NormalizedWebsite {
  provider: NormalizedWebsiteProvider | null;
  providerLabel: string | null;
  url: string;
  typeId: number | null;
  typeName: string | null;
  trusted: boolean | null;
}

export interface WebsiteNormalizationOptions {
  websiteTypeNames?: ReadonlyMap<number, string> | null;
}

export function normalizeIgdbWebsites(
  input: { websites?: unknown },
  options?: WebsiteNormalizationOptions
): NormalizedWebsite[];

export function deriveSteamAppIdFromWebsites(value: unknown): number | null;
