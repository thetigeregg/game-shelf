// Azahar (Citra's community continuation) publishes compat data as a plain JSON file
// directly in its repo, fetchable live via raw.githubusercontent.com with no anti-bot
// protection — no manual dump, no browser, no pagination needed.
const AZAHAR_COMPAT_DATA_URL =
  'https://raw.githubusercontent.com/azahar-emu/compatibility-list/master/compatibility_list.json';

const AZAHAR_LABELS = {
  0: 'Perfect',
  1: 'Great',
  2: 'Okay',
  3: 'Bad',
  4: 'Intro/Menu',
  5: "Won't Boot",
  99: 'Untested',
};

// Azahar's scale is inverted (lower is better) — only 0 (Perfect) and 1 (Great) clear the
// bar; "Great" reads as our "playable" tier per its own description (minimal glitches, close
// to real hardware). Everything else (Okay/Bad/Intro-Menu/Won't-Boot/Untested) folds into
// "incomplete".
function mapRawRating(rating) {
  if (rating === 0) {
    return 'perfect';
  }

  if (rating === 1) {
    return 'playable';
  }

  return 'incomplete';
}

const AZAHAR_LABELS_BY_NORMALIZED_LABEL = new Map(
  Object.entries(AZAHAR_LABELS).map(([rating, label]) => [label.toLowerCase(), Number(rating)])
);

// Accepts either a label ("Perfect", case/whitespace-insensitive) or a raw numeric code
// ("0", "1", ...), matching the shapes rawLabel can take from fetchList and from callers.
export function mapLabel(rawLabel) {
  const normalized = String(rawLabel ?? '')
    .trim()
    .toLowerCase();

  if (AZAHAR_LABELS_BY_NORMALIZED_LABEL.has(normalized)) {
    return mapRawRating(AZAHAR_LABELS_BY_NORMALIZED_LABEL.get(normalized));
  }

  if (normalized in AZAHAR_LABELS) {
    return mapRawRating(Number(normalized));
  }

  return 'incomplete';
}

// getBrowser/dumpDir are unused here — this parser does a plain HTTPS fetch, no browser or
// local file needed. Kept in the signature for parity with browser/dump-based parsers.
export async function fetchList(_getBrowser, { timeoutMs }) {
  const response = await fetch(AZAHAR_COMPAT_DATA_URL, {
    signal: AbortSignal.timeout(timeoutMs ?? 25000),
  });

  if (!response.ok) {
    throw new Error(`Azahar compat data request failed with status ${response.status}`);
  }

  const games = await response.json();

  if (!Array.isArray(games)) {
    throw new Error('Azahar compat data response was not an array.');
  }

  const entries = [];

  for (const game of games) {
    if (!game || typeof game.title !== 'string' || game.title.trim().length === 0) {
      continue;
    }

    const rating = Number(game.compatibility);
    const rawLabel = AZAHAR_LABELS[rating] ?? String(game.compatibility ?? '');
    const normalizedStatus = mapRawRating(rating);
    const releases =
      Array.isArray(game.releases) && game.releases.length > 0 ? game.releases : [{ id: null }];
    const title = game.title.trim();
    const sourceUrl = `https://github.com/azahar-emu/compatibility-list/issues?q=${encodeURIComponent(title)}`;

    for (const release of releases) {
      entries.push({
        rawTitle: title,
        rawLabel,
        normalizedStatus,
        sourceId: typeof release?.id === 'string' ? release.id : null,
        sourceUrl,
      });
    }
  }

  return entries;
}

export const azaharParser = { fetchList, mapLabel };
