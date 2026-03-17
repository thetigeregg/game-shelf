import { normalizeTitle } from './search-utils.mjs';

const variantTokens = new Set([
  'remaster',
  'remastered',
  'remake',
  'redux',
  'definitive',
  'special',
  'ultimate',
  'anniversary',
  'goty',
  'edition',
  'collection',
  'complete',
  'director',
  'deluxe',
  'hd',
]);

const romanToArabicSeriesMap = new Map([
  ['i', '1'],
  ['ii', '2'],
  ['iii', '3'],
  ['iv', '4'],
  ['v', '5'],
  ['vi', '6'],
  ['vii', '7'],
  ['viii', '8'],
  ['ix', '9'],
  ['x', '10'],
]);

function hasVariantToken(normalizedTitle) {
  const title = String(normalizedTitle ?? '');
  const tokens = title.split(' ').filter(Boolean);
  if (tokens.some((token) => variantTokens.has(token))) {
    return true;
  }
  return title.includes('game of the year');
}

function canonicalizeSeriesToken(token) {
  if (/^\d+$/.test(token)) {
    return String(Number.parseInt(token, 10));
  }

  return romanToArabicSeriesMap.get(token) ?? null;
}

function extractSeriesTokens(normalizedTitle) {
  return new Set(
    String(normalizedTitle ?? '')
      .split(' ')
      .map((token) => canonicalizeSeriesToken(token))
      .filter((token) => Boolean(token))
  );
}

function normalizeTitleForMatching(value) {
  return normalizeTitle(value)
    .split(' ')
    .filter(Boolean)
    .map((token) => canonicalizeSeriesToken(token) ?? token)
    .join(' ');
}

function hasAddonQualifier(rawTitle, normalizedTitle) {
  const raw = String(rawTitle ?? '').toLowerCase();
  const normalized = String(normalizedTitle ?? '');

  if (
    /\b(dlc|expansion|expansions|season pass|expansion pass|add on|add-on|addon|downloadable content)\b/.test(
      normalized
    )
  ) {
    return true;
  }

  if (/\b(dual pack|bundle)\b/.test(normalized)) {
    return true;
  }

  if (/\bpart\s+[0-9ivx]+\b/.test(normalized)) {
    return true;
  }

  if (raw.includes(' / ') || raw.includes(' + ')) {
    return true;
  }

  return false;
}

