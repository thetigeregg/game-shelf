import { GameWebsite } from '../../core/models/game.models';

export type DetailWebsiteSearchProvider = 'google' | 'youtube' | 'wikipedia' | 'gamefaqs';

const SEARCH_PROVIDER_URL_BUILDERS: Record<
  DetailWebsiteSearchProvider,
  (encodedQuery: string) => string
> = {
  google: (encodedQuery) => `https://www.google.com/search?q=${encodedQuery}`,
  youtube: (encodedQuery) => `https://www.youtube.com/results?search_query=${encodedQuery}`,
  wikipedia: (encodedQuery) => `https://en.wikipedia.org/w/index.php?search=${encodedQuery}`,
  gamefaqs: (encodedQuery) => `https://gamefaqs.gamespot.com/search?game=${encodedQuery}`,
};

export interface DetailWebsiteModalItem {
  key: string;
  label: string;
  url: string;
  icon: DetailWebsiteModalIcon;
}

export type DetailWebsiteModalIcon =
  | 'google'
  | 'youtube'
  | 'twitch'
  | 'discord'
  | 'bluesky'
  | 'reddit'
  | 'gamefaqs'
  | 'nintendo'
  | 'xbox'
  | 'wikipedia'
  | 'epicgames'
  | 'steam'
  | 'playstation'
  | 'appstore'
  | 'googleplay'
  | 'itchdotio'
  | 'gogdotcom'
  | 'ion:globe'
  | 'ion:library'
  | 'ion:link';

interface DetailWebsiteCandidate extends DetailWebsiteModalItem {
  typeId: number | null;
  priority: number;
}

const WIKIPEDIA_TYPE_ID = 3;
const YOUTUBE_TYPE_ID = 9;
const ALLOWED_MODAL_TYPE_IDS = new Set([
  1, 2, 3, 6, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 22, 23, 24,
]);

export function buildDetailWebsiteModalItems(options: {
  websites: GameWebsite[] | null | undefined;
  buildSearchUrl: (provider: DetailWebsiteSearchProvider) => string | null;
}): DetailWebsiteModalItem[] {
  let googleItem: DetailWebsiteModalItem | null = null;
  let gameFaqsItem: DetailWebsiteModalItem | null = null;
  const googleUrl = options.buildSearchUrl('google');
  const gamefaqsUrl = options.buildSearchUrl('gamefaqs');

  if (googleUrl) {
    googleItem = {
      key: 'fixed:google',
      label: 'Google',
      url: googleUrl,
      icon: 'google',
    };
  }

  if (gamefaqsUrl) {
    gameFaqsItem = {
      key: 'fixed:gamefaqs',
      label: 'GameFAQs',
      url: gamefaqsUrl,
      icon: 'gamefaqs',
    };
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
      icon: resolveWebsiteIcon(wikipediaWebsite, 'Wikipedia'),
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
        icon: 'wikipedia',
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
      icon: resolveWebsiteIcon(youtubeWebsite, 'YouTube'),
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
        icon: 'youtube',
        typeId: YOUTUBE_TYPE_ID,
        priority: Number.MAX_SAFE_INTEGER,
      });
    }
  }

  candidates.sort(compareCandidates);

  const officialWebsiteItems = candidates.filter((candidate) => candidate.typeId === 1);
  const communityWikiItems = candidates.filter((candidate) => candidate.typeId === 2);
  const wikipediaItems = candidates.filter((candidate) => candidate.typeId === WIKIPEDIA_TYPE_ID);
  const leadingKeys = new Set([
    ...officialWebsiteItems.map((candidate) => candidate.key),
    ...communityWikiItems.map((candidate) => candidate.key),
    ...wikipediaItems.map((candidate) => candidate.key),
  ]);
  const remainingItems = candidates.filter((candidate) => !leadingKeys.has(candidate.key));

  return [
    ...officialWebsiteItems,
    ...communityWikiItems,
    ...wikipediaItems,
    ...(gameFaqsItem ? [gameFaqsItem] : []),
    ...remainingItems,
    ...(googleItem ? [googleItem] : []),
  ];
}

