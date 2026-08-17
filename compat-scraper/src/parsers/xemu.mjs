// xemu's compat.json is served live at xemu.app (generated at build time by xemu-website's
// generate.py from a live compatibility-reports API), with no anti-bot protection, so unlike
// Dolphin this can be fetched live on every scheduled refresh — no manual dump, no browser.
const XEMU_COMPAT_DATA_URL = 'https://xemu.app/compat.json';
const XEMU_TITLE_ID_PATTERN = /^\/titles\/([0-9a-f]+)/i;

// "Perfect" and "Playable" map to their own statuses; everything else (Starts/Intro/Broken)
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

function extractTitleId(url) {
  const match = XEMU_TITLE_ID_PATTERN.exec(String(url ?? ''));
  return match ? match[1] : null;
}

// getBrowser/dumpDir are unused here — this parser does a plain HTTPS fetch, no browser or
// local file needed. Kept in the signature for parity with browser/dump-based parsers.
export async function fetchList(_getBrowser, { timeoutMs }) {
  const response = await fetch(XEMU_COMPAT_DATA_URL, {
    signal: AbortSignal.timeout(timeoutMs ?? 25000),
  });

  if (!response.ok) {
    throw new Error(`xemu compat data request failed with status ${response.status}`);
  }

  const entries = await response.json();

  if (!Array.isArray(entries)) {
    throw new Error('xemu compat data response was not an array.');
  }

  return entries
    .filter((entry) => entry && typeof entry.name === 'string' && entry.name.trim().length > 0)
    .map((entry) => ({
      rawTitle: entry.name.trim(),
      rawLabel: String(entry.status ?? '').trim(),
      normalizedStatus: mapRawStatus(entry.status),
      sourceId: extractTitleId(entry.url),
      sourceUrl:
        typeof entry.url === 'string' ? `https://xemu.app${entry.url}` : XEMU_COMPAT_DATA_URL,
    }));
}

export const xemuParser = { fetchList, mapLabel };
