// Vita3K's compat data lives as GitHub Issues (Vita3K/compatibility), but the Vita3K org
// runs its own purpose-built Cloudflare Worker (Vita3K/api, served at api.vita3k.org) that
// cron-refreshes from those issues every minute and serves clean JSON with no anti-bot
// protection, so this can be fetched live — no manual dump, no browser, no pagination.
const VITA3K_COMPAT_DATA_URL = 'https://api.vita3k.org/list/commercial';

// Each entry carries every GitHub label on its issue — the compat status plus bug tags
// like "graphics bug" or "crash" — so the status has to be picked out of the mix. Ordered
// best to worst, matching Vita3K's own CompatibilityState ranking.
const VITA3K_STATUS_LABELS = [
  'Playable',
  'Ingame +',
  'Ingame -',
  'Menu',
  'Intro',
  'Bootable',
  'Nothing',
];

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

// The API serves `labels` as a JSON-encoded string ('[{"name":"Playable","color":"…"}]'),
// though upstream's own types declare an array — accept both. Anything else yields no labels.
export function parseLabelNames(labels) {
  let parsed = labels;

  if (typeof labels === 'string') {
    try {
      parsed = JSON.parse(labels);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((label) => (typeof label === 'string' ? label : label?.name))
    .filter((name) => typeof name === 'string')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

// A handful of issues carry two status labels (e.g. "Playable" + "Intro"). Take the worst
// one, so an ambiguous entry is never reported as playable. Returns '' when there is none.
export function resolveStatusLabel(labelNames) {
  const present = new Set(labelNames.map((name) => name.toLowerCase()));

  return VITA3K_STATUS_LABELS.findLast((status) => present.has(status.toLowerCase())) ?? '';
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

  // `date: 0` means upstream cleared the list and will repopulate it on its next cron run.
  // Fail the refresh so it is retried on the short failure backoff, rather than recording
  // an empty (or half-filled) list as a successful refresh.
  if (body.date === 0) {
    throw new Error('Vita3K compat data list is cleared and awaiting repopulation.');
  }

  const candidates = games
    .filter((entry) => entry && typeof entry.name === 'string' && entry.name.trim().length > 0)
    .map((entry) => {
      const rawLabel = resolveStatusLabel(parseLabelNames(entry.labels));

      return {
        rawTitle: entry.name.trim(),
        rawLabel,
        normalizedStatus: mapRawStatus(rawLabel),
        sourceId: typeof entry.titleId === 'string' ? entry.titleId : null,
        sourceUrl:
          typeof entry.issueId === 'number'
            ? `https://github.com/Vita3K/compatibility/issues/${entry.issueId}`
            : VITA3K_COMPAT_DATA_URL,
      };
    });

  // An entry with no known status label (untagged issue, or a label upstream renamed or
  // added) says nothing about compatibility, so drop it rather than report "incomplete" —
  // games bound to it then keep their last known status.
  const entries = candidates.filter((entry) => entry.rawLabel.length > 0);

  // If nothing resolves to a known status the response shape has changed again; fail the
  // refresh rather than silently returning an empty list.
  if (candidates.length > 0 && entries.length === 0) {
    throw new Error('Vita3K compat data had no recognisable status labels.');
  }

  return entries;
}

export const vita3kParser = { fetchList, mapLabel };
