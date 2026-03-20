import { GameWebsite } from '../../core/models/game.models';

export type DetailWebsiteSearchProvider = 'google' | 'youtube' | 'wikipedia' | 'gamefaqs';

export interface DetailWebsiteModalItem {
  key: string;
  label: string;
  url: string;
  icon: string;
}

interface DetailWebsiteCandidate extends DetailWebsiteModalItem {
  typeId: number | null;
  priority: number;
}

const WIKIPEDIA_TYPE_ID = 3;
const YOUTUBE_TYPE_ID = 9;

export function buildDetailWebsiteModalItems(options: {
  websites: GameWebsite[] | null | undefined;
  buildSearchUrl: (provider: DetailWebsiteSearchProvider) => string | null;
}): DetailWebsiteModalItem[] {
  const fixedItems: DetailWebsiteModalItem[] = [];
  const googleUrl = options.buildSearchUrl('google');
  const gamefaqsUrl = options.buildSearchUrl('gamefaqs');

  if (googleUrl) {
    fixedItems.push({
      key: 'fixed:google',
      label: 'Google',
      url: googleUrl,
      icon: 'search',
    });
  }

  if (gamefaqsUrl) {
    fixedItems.push({
      key: 'fixed:gamefaqs',
      label: 'GameFAQs',
      url: gamefaqsUrl,
      icon: 'search',
    });
  }

  const normalizedWebsites = normalizeWebsites(options.websites);
  const wikipediaWebsite =
    normalizedWebsites.find((website) => isWikipediaWebsite(website)) ?? null;
  const youtubeWebsite = normalizedWebsites.find((website) => isYouTubeWebsite(website)) ?? null;
  const specialKeys = new Set<string>();

  if (wikipediaWebsite) {
    specialKeys.add(buildWebsiteDedupKey(wikipediaWebsite));
  }
  if (youtubeWebsite) {
    specialKeys.add(buildWebsiteDedupKey(youtubeWebsite));
  }

  const candidates = normalizedWebsites
    .filter((website) => !specialKeys.has(buildWebsiteDedupKey(website)))
    .map((website, index) => createWebsiteCandidate(website, index));

  if (wikipediaWebsite) {
    candidates.push({
      key: 'special:wikipedia',
      label: 'Wikipedia',
      url: wikipediaWebsite.url,
      icon: 'globe',
      typeId: normalizePositiveInteger(wikipediaWebsite.typeId) ?? WIKIPEDIA_TYPE_ID,
      priority: Number.MAX_SAFE_INTEGER - 1,
    });
  } else {
    const wikipediaSearchUrl = options.buildSearchUrl('wikipedia');
    if (wikipediaSearchUrl) {
      candidates.push({
        key: 'fallback:wikipedia',
        label: 'Wikipedia',
        url: wikipediaSearchUrl,
        icon: 'globe',
        typeId: WIKIPEDIA_TYPE_ID,
        priority: Number.MAX_SAFE_INTEGER - 1,
      });
    }
  }

  if (youtubeWebsite) {
    candidates.push({
      key: 'special:youtube',
      label: 'YouTube',
      url: youtubeWebsite.url,
      icon: 'globe',
      typeId: normalizePositiveInteger(youtubeWebsite.typeId) ?? YOUTUBE_TYPE_ID,
      priority: Number.MAX_SAFE_INTEGER,
    });
  } else {
    const youtubeSearchUrl = options.buildSearchUrl('youtube');
    if (youtubeSearchUrl) {
      candidates.push({
        key: 'fallback:youtube',
        label: 'YouTube',
        url: youtubeSearchUrl,
        icon: 'globe',
        typeId: YOUTUBE_TYPE_ID,
        priority: Number.MAX_SAFE_INTEGER,
      });
    }
  }

  candidates.sort(compareCandidates);
  return [...fixedItems, ...candidates];
}

function normalizeWebsites(websites: GameWebsite[] | null | undefined): GameWebsite[] {
  if (!Array.isArray(websites)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: GameWebsite[] = [];
  for (const website of websites) {
    if (!isValidWebsite(website)) {
      continue;
    }

    const key = buildWebsiteDedupKey(website);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(website);
  }

  return normalized;
}

function isValidWebsite(website: unknown): website is GameWebsite {
  if (!website || typeof website !== 'object') {
    return false;
  }

  const candidate = website as Partial<GameWebsite>;
  const url = typeof candidate.url === 'string' ? candidate.url.trim() : '';
  if (url.length === 0) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildWebsiteDedupKey(website: GameWebsite): string {
  return website.url.trim().toLowerCase();
}

function createWebsiteCandidate(website: GameWebsite, priority: number): DetailWebsiteCandidate {
  return {
    key: `website:${buildWebsiteDedupKey(website)}`,
    label: resolveWebsiteLabel(website),
    url: website.url,
    icon: 'globe',
    typeId: normalizePositiveInteger(website.typeId),
    priority,
  };
}

function compareCandidates(left: DetailWebsiteCandidate, right: DetailWebsiteCandidate): number {
  const leftTypeId = left.typeId ?? Number.MAX_SAFE_INTEGER;
  const rightTypeId = right.typeId ?? Number.MAX_SAFE_INTEGER;
  if (leftTypeId !== rightTypeId) {
    return leftTypeId - rightTypeId;
  }

  const labelOrder = left.label.localeCompare(right.label, undefined, {
    sensitivity: 'base',
  });
  if (labelOrder !== 0) {
    return labelOrder;
  }

  return left.priority - right.priority;
}

function isWikipediaWebsite(website: GameWebsite): boolean {
  if (normalizePositiveInteger(website.typeId) === WIKIPEDIA_TYPE_ID) {
    return true;
  }

  return matchesHostname(website.url, ['wikipedia.org']);
}

function isYouTubeWebsite(website: GameWebsite): boolean {
  if (normalizePositiveInteger(website.typeId) === YOUTUBE_TYPE_ID) {
    return true;
  }

  return matchesHostname(website.url, ['youtube.com', 'youtu.be']);
}

function matchesHostname(url: string, hostnames: string[]): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostnames.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function resolveWebsiteLabel(website: GameWebsite): string {
  const typeName = typeof website.typeName === 'string' ? website.typeName.trim() : '';
  if (typeName.length > 0) {
    return typeName;
  }

  const providerLabel =
    typeof website.providerLabel === 'string' ? website.providerLabel.trim() : '';
  if (providerLabel.length > 0) {
    return providerLabel;
  }

  try {
    return new URL(website.url).hostname;
  } catch {
    return website.url;
  }
}

function normalizePositiveInteger(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
}