export function buildDetailWebsiteSearchUrl(
  query: string | null | undefined,
  provider: DetailWebsiteSearchProvider
): string | null {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  if (normalizedQuery.length === 0) {
    return null;
  }

  const encodedQuery = encodeURIComponent(normalizedQuery);
  return SEARCH_PROVIDER_URL_BUILDERS[provider](encodedQuery);
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

    if (!isAllowedWebsite(website)) {
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

function isAllowedWebsite(website: GameWebsite): boolean {
  if (isWikipediaWebsite(website) || isYouTubeWebsite(website)) {
    return true;
  }

  const typeId = normalizePositiveInteger(website.typeId);
  if (typeId !== null) {
    return ALLOWED_MODAL_TYPE_IDS.has(typeId);
  }

  return isKnownStorefrontUrl(website.url);
}

function createWebsiteCandidate(website: GameWebsite, priority: number): DetailWebsiteCandidate {
  return {
    key: `website:${buildWebsiteDedupKey(website)}`,
    label: resolveWebsiteLabel(website),
    url: website.url,
    icon: resolveWebsiteIcon(website),
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

function isKnownStorefrontUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (hostname === 'store.steampowered.com' || hostname.endsWith('.steampowered.com')) {
      return true;
    }
    if (hostname === 'store.playstation.com' || hostname.endsWith('.playstation.com')) {
      return true;
    }
    if (hostname === 'xbox.com' || hostname.endsWith('.xbox.com')) {
      return true;
    }
    if (hostname === 'microsoft.com' || hostname.endsWith('.microsoft.com')) {
      return pathname.includes('/store/');
    }
    if (
      hostname === 'nintendo.com' ||
      hostname.endsWith('.nintendo.com') ||
      hostname.endsWith('.nintendo-europe.com')
    ) {
      return true;
    }
    if (hostname === 'store.epicgames.com' || hostname.endsWith('.epicgames.com')) {
      return true;
    }
    if (hostname === 'gog.com' || hostname.endsWith('.gog.com')) {
      return true;
    }
    if (hostname === 'itch.io' || hostname.endsWith('.itch.io')) {
      return true;
    }
    if (hostname === 'apps.apple.com') {
      return true;
    }
    if (hostname === 'play.google.com') {
      return true;
    }
    return false;
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

  const inferredLabel = resolveWebsiteLabelFromHostname(website.url);
  if (inferredLabel) {
    return inferredLabel;
  }

  try {
    return new URL(website.url).hostname;
  } catch {
    return website.url;
  }
}

function resolveWebsiteLabelFromHostname(url: string): string | null {
  const icon = resolveWebsiteIconFromHostname(url);
  if (icon === 'steam') {
    return 'Steam';
  }
  if (icon === 'xbox') {
    return 'Xbox';
  }
  if (icon === 'playstation') {
    return 'PlayStation';
  }
  if (icon === 'nintendo') {
    return 'Nintendo';
  }
  if (icon === 'epicgames') {
    return 'Epic Games Store';
  }
  if (icon === 'gogdotcom') {
    return 'GOG';
  }
  if (icon === 'itchdotio') {
    return 'itch.io';
  }
  if (icon === 'appstore') {
    return 'App Store';
  }
  if (icon === 'googleplay') {
    return 'Google Play';
  }

  return null;
}

function resolveWebsiteIcon(website: GameWebsite, fallbackLabel?: string): DetailWebsiteModalIcon {
  const typeId = normalizePositiveInteger(website.typeId);
  if (typeId === 1) {
    return 'ion:globe';
  }
  if (typeId === 2) {
    return 'ion:library';
  }
  if (typeId === 6) {
    return 'twitch';
  }
  if (typeId === 18) {
    return 'discord';
  }
  if (typeId === 9) {
    return 'youtube';
  }
  if (typeId === 10) {
    return 'appstore';
  }
  if (typeId === 12) {
    return 'googleplay';
  }
  if (typeId === 13) {
    return 'steam';
  }
  if (typeId === 15) {
    return 'itchdotio';
  }
  if (typeId === 16) {
    return 'epicgames';
  }
  if (typeId === 17) {
    return 'gogdotcom';
  }
  if (typeId === 23) {
    return 'playstation';
  }

  const hostnameIcon = resolveWebsiteIconFromHostname(website.url);
  if (hostnameIcon) {
    return hostnameIcon;
  }

  const label = (fallbackLabel ?? resolveWebsiteLabel(website)).trim().toLowerCase();
  if (label === 'google') {
    return 'google';
  }
  if (label === 'community wiki') {
    return 'ion:library';
  }
  if (label === 'youtube') {
    return 'youtube';
  }
  if (label === 'twitch') {
    return 'twitch';
  }
  if (label === 'discord') {
    return 'discord';
  }
  if (label === 'bluesky') {
    return 'bluesky';
  }
  if (label === 'reddit') {
    return 'reddit';
  }
  if (label === 'gamefaqs') {
    return 'gamefaqs';
  }
  if (label === 'nintendo' || label === 'nintendo eshop') {
    return 'nintendo';
  }
  if (label === 'xbox' || label === 'xbox games store' || label === 'xbox marketplace') {
    return 'xbox';
  }
  if (label === 'wikipedia') {
    return 'wikipedia';
  }
  if (label === 'epic' || label === 'epic games' || label === 'epic games store') {
    return 'epicgames';
  }
  if (label === 'steam') {
    return 'steam';
  }
  if (label === 'playstation') {
    return 'playstation';
  }
  if (label === 'app store (iphone)' || label === 'app store') {
    return 'appstore';
  }
  if (label === 'google play') {
    return 'googleplay';
  }
  if (label === 'itch' || label === 'itch.io') {
    return 'itchdotio';
  }
  if (label === 'gog' || label === 'gog.com') {
    return 'gogdotcom';
  }
  if (label === 'official website') {
    return 'ion:globe';
  }

  return 'ion:link';
}

function resolveWebsiteIconFromHostname(url: string): DetailWebsiteModalIcon | null {
  if (matchesHostname(url, ['play.google.com'])) {
    return 'googleplay';
  }
  if (matchesHostname(url, ['apps.apple.com'])) {
    return 'appstore';
  }
  if (matchesHostname(url, ['google.com'])) {
    return 'google';
  }
  if (matchesHostname(url, ['youtube.com', 'youtu.be'])) {
    return 'youtube';
  }
  if (matchesHostname(url, ['twitch.tv'])) {
    return 'twitch';
  }
  if (matchesHostname(url, ['discord.com', 'discord.gg'])) {
    return 'discord';
  }
  if (matchesHostname(url, ['bsky.app'])) {
    return 'bluesky';
  }
  if (matchesHostname(url, ['reddit.com', 'redd.it'])) {
    return 'reddit';
  }
  if (matchesHostname(url, ['gamefaqs.gamespot.com'])) {
    return 'gamefaqs';
  }
  if (matchesHostname(url, ['nintendo.com'])) {
    return 'nintendo';
  }
  if (matchesHostname(url, ['xbox.com'])) {
    return 'xbox';
  }
  if (matchesHostname(url, ['wikipedia.org'])) {
    return 'wikipedia';
  }
  if (matchesHostname(url, ['epicgames.com'])) {
    return 'epicgames';
  }
  if (matchesHostname(url, ['steampowered.com', 'steamcommunity.com'])) {
    return 'steam';
  }
  if (matchesHostname(url, ['playstation.com'])) {
    return 'playstation';
  }
  if (matchesHostname(url, ['itch.io'])) {
    return 'itchdotio';
  }
  if (matchesHostname(url, ['gog.com'])) {
    return 'gogdotcom';
  }

  return null;
}

function normalizePositiveInteger(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
}
