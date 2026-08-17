// Xenia Canary's compat data lives as GitHub Issues (xenia-canary/game-compatibility), but
// xenia-manager's site already aggregates + normalizes those issues into a static JSON hosted
// on GitHub Pages, with no anti-bot protection, so this can be fetched live like xemu's.
const XENIA_COMPAT_DATA_URL =
  'https://xenia-manager.github.io/database/data/game-compatibility/canary.json';

// Xenia has no "Perfect" tier — "Playable" is the ceiling (this platform's bestStatus is
// "playable", not "perfect"). Everything else (Gameplay/Loads/Unplayable/Unknown) folds
// into "incomplete".
function mapRawStatus(rawLabel) {
  const normalized = String(rawLabel ?? '')
    .trim()
    .toLowerCase();

  if (normalized === 'playable') {
    return 'playable';
  }

  return 'incomplete';
}

export function mapLabel(rawLabel) {
  return mapRawStatus(rawLabel);
}

// getBrowser/dumpDir are unused here — this parser does a plain HTTPS fetch, no browser or
// local file needed. Kept in the signature for parity with browser/dump-based parsers.
export async function fetchList(_getBrowser, { timeoutMs }) {
  const response = await fetch(XENIA_COMPAT_DATA_URL, {
    signal: AbortSignal.timeout(timeoutMs ?? 25000),
  });

  if (!response.ok) {
    throw new Error(`Xenia compat data request failed with status ${response.status}`);
  }

  const entries = await response.json();

  if (!Array.isArray(entries)) {
    throw new Error('Xenia compat data response was not an array.');
  }

  return entries
    .filter((entry) => entry && typeof entry.title === 'string' && entry.title.trim().length > 0)
    .map((entry) => ({
      rawTitle: entry.title.trim(),
      rawLabel: String(entry.state ?? '').trim(),
      normalizedStatus: mapRawStatus(entry.state),
      sourceId: typeof entry.id === 'string' ? entry.id : null,
      sourceUrl: typeof entry.url === 'string' ? entry.url : XENIA_COMPAT_DATA_URL,
    }));
}

export const xeniaParser = { fetchList, mapLabel };
