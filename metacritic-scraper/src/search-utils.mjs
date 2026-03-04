export function normalizeTitle(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseMetacriticScore(rawValue) {
  const text = String(rawValue ?? '')
    .toLowerCase()
    .trim();
  if (text.length === 0 || text.includes('tbd') || text.includes('null')) {
    return null;
  }

  const match = text.match(/\b([1-9]\d?|100)\b/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
}

export function buildSearchTitleVariants(title) {
  const base = String(title ?? '').trim();
  if (base.length === 0) {
    return [];
  }

  const normalized = normalizeTitle(base);
  const titleCase = normalized
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');

  return [...new Set([base, titleCase].filter((value) => value.length > 0))];
}

export function buildMetacriticSearchUrl(query) {
  const normalizedQuery = normalizeTitle(query);
  const queryForPath = normalizedQuery.length > 0 ? normalizedQuery : String(query ?? '').trim();
  const encodedPathQuery = encodeURIComponent(queryForPath);
  return `https://www.metacritic.com/search/${encodedPathQuery}/?category=13`;
}
