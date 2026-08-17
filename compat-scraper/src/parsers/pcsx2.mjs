// PCSX2's compatibility list is a plain, unprotected static JSON file published in the
// pcsx2-net-www repo (the same file their own compat page imports at build time), so unlike
// Dolphin this can be fetched live on every scheduled refresh — no manual dump, no browser.
const PCSX2_COMPAT_DATA_URL =
  'https://raw.githubusercontent.com/PCSX2/pcsx2-net-www/main/static/data/compat/data.min.json';

// "Perfect" and "Playable" map to their own statuses; everything else (Ingame/Menus/Intro/Nothing)
// folds into "incomplete". Must stay consistent with this platform's `bestStatus: "perfect"` config.
function mapRawStatus(rawLabel) {
  const normalized = String(rawLabel ?? '')
    .trim()
    .toLowerCase();

  if (normalized === 'perfect') {
    return 'perfect';
  }

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
  const response = await fetch(PCSX2_COMPAT_DATA_URL, {
    signal: AbortSignal.timeout(timeoutMs ?? 25000),
  });

  if (!response.ok) {
    throw new Error(`PCSX2 compat data request failed with status ${response.status}`);
  }

  const entries = await response.json();

  if (!Array.isArray(entries)) {
    throw new Error('PCSX2 compat data response was not an array.');
  }

  return entries
    .filter((entry) => entry && typeof entry.title === 'string' && entry.title.trim().length > 0)
    .map((entry) => ({
      rawTitle: entry.title.trim(),
      rawLabel: String(entry.status ?? '').trim(),
      normalizedStatus: mapRawStatus(entry.status),
      sourceId: typeof entry.serial === 'string' ? entry.serial : null,
      sourceUrl: entry.wiki_link ?? entry.forum_link ?? PCSX2_COMPAT_DATA_URL,
    }));
}

export const pcsx2Parser = { fetchList, mapLabel };
