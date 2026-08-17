// Vita3K's compat data lives as GitHub Issues (Vita3K/compatibility), but the Vita3K org
// runs its own purpose-built Cloudflare Worker (Vita3K/api) that cron-refreshes from those
// issues every minute and serves clean JSON with no anti-bot protection, so this can be
// fetched live — no manual dump, no browser, no pagination.
const VITA3K_COMPAT_DATA_URL = 'https://vita3k-api.pedro.moe/list/commercial';

// Vita3K has no "Perfect" tier — "Playable" is the ceiling (this platform's bestStatus is
// "playable", not "perfect"). Everything else (Ingame +/-, Intro, Menu, Bootable, Nothing)
// folds into "incomplete".
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
  const response = await fetch(VITA3K_COMPAT_DATA_URL, {
    signal: AbortSignal.timeout(timeoutMs ?? 25000),
  });

  if (!response.ok) {
    throw new Error(`Vita3K compat data request failed with status ${response.status}`);
  }

  const body = await response.json();
  const games = Array.isArray(body?.list) ? body.list : null;

  if (!games) {
    throw new Error('Vita3K compat data response had no "list" array.');
  }

  return games
    .filter((entry) => entry && typeof entry.name === 'string' && entry.name.trim().length > 0)
    .map((entry) => ({
      rawTitle: entry.name.trim(),
      rawLabel: String(entry.status ?? '').trim(),
      normalizedStatus: mapRawStatus(entry.status),
      sourceId: typeof entry.titleId === 'string' ? entry.titleId : null,
      sourceUrl:
        typeof entry.issueId === 'number'
          ? `https://github.com/Vita3K/compatibility/issues/${entry.issueId}`
          : VITA3K_COMPAT_DATA_URL,
    }));
}

export const vita3kParser = { fetchList, mapLabel };
