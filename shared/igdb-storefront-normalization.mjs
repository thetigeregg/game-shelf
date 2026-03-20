const STEAM_APP_URL_PATTERN = /store\.steampowered\.com\/app\/(\d+)/i;

const EXTERNAL_GAME_CATEGORY_NAMES = new Map([
  [1, 'steam'],
  [5, 'gog'],
  [10, 'youtube'],
  [11, 'microsoft'],
  [13, 'apple'],
  [14, 'twitch'],
  [15, 'android'],
  [20, 'amazon_asin'],
  [22, 'amazon_luna'],
  [23, 'amazon_adg'],
  [26, 'epic_game_store'],
  [28, 'oculus'],
  [29, 'utomik'],
  [30, 'itch_io'],
  [31, 'xbox_marketplace'],
  [32, 'kartridge'],
  [36, 'playstation_store_us'],
  [37, 'focus_entertainment'],
  [54, 'xbox_game_pass_ultimate_cloud'],
  [55, 'gamejolt'],
]);

const WEBSITE_CATEGORY_NAMES = new Map([
  [1, 'official'],
  [2, 'wikia'],
  [3, 'wikipedia'],
  [4, 'facebook'],
  [5, 'twitter'],
  [6, 'twitch'],
  [8, 'instagram'],
  [9, 'youtube'],
  [10, 'iphone'],
  [11, 'ipad'],
  [12, 'android'],
  [13, 'steam'],
  [14, 'reddit'],
  [15, 'itch'],
  [16, 'epicgames'],
  [17, 'gog'],
  [18, 'discord'],
  [19, 'bluesky'],
]);

const PROVIDER_LABELS = {
  steam: 'Steam',
  playstation: 'PlayStation',
  xbox: 'Xbox',
  nintendo: 'Nintendo',
  epic: 'Epic Games Store',
  gog: 'GOG',
  itch: 'itch.io',
  apple: 'Apple App Store',
  android: 'Google Play',
  amazon: 'Amazon',
  oculus: 'Meta Quest',
  gamejolt: 'Game Jolt',
  kartridge: 'Kartridge',
  utomik: 'Utomik',
  unknown: 'Unknown Store',
};

function parsePositiveInteger(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function normalizeText(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeHttpUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return null;
  }

  const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeLookupKey(value) {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
    : '';
}

function buildSteamUrlFromUid(uid) {
  const steamAppId = parsePositiveInteger(uid);
  return steamAppId !== null ? `https://store.steampowered.com/app/${String(steamAppId)}` : null;
}

function inferProviderFromHost(url) {
  const normalizedUrl = normalizeHttpUrl(url);
  if (!normalizedUrl) {
    return null;
  }

  let hostname = '';
  let pathname = '';

  try {
    const parsed = new URL(normalizedUrl);
    hostname = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
  } catch {
    return null;
  }

  if (hostname === 'store.steampowered.com' || hostname.endsWith('.steampowered.com')) {
    return 'steam';
  }
  if (hostname === 'store.playstation.com' || hostname.endsWith('.playstation.com')) {
    return 'playstation';
  }
  if (hostname === 'xbox.com' || hostname.endsWith('.xbox.com')) {
    return 'xbox';
  }
  if (hostname === 'microsoft.com' || hostname.endsWith('.microsoft.com')) {
    return pathname.includes('/store/') ? 'xbox' : null;
  }
  if (
    hostname === 'nintendo.com' ||
    hostname.endsWith('.nintendo.com') ||
    hostname.endsWith('.nintendo-europe.com')
  ) {
    return 'nintendo';
  }
  if (hostname === 'store.epicgames.com' || hostname.endsWith('.epicgames.com')) {
    return 'epic';
  }
  if (hostname === 'gog.com' || hostname.endsWith('.gog.com')) {
    return 'gog';
  }
  if (hostname === 'itch.io' || hostname.endsWith('.itch.io')) {
    return 'itch';
  }
  if (hostname === 'apps.apple.com') {
    return 'apple';
  }
  if (hostname === 'play.google.com') {
    return 'android';
  }
  if (hostname === 'amazon.com' || hostname.endsWith('.amazon.com')) {
    return 'amazon';
  }
  if (
    hostname === 'oculus.com' ||
    hostname.endsWith('.oculus.com') ||
    hostname === 'meta.com' ||
    hostname.endsWith('.meta.com')
  ) {
    return pathname.includes('/experiences/') || pathname.includes('/app/') ? 'oculus' : null;
  }
  if (hostname === 'utomik.com' || hostname.endsWith('.utomik.com')) {
    return 'utomik';
  }
  if (hostname === 'gamejolt.com' || hostname.endsWith('.gamejolt.com')) {
    return 'gamejolt';
  }
  if (hostname === 'kartridge.com' || hostname.endsWith('.kartridge.com')) {
    return 'kartridge';
  }

  return null;
}

function classifyProvider(sourceName, url) {
  const key = normalizeLookupKey(sourceName);

  if (key.includes('steam')) {
    return 'steam';
  }
  if (key.includes('playstation') || key.includes('psstore')) {
    return 'playstation';
  }
  if (key.includes('xbox') || key.includes('microsoft') || key.includes('gamepass')) {
    return 'xbox';
  }
  if (key.includes('nintendo') || key.includes('eshop')) {
    return 'nintendo';
  }
  if (key.includes('epic')) {
    return 'epic';
  }
  if (key === 'gog' || key.includes('goodoldgames')) {
    return 'gog';
  }
  if (key.includes('itch')) {
    return 'itch';
  }
  if (key.includes('apple') || key.includes('iphone') || key.includes('ipad')) {
    return 'apple';
  }
  if (key.includes('android') || key.includes('googleplay')) {
    return 'android';
  }
  if (key.includes('amazon')) {
    return 'amazon';
  }
  if (key.includes('oculus') || key.includes('metaquest')) {
    return 'oculus';
  }
  if (key.includes('utomik')) {
    return 'utomik';
  }
  if (key.includes('gamejolt')) {
    return 'gamejolt';
  }
  if (key.includes('kartridge')) {
    return 'kartridge';
  }

  return inferProviderFromHost(url);
}

function normalizeCountryCode(value) {
  if (Array.isArray(value)) {
    return normalizeCountryCode(value[0]);
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if (normalized.length === 2 || /^\d+$/.test(normalized)) {
      return normalized;
    }
  }

  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return String(value);
  }

  return null;
}

