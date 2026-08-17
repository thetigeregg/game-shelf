import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';

// Dolphin's official compatibility list (dolphin-emu.org/compat/) and its backing wiki
// (wiki.dolphin-emu.org) are both behind proof-of-work anti-scraping challenges (BunnyCDN
// Shield and Anubis, respectively) that explicitly exist to block automated access. Rather
// than defeat those challenges, this parser reads a manually downloaded copy of the wiki's
// per-platform game list page, saved as HTML and dropped into the configured dump directory.
// Re-download and replace the file periodically (e.g. from
// https://wiki.dolphin-emu.org/index.php?title=Nintendo_GameCube or .../index.php?title=Wii)
// to keep data fresh — the scheduled refresh job just re-parses whatever's currently there.
//
// Expected file: <dumpDir>/<platformSlug>.html (platformSlug is "gamecube" or "wii").
// Each row of the page's sortable "Title / Year / Region / Compatibility" table looks like:
//   <tr><td><a href="/index.php?title=Some_Game" title="Some Game">Some Game</a></td>
//       <td>2003</td><td>NA/EU</td>
//       <td><span style="font-size:0;">4</span>...Stars4.svg...</td></tr>
// The star rating (0-5) is embedded as plain hidden text ahead of the star image, so no
// image-filename parsing is needed.
const RATING_LABELS = {
  0: 'Unknown',
  1: 'Broken',
  2: 'Intro/Menu',
  3: 'Starts',
  4: 'Playable',
  5: 'Perfect',
};

// Only "Perfect" clears the bar for Dolphin; everything else folds into "incomplete".
// Must stay consistent with this platform's `bestStatus: "perfect"` config.
function mapRatingToStatus(rating) {
  if (rating === 5) {
    return 'perfect';
  }
  if (rating === 4) {
    return 'playable';
  }
  return 'incomplete';
}

export function mapLabel(rawLabel) {
  const rating = Number.parseInt(rawLabel, 10);
  return mapRatingToStatus(rating);
}

// getBrowser is unused here (kept for parity with browser-based parsers' signature).
export async function fetchList(_getBrowser, { platformSlug, dumpDir }) {
  const filePath = path.join(dumpDir, `${platformSlug}.html`);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `No compatibility dump found for platform "${platformSlug}" at ${filePath}. Download the wiki page and place it there.`
    );
  }

  const html = fs.readFileSync(filePath, 'utf8');
  const $ = load(html);
  const entries = [];

  $('table.wikitable.sortable tbody tr').each((_index, row) => {
    const cells = $(row).find('td');
    if (cells.length < 4) {
      return;
    }

    const titleLink = $(cells[0]).find('a').first();
    const title = titleLink.text().trim();
    const href = titleLink.attr('href') ?? null;

    if (!title) {
      return;
    }

    const ratingText = $(cells[3]).find('span[style*="font-size:0"]').first().text().trim();
    const rating = Number.parseInt(ratingText, 10);

    if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
      return;
    }

    entries.push({
      rawTitle: title,
      rawLabel: RATING_LABELS[rating],
      normalizedStatus: mapRatingToStatus(rating),
      sourceId: href,
      sourceUrl: href ? new URL(href, 'https://wiki.dolphin-emu.org/').toString() : null,
    });
  });

  return entries;
}

export const dolphinParser = { fetchList, mapLabel };
