import { buildGameKey } from './recommendations/semantic.js';

export interface DiscoveryGameKeyParts {
  igdbGameId: string;
  platformIgdbId: number;
}

export function parseDiscoveryGameKey(value: string): DiscoveryGameKeyParts | null {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  const separatorIndex = normalized.indexOf('::');
  if (separatorIndex <= 0 || separatorIndex + 2 >= normalized.length) {
    return null;
  }

  const igdbGameId = normalized.slice(0, separatorIndex).trim();
  const platformRaw = normalized.slice(separatorIndex + 2).trim();
  if (igdbGameId.length === 0 || !/^-?\d+$/.test(platformRaw)) {
    return null;
  }

  const platformIgdbId = Number.parseInt(platformRaw, 10);
  if (!Number.isInteger(platformIgdbId)) {
    return null;
  }

  return {
    igdbGameId,
    platformIgdbId,
  };
}

export function parseDiscoveryGameKeys(gameKeys: Iterable<string>): DiscoveryGameKeyParts[] {
  const parsed = new Map<string, DiscoveryGameKeyParts>();

  for (const gameKey of gameKeys) {
    const entry = parseDiscoveryGameKey(gameKey);
    if (!entry) {
      continue;
    }

    parsed.set(buildGameKey(entry.igdbGameId, entry.platformIgdbId), entry);
  }

  return [...parsed.values()];
}

export function normalizeDiscoveryGameKeys(gameKeys: Iterable<string>): string[] {
  return parseDiscoveryGameKeys(gameKeys).map((entry) =>
    buildGameKey(entry.igdbGameId, entry.platformIgdbId)
  );
}