function normalizePlatformValue(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\band more\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizePlatform(value) {
  const normalized = normalizePlatformValue(value);

  if (normalized === 'nintendo 3ds' || normalized === '3ds' || normalized === 'nintendo 3 ds') {
    return '3ds';
  }

  if (normalized === 'playstation 5' || normalized === 'ps5') {
    return 'ps5';
  }

  if (normalized === 'playstation 4' || normalized === 'ps4') {
    return 'ps4';
  }

  if (
    normalized === 'playstation vita' ||
    normalized === 'ps vita' ||
    normalized === 'psvita' ||
    normalized === 'vita'
  ) {
    return 'ps vita';
  }

  if (normalized === 'xbox one') {
    return 'xbox one';
  }

  if (
    normalized === 'xbox series x' ||
    normalized === 'xbox series s' ||
    normalized === 'xbox series x s'
  ) {
    return 'xbox series';
  }

  if (normalized === 'nintendo switch' || normalized === 'switch') {
    return 'switch';
  }

  if (normalized === 'pc' || normalized === 'microsoft windows' || normalized === 'windows') {
    return 'pc';
  }

  return normalized;
}

function resolveExpectedPlatformAliases(
  expectedPlatform,
  expectedPlatformIgdbId,
  igdbToMetacriticPlatformDisplayById = new Map()
) {
  const aliases = new Set();

  const byId =
    typeof expectedPlatformIgdbId === 'number' && Number.isInteger(expectedPlatformIgdbId)
      ? (igdbToMetacriticPlatformDisplayById.get(expectedPlatformIgdbId) ?? '')
      : '';
  const normalizedById = canonicalizePlatform(byId);
  if (normalizedById.length > 0) {
    aliases.add(normalizedById);
  }

  const normalizedByName = canonicalizePlatform(expectedPlatform);
  if (normalizedByName.length > 0) {
    aliases.add(normalizedByName);
  }

  return aliases;
}

export function rankCandidate(
  expectedTitle,
  expectedYear,
  expectedPlatform,
  expectedPlatformIgdbId,
  candidate,
  options = {}
) {
  const igdbToMetacriticPlatformDisplayById =
    options.igdbToMetacriticPlatformDisplayById instanceof Map
      ? options.igdbToMetacriticPlatformDisplayById
      : new Map();
  const normalizedExpected = normalizeTitleForMatching(expectedTitle);
  const normalizedCandidate = normalizeTitleForMatching(candidate.title);

  if (!normalizedExpected || !normalizedCandidate) {
    return -1;
  }

  let score = 0;

  if (normalizedExpected === normalizedCandidate) {
    score += 100;
  }

  const expectedTokensList = normalizedExpected.split(' ').filter(Boolean);
  const candidateTokensList = normalizedCandidate.split(' ').filter(Boolean);
  if (expectedTokensList.length === 1 && normalizedExpected !== normalizedCandidate) {
    if (candidateTokensList.length > 1) {
      score -= 18;
    }
  }

  if (
    normalizedExpected.includes(normalizedCandidate) ||
    normalizedCandidate.includes(normalizedExpected)
  ) {
    score += 20;
  }

  const expectedHasAddonQualifier = hasAddonQualifier(expectedTitle, normalizedExpected);
  const candidateHasAddonQualifier = hasAddonQualifier(candidate.title, normalizedCandidate);
  if (expectedHasAddonQualifier !== candidateHasAddonQualifier) {
    score -= candidateHasAddonQualifier ? 30 : 20;
  }

  const expectedHasVariant = hasVariantToken(normalizedExpected);
  const candidateHasVariant = hasVariantToken(normalizedCandidate);
  if (expectedHasVariant !== candidateHasVariant) {
    score -= 18;
  }

  const expectedSeriesTokens = extractSeriesTokens(normalizedExpected);
  const candidateSeriesTokens = extractSeriesTokens(normalizedCandidate);
  if (expectedSeriesTokens.size > 0) {
    const candidateMatchesAnyExpected = [...expectedSeriesTokens].some((token) =>
      candidateSeriesTokens.has(token)
    );
    if (!candidateMatchesAnyExpected) {
      score -= 30;
    } else {
      const hasUnexpectedSeriesToken = [...candidateSeriesTokens].some(
        (token) => !expectedSeriesTokens.has(token)
      );
      if (hasUnexpectedSeriesToken) {
        score -= 12;
      }
    }
  } else if (candidateSeriesTokens.size > 0) {
    score -= 6;
  }

  const expectedTokens = new Set(expectedTokensList);
  const candidateTokens = new Set(candidateTokensList);
  let tokenOverlap = 0;
  for (const token of expectedTokens) {
    if (candidateTokens.has(token)) {
      tokenOverlap += 1;
    }
  }
  score += tokenOverlap * 8;

  if (expectedYear !== null && Number.isInteger(candidate.releaseYear)) {
    const delta = Math.abs(candidate.releaseYear - expectedYear);
    if (delta === 0) {
      score += 20;
    } else if (delta === 1) {
      score += 10;
    } else if (delta <= 3) {
      score += 4;
    } else if (delta >= 10) {
      score -= 20;
    } else if (delta >= 5) {
      score -= 10;
    }
  }

  const expectedPlatformAliases = resolveExpectedPlatformAliases(
    expectedPlatform,
    expectedPlatformIgdbId,
    igdbToMetacriticPlatformDisplayById
  );
  const normalizedCandidatePlatform = canonicalizePlatform(candidate.platform);

  if (expectedPlatformAliases.size > 0 && normalizedCandidatePlatform.length > 0) {
    const isPlatformMatch = [...expectedPlatformAliases].some(
      (expectedAlias) =>
        normalizedCandidatePlatform === expectedAlias ||
        normalizedCandidatePlatform.includes(expectedAlias) ||
        expectedAlias.includes(normalizedCandidatePlatform)
    );

    if (isPlatformMatch) {
      score += 12;
    }
  }

  if (typeof candidate.metacriticScore === 'number') {
    score += 2;
  }

  return score;
}
