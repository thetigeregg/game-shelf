import express from 'express';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { normalizeCandidate as normalizePsPricesCandidate } from './parser.mjs';

function readEnvOrFile(name) {
  const filePath = String(process.env[`${name}_FILE`] ?? '').trim();
  const resolved = filePath.length > 0 ? filePath : `/run/secrets/${name.toLowerCase()}`;
  if (fs.existsSync(resolved)) {
    try {
      return fs.readFileSync(resolved, 'utf8').trim();
    } catch (error) {
      throw new Error(
        `Failed to read configuration secret for "${name}" from path "${resolved}": ${error.message}`
      );
    }
  }
  return '';
}

const app = express();
const port = Number.parseInt(process.env.PORT ?? '8790', 10);
const apiToken = readEnvOrFile('PSPRICES_SCRAPER_TOKEN');
const browserTimeoutMs = Number.parseInt(process.env.PSPRICES_SCRAPER_TIMEOUT_MS ?? '25000', 10);
const browserIdleTtlMs = Number.parseInt(
  process.env.PSPRICES_SCRAPER_BROWSER_IDLE_MS ?? '30000',
  10
);
const pspricesBaseUrl = String(process.env.PSPRICES_BASE_URL ?? 'https://psprices.com').trim();
const defaultRegionPath = String(process.env.PSPRICES_REGION_PATH ?? 'region-ch').trim();
const defaultShow = String(process.env.PSPRICES_SHOW ?? 'games').trim();
const debugLogsEnabled =
  String(process.env.DEBUG_PSPRICES_SCRAPER_LOGS ?? '').toLowerCase() === 'true';

let sharedBrowser = null;
let sharedBrowserPromise = null;
let browserIdleTimer = null;
let activeBrowserLeases = 0;

function normalizeSearchQuery(req) {
  return String(req.query.q ?? '').trim();
}

function normalizePlatform(req) {
  return String(req.query.platform ?? '').trim();
}

function normalizeRegion(req) {
  const value = String(req.query.region ?? '').trim();
  const normalized = value.length > 0 ? value : defaultRegionPath;
  let start = 0;
  let end = normalized.length;

  while (start < end && normalized.charCodeAt(start) === 47) {
    start += 1;
  }

  while (end > start && normalized.charCodeAt(end - 1) === 47) {
    end -= 1;
  }

  return normalized.slice(start, end);
}

function normalizeShow(req) {
  const value = String(req.query.show ?? '').trim();
  return value.length > 0 ? value : defaultShow;
}