function resolveSourceName(entry, options, sourceKind) {
  const sourceId =
    parsePositiveInteger(entry?.external_game_source ?? entry?.type) ??
    parsePositiveInteger(entry?.category);

  if (sourceKind === 'external_game') {
    if (sourceId !== null) {
      const mapped =
        options?.externalGameSourceNames?.get(sourceId) ??
        EXTERNAL_GAME_CATEGORY_NAMES.get(sourceId);
      if (typeof mapped === 'string' && mapped.trim().length > 0) {
        return mapped.trim();
      }
    }
  } else if (sourceId !== null) {
    const mapped = options?.websiteTypeNames?.get(sourceId) ?? WEBSITE_CATEGORY_NAMES.get(sourceId);
    if (typeof mapped === 'string' && mapped.trim().length > 0) {
      return mapped.trim();
    }
  }

  return null;
}

function getProviderLabel(provider) {
  return PROVIDER_LABELS[provider] ?? PROVIDER_LABELS.unknown;
}

function createStorefrontLink(entry, sourceKind, options) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const sourceName = resolveSourceName(entry, options, sourceKind);
  const providerFromNameOrHost = classifyProvider(sourceName, entry.url);
  const uid = normalizeText(entry.uid);
  const url =
    normalizeHttpUrl(entry.url) ??
    (providerFromNameOrHost === 'steam' ? buildSteamUrlFromUid(uid) : null);
  if (!url) {
    return null;
  }

  const provider = providerFromNameOrHost ?? inferProviderFromHost(url);
  if (!provider) {
    return null;
  }

  const sourceId =
    parsePositiveInteger(entry.external_game_source ?? entry.type) ??
    parsePositiveInteger(entry.category);

  return {
    provider,
    providerLabel: getProviderLabel(provider),
    url,
    sourceKind,
    sourceId,
    sourceName,
    uid,
    platformIgdbId: parsePositiveInteger(entry.platform),
    countryCode: sourceKind === 'external_game' ? normalizeCountryCode(entry.countries) : null,
    releaseFormat:
      sourceKind === 'external_game' ? parsePositiveInteger(entry.game_release_format) : null,
    trusted: sourceKind === 'website' && typeof entry.trusted === 'boolean' ? entry.trusted : null,
  };
}

export function normalizeIgdbStorefrontLinks(input, options = {}) {
  const externalGames = Array.isArray(input?.externalGames) ? input.externalGames : [];
  const websites = Array.isArray(input?.websites) ? input.websites : [];
  const deduped = new Map();

  for (const entry of externalGames) {
    const normalized = createStorefrontLink(entry, 'external_game', options);
    if (!normalized) {
      continue;
    }

    deduped.set(`${normalized.provider}::${normalized.url}`, normalized);
  }

  for (const entry of websites) {
    const normalized = createStorefrontLink(entry, 'website', options);
    if (!normalized) {
      continue;
    }

    const dedupeKey = `${normalized.provider}::${normalized.url}`;
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, normalized);
    }
  }

  return [...deduped.values()];
}

export function deriveSteamAppIdFromStorefrontLinks(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || entry.provider !== 'steam') {
      continue;
    }

    const fromUid = parsePositiveInteger(entry.uid);
    if (fromUid !== null) {
      return fromUid;
    }

    const url = normalizeHttpUrl(entry.url);
    if (!url) {
      continue;
    }

    const match = STEAM_APP_URL_PATTERN.exec(url);
    if (!match) {
      continue;
    }

    const parsed = parsePositiveInteger(match[1]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}
