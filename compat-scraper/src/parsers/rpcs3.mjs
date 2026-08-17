// RPCS3's public API (rpcs3.net/compatibility?api=v1) exposes an "export" mode with all
// entries but no titles, and a paginated "browse" mode with titles but no total-count field —
// requesting a page past the end silently wraps back to page 1 instead of returning empty.
// We paginate the titled mode and detect the wraparound by comparing each page's result ids
// to page 1's. No anti-bot wall (Cloudflare-fronted but not challenge-gated); confirmed with
// plain fetch(), no special headers needed.
const RPCS3_COMPAT_BASE_URL = 'https://rpcs3.net/compatibility';
const RPCS3_PAGE_SIZE = 200; // max allowed by the API's $a_pageresults whitelist
const RPCS3_MAX_PAGES = 50; // defensive cap; ~19 pages covers the full list today

// RPCS3 has no "Perfect" tier — "Playable" is the ceiling (this platform's bestStatus is
// "playable", not "perfect"). Everything else (Ingame/Intro/Loadable/Nothing) folds into
// "incomplete".
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

async function fetchPage(page, timeoutMs) {
  const url = `${RPCS3_COMPAT_BASE_URL}?api=v1&r=${RPCS3_PAGE_SIZE}&p=${page}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs ?? 25000) });

  if (!response.ok) {
    throw new Error(
      `RPCS3 compat data request failed with status ${response.status} (page ${page})`
    );
  }

  const body = await response.json();

  if (body.return_code !== 0 && body.return_code !== 2) {
    throw new Error(`RPCS3 compat API returned return_code ${body.return_code} (page ${page})`);
  }

  return body.results ?? {};
}

// getBrowser/dumpDir are unused here — this parser does plain HTTPS fetches, no browser or
// local file needed. Kept in the signature for parity with browser/dump-based parsers.
export async function fetchList(_getBrowser, { timeoutMs }) {
  const entries = [];
  const seenIds = new Set();
  let firstPageIds = null;

  for (let page = 1; page <= RPCS3_MAX_PAGES; page += 1) {
    const results = await fetchPage(page, timeoutMs);
    const ids = Object.keys(results);

    if (ids.length === 0) {
      break;
    }

    if (firstPageIds === null) {
      firstPageIds = new Set(ids);
    } else if (ids.every((id) => firstPageIds.has(id))) {
      // Wrapped back to page 1's results — no more pages.
      break;
    }

    for (const [gameId, entry] of Object.entries(results)) {
      if (
        seenIds.has(gameId) ||
        !entry ||
        typeof entry.title !== 'string' ||
        entry.title.trim().length === 0
      ) {
        continue;
      }

      seenIds.add(gameId);
      entries.push({
        rawTitle: entry.title.trim(),
        rawLabel: String(entry.status ?? '').trim(),
        normalizedStatus: mapRawStatus(entry.status),
        sourceId: gameId,
        sourceUrl: `${RPCS3_COMPAT_BASE_URL}?g=${encodeURIComponent(gameId)}`,
      });
    }
  }

  return entries;
}

export const rpcs3Parser = { fetchList, mapLabel };
