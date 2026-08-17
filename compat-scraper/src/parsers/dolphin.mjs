// Dolphin's public compatibility list at https://www.dolphin-emu.org/compat/ lists
// GameCube and Wii games together, filterable by platform. Each row exposes a title,
// a status label ("Perfect", "Playable", "Ingame", "Intro", "Broken", "Unknown", ...),
// and a link to the game's compatibility detail page.
//
// Selectors below target the list page's table rows and should be re-verified against
// the live site during first integration, since Dolphin controls the markup.
const DOLPHIN_COMPAT_URL = 'https://www.dolphin-emu.org/compat/';

const DOLPHIN_PLATFORM_QUERY = {
  gamecube: 'gc',
  wii: 'wii',
};

// Only "Perfect" and "Playable" clear the bar for actually playing the game;
// everything else (Ingame, Intro, Broken, Unknown, ...) folds into "incomplete".
const DOLPHIN_LABEL_MAP = {
  perfect: 'perfect',
  playable: 'playable',
};

export function mapLabel(rawLabel) {
  const key = String(rawLabel ?? '')
    .trim()
    .toLowerCase();
  return DOLPHIN_LABEL_MAP[key] ?? 'incomplete';
}

export async function fetchList(browser, { platformSlug, timeoutMs }) {
  const query = DOLPHIN_PLATFORM_QUERY[platformSlug] ?? null;
  const url = query
    ? `${DOLPHIN_COMPAT_URL}?platform=${encodeURIComponent(query)}`
    : DOLPHIN_COMPAT_URL;

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    try {
      await page.waitForSelector('table tbody tr', { timeout: timeoutMs });
    } catch {
      // Fall through with whatever rows are already in the DOM (possibly none).
    }

    const rows = await page.$$eval('table tbody tr', (trs) =>
      trs.map((tr) => {
        const titleCell = tr.querySelector('a[href*="/compat/"]') ?? tr.querySelector('td a');
        const statusCell = tr.querySelector('[class*="status"], td:last-child');
        return {
          title: titleCell ? titleCell.textContent.trim() : '',
          href: titleCell ? titleCell.getAttribute('href') : null,
          rawLabel: statusCell ? statusCell.textContent.trim() : '',
        };
      })
    );

    return rows
      .filter((row) => row.title.length > 0 && row.rawLabel.length > 0)
      .map((row) => ({
        rawTitle: row.title,
        rawLabel: row.rawLabel,
        normalizedStatus: mapLabel(row.rawLabel),
        sourceId: row.href ?? null,
        sourceUrl: row.href ? new URL(row.href, DOLPHIN_COMPAT_URL).toString() : DOLPHIN_COMPAT_URL,
      }));
  } finally {
    await context.close();
  }
}

export const dolphinParser = { fetchList, mapLabel };
