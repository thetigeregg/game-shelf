import { load } from 'cheerio';

// compat.cemu.info is closed-source (no backing GitHub repo) but has no anti-bot protection,
// so unlike Dolphin this can be fetched live — the whole list is one page ("?sort=All"),
// no pagination needed.
const CEMU_COMPAT_URL = 'https://compat.cemu.info/?sort=All';

// "Perfect" and "Playable" map to their own statuses; everything else (Runs/Loads/Unplayable/
// Unknown) folds into "incomplete". Must stay consistent with this platform's
// `bestStatus: "perfect"` config.
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

// getBrowser/dumpDir are unused here — this parser does a plain HTTPS fetch + HTML parse, no
// browser or local file needed. Kept in the signature for parity with other parsers.
export async function fetchList(_getBrowser, { timeoutMs }) {
  const response = await fetch(CEMU_COMPAT_URL, {
    signal: AbortSignal.timeout(timeoutMs ?? 25000),
  });

  if (!response.ok) {
    throw new Error(`Cemu compat data request failed with status ${response.status}`);
  }

  const html = await response.text();
  const $ = load(html);
  const entries = [];

  $('table.compat-list tbody tr').each((_index, row) => {
    const titleLink = $(row).find('td.title a').first();
    const title = titleLink.text().trim();
    const href = titleLink.attr('href') ?? null;

    if (!title) {
      return;
    }

    const ratingImg = $(row).find('td.rating img').first();
    const rawLabel = (ratingImg.attr('alt') ?? '').trim();

    if (!rawLabel) {
      return;
    }

    entries.push({
      rawTitle: title,
      rawLabel,
      normalizedStatus: mapRawStatus(rawLabel),
      sourceId: null,
      sourceUrl: href ? new URL(href, CEMU_COMPAT_URL).toString() : CEMU_COMPAT_URL,
    });
  });

  return entries;
}

export const cemuParser = { fetchList, mapLabel };