function normalizeIncludeCandidates(req) {
  const raw = String(req.query.includeCandidates ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function normalizeTitle(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchTitleVariants(title) {
  const base = String(title ?? '').trim();
  if (base.length === 0) {
    return [];
  }

  const normalized = normalizeTitle(base);
  const titleCase = normalized
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');

  return [...new Set([base, titleCase].filter((value) => value.length > 0))];
}

function getTitleSimilarityScore(expectedTitle, candidateTitle) {
  const expected = normalizeTitle(expectedTitle);
  const candidate = normalizeTitle(candidateTitle);
  if (!expected || !candidate) {
    return -1;
  }

  if (expected === candidate) {
    return 100;
  }

  let score = 0;
  if (expected.includes(candidate) || candidate.includes(expected)) {
    score += 20;
  }

  const expectedTokens = new Set(expected.split(' ').filter(Boolean));
  const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
  const overlap = [...expectedTokens].filter((token) => candidateTokens.has(token)).length;
  const union = new Set([...expectedTokens, ...candidateTokens]).size;

  if (union > 0) {
    score += (overlap / union) * 80;
  }

  return score;
}

async function searchPsPricesInBrowser(page, query, platform, regionPath, show) {
  const endpoint = new URL(`/${regionPath}/games/`, pspricesBaseUrl);
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('show', show);
  if (platform.length > 0) {
    endpoint.searchParams.set('platform', platform);
  }

  await page.goto(endpoint.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: browserTimeoutMs
  });
  await page.waitForTimeout(1000);

  const candidates = await page.evaluate(() => {
    function normalizeText(value) {
      return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    }

    const cards = Array.from(document.querySelectorAll('.game-fragment'));
    return cards
      .map((card) => {
        const titleElement = card.querySelector('h3');
        const anchor = card.querySelector('a[href*="/game/"], a[href*="/region-"][href*="/game/"]');
        const gameIdElement = card.querySelector('[data-game-id]');
        const priceElement = card.querySelector(
          '[data-test-id="price-current"], .text-xl.font-bold.text-text, .text-xl.font-bold'
        );
        const oldPriceElement = card.querySelector(
          '[data-test-id="price-old"], .old-price-strike, .line-through'
        );
        const discountElement = card.querySelector('.bg-red-700, .dark\\:bg-red-600');

        const title = normalizeText(titleElement?.textContent ?? anchor?.textContent ?? '');
        if (!title) {
          return null;
        }

        const priceText = normalizeText(priceElement?.textContent ?? '');
        const oldPriceText = normalizeText(oldPriceElement?.textContent ?? '');
        const discountText = normalizeText(discountElement?.textContent ?? '');
        const url = anchor instanceof HTMLAnchorElement ? anchor.href : '';
        const gameId = normalizeText(gameIdElement?.getAttribute('data-game-id') ?? '');

        return {
          title,
          priceText,
          oldPriceText,
          discountText,
          url,
          gameId: gameId.length > 0 ? gameId : null
        };
      })
      .filter((item) => item !== null);
  });

  return candidates;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/v1/psprices/search', async (req, res) => {
  if (apiToken.length > 0) {
    const authHeader = String(req.headers.authorization ?? '');
    const expectedHeader = `Bearer ${apiToken}`;

    if (authHeader !== expectedHeader) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const query = normalizeSearchQuery(req);
  const platform = normalizePlatform(req);
  const regionPath = normalizeRegion(req);
  const show = normalizeShow(req);
  const includeCandidates = normalizeIncludeCandidates(req);

  if (query.length < 2) {
    res.status(400).json({ error: 'Query must be at least 2 characters.' });
    return;
  }

  try {
    const titleVariants = buildSearchTitleVariants(query);
    const browser = await acquireSharedBrowser();
    let context = null;
    try {
      context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();
      const merged = [];
      const seen = new Set();

      for (const variant of titleVariants) {
        const candidates = await searchPsPricesInBrowser(page, variant, platform, regionPath, show);

        for (const candidate of candidates) {
          const key = `${candidate.url ?? ''}::${candidate.title ?? ''}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          merged.push(candidate);
        }
      }

      const ranked = merged
        .map((candidate) => ({
          candidate: normalizePsPricesCandidate(candidate),
          score: getTitleSimilarityScore(query, candidate.title ?? '')
        }))
        .filter((entry) => entry.candidate !== null && entry.score >= 20)
        .sort((left, right) => right.score - left.score)
        .map((entry) => entry.candidate)
        .slice(0, 20);

      const item = ranked[0] ?? null;
      if (debugLogsEnabled) {
        console.info('[psprices-scraper] request_complete', {
          query,
          platform: platform || null,
          regionPath,
          show,
          candidateCount: ranked.length,
          matched: item !== null
        });
      }

      res.json(
        includeCandidates
          ? { item, candidates: ranked, context: { regionPath, show, platform: platform || null } }
          : { item, context: { regionPath, show, platform: platform || null } }
      );
    } finally {
      if (context) {
        await context.close().catch(() => undefined);
      }
      releaseSharedBrowserLease();
    }
  } catch (error) {
    console.error('[psprices-scraper] request_failed', {
      query,
      message: error instanceof Error ? error.message : String(error)
    });
    res.status(502).json({ error: 'Unable to fetch PSPrices data.' });
  }
});

app.listen(port, () => {
  console.log(`[psprices-scraper] listening on http://localhost:${port}`);
});

async function getSharedBrowser() {
  if (browserIdleTimer !== null) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }

  if (sharedBrowser) {
    return sharedBrowser;
  }

  if (!sharedBrowserPromise) {
    sharedBrowserPromise = chromium
      .launch({ headless: true })
      .then((browser) => {
        sharedBrowser = browser;
        sharedBrowserPromise = null;
        return browser;
      })
      .catch((error) => {
        sharedBrowserPromise = null;
        throw error;
      });
  }

  return sharedBrowserPromise;
}

async function acquireSharedBrowser() {
  const browser = await getSharedBrowser();
  activeBrowserLeases += 1;
  return browser;
}

function releaseSharedBrowserLease() {
  if (activeBrowserLeases > 0) {
    activeBrowserLeases -= 1;
  }
  scheduleBrowserIdleClose();
}

function scheduleBrowserIdleClose() {
  if (activeBrowserLeases > 0) {
    return;
  }

  if (browserIdleTimer !== null) {
    clearTimeout(browserIdleTimer);
  }

  browserIdleTimer = setTimeout(() => {
    closeSharedBrowser().catch(() => {
      // Ignore browser shutdown errors.
    });
  }, browserIdleTtlMs);
}

async function closeSharedBrowser() {
  if (activeBrowserLeases > 0) {
    return;
  }

  if (browserIdleTimer !== null) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }

  if (!sharedBrowser) {
    return;
  }

  const browser = sharedBrowser;
  sharedBrowser = null;
  await browser.close();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    activeBrowserLeases = 0;
    closeSharedBrowser()
      .catch(() => {
        // Ignore shutdown cleanup errors.
      })
      .finally(() => {
        process.exit(0);
      });
  });
}
