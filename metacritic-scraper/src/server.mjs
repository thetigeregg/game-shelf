import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installSingleLineConsole } from './single-line-console.mjs';
import { rankCandidate } from './metacritic-candidate-ranking.mjs';
import { parsePositiveEnvInt } from './env-utils.mjs';
import {
  extractMetacriticSearchResults,
  METACRITIC_SEARCH_RESULT_LINK_SELECTOR,
  METACRITIC_SEARCH_RESULT_ROW_SELECTOR,
  METACRITIC_SEARCH_RESULTS_READY_SELECTOR,
} from './search-parser.mjs';
import { buildMetacriticSearchUrl, buildSearchTitleVariants } from './search-utils.mjs';

function readEnvOrFile(name) {
  const filePath = String(process.env[`${name}_FILE`] ?? '').trim();
  const resolved = filePath.length > 0 ? filePath : `/run/secrets/${name.toLowerCase()}`;
  if (fs.existsSync(resolved)) {
    return fs.readFileSync(resolved, 'utf8').trim();
  }
  return '';
}

const app = express();
const port = Number.parseInt(process.env.PORT ?? '8789', 10);
const apiToken = readEnvOrFile('METACRITIC_SCRAPER_TOKEN');
const browserTimeoutMs = parsePositiveEnvInt('METACRITIC_SCRAPER_TIMEOUT_MS', 25_000);
const browserIdleTtlMs = parsePositiveEnvInt('METACRITIC_SCRAPER_BROWSER_IDLE_MS', 30_000);
const debugLogsEnabled =
  String(process.env.DEBUG_METACRITIC_SCRAPER_LOGS ?? '').toLowerCase() === 'true';
const igdbToMetacriticPlatformDisplayById = loadIgdbToMetacriticPlatformDisplayById();

let sharedBrowser = null;
let sharedBrowserPromise = null;
let browserIdleTimer = null;

installSingleLineConsole();

function normalizeSearchQuery(req) {
  return String(req.query.q ?? '').trim();
}

function normalizeReleaseYearQuery(req) {
  const raw = String(req.query.releaseYear ?? '').trim();
  if (!/^\d{4}$/.test(raw)) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 1970 && parsed <= 2100 ? parsed : null;
}

function normalizePlatform(req) {
  const value = String(req.query.platform ?? '').trim();
  return value.length > 0 ? value : null;
}

function normalizePlatformIgdbId(req) {
  const raw = String(req.query.platformIgdbId ?? '').trim();
  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeIncludeCandidates(req) {
  const raw = String(req.query.includeCandidates ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function loadIgdbToMetacriticPlatformDisplayById() {
  try {
    const jsonPath = new URL('./igdb-to-metacritic-platform-map.json', import.meta.url);
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    if (!parsed || typeof parsed !== 'object') {
      return new Map();
    }

    return new Map(
      Object.entries(parsed)
        .map(([rawId, value]) => {
          const platformIgdbId = Number.parseInt(String(rawId), 10);
          const metacriticDisplay =
            value && typeof value === 'object' ? String(value.metacriticDisplay ?? '').trim() : '';
          if (
            !Number.isInteger(platformIgdbId) ||
            platformIgdbId <= 0 ||
            metacriticDisplay.length === 0
          ) {
            return null;
          }
          return [platformIgdbId, metacriticDisplay];
        })
        .filter((entry) => Array.isArray(entry))
    );
  } catch {
    return new Map();
  }
}

async function searchMetacriticInBrowser(page, query) {
  const searchUrl = buildMetacriticSearchUrl(query);
  const readyTimeoutMs = Math.max(0, Math.min(browserTimeoutMs, 5_000));
  const settleDelayMs = Math.max(0, Math.min(Math.floor(browserTimeoutMs / 100), 300));

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: browserTimeoutMs });
  if (readyTimeoutMs > 0) {
    await page
      .waitForSelector(METACRITIC_SEARCH_RESULTS_READY_SELECTOR, { timeout: readyTimeoutMs })
      .catch(() => undefined);
  }
  if (settleDelayMs > 0) {
    await page.waitForTimeout(settleDelayMs);
  }

  const items = await page.evaluate(extractMetacriticSearchResults, {
    gameLinkSelector: METACRITIC_SEARCH_RESULT_LINK_SELECTOR,
    rowSelector: METACRITIC_SEARCH_RESULT_ROW_SELECTOR,
  });

  return items;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/v1/metacritic/search', async (req, res) => {
  if (apiToken.length > 0) {
    const authHeader = String(req.headers.authorization ?? '');
    const expectedHeader = `Bearer ${apiToken}`;

    if (authHeader !== expectedHeader) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const query = normalizeSearchQuery(req);
  const releaseYear = normalizeReleaseYearQuery(req);
  const platform = normalizePlatform(req);
  const platformIgdbId = normalizePlatformIgdbId(req);
  const includeCandidates = normalizeIncludeCandidates(req);

  if (query.length < 2) {
    res.status(400).json({ error: 'Query must be at least 2 characters.' });
    return;
  }

  try {
    const titleVariants = buildSearchTitleVariants(query);
    const browser = await getSharedBrowser();
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    try {
      const page = await context.newPage();

      const allCandidates = [];
      const seenCandidateKeys = new Set();

      for (const variant of titleVariants) {
        const candidates = await searchMetacriticInBrowser(page, variant);
        if (debugLogsEnabled) {
          console.info('[metacritic-scraper] search_attempt', {
            query,
            variant,
            releaseYear,
            platform,
            platformIgdbId,
            includeCandidates,
            candidateCount: candidates.length,
          });
        }
        for (const candidate of candidates) {
          const key = [
            candidate.metacriticUrl ?? '',
            candidate.title ?? '',
            String(candidate.releaseYear ?? ''),
            candidate.platform ?? '',
            String(candidate.metacriticScore ?? ''),
          ].join('::');
          if (seenCandidateKeys.has(key)) {
            continue;
          }

          seenCandidateKeys.add(key);
          allCandidates.push(candidate);
        }
      }

      const rankedWithScores = allCandidates
        .map((candidate) => ({
          candidate,
          score: rankCandidate(query, releaseYear, platform, platformIgdbId, candidate, {
            igdbToMetacriticPlatformDisplayById,
          }),
        }))
        .filter((entry) => entry.score >= 0)
        .sort((left, right) => right.score - left.score);
      const ranked = rankedWithScores.map((entry) => entry.candidate).slice(0, 30);

      const best = ranked[0] ?? null;
      const bestScore = rankedWithScores[0]?.score ?? -1;
      const confidenceThreshold = 115;

      const item =
        best && bestScore >= confidenceThreshold
          ? {
              metacriticScore: best.metacriticScore ?? null,
              metacriticUrl: best.metacriticUrl ?? null,
            }
          : null;

      if (debugLogsEnabled) {
        console.info('[metacritic-scraper] request_complete', {
          query,
          releaseYear,
          platform,
          platformIgdbId,
          includeCandidates,
          rankedCount: ranked.length,
          bestScore,
          matched: item !== null,
          bestCandidate: best,
        });
      }

      res.json(includeCandidates ? { item, candidates: ranked } : { item });
    } finally {
      await context.close().catch(() => undefined);
      scheduleBrowserIdleClose();
    }
  } catch (error) {
    console.error('[metacritic-scraper] request_failed', {
      query,
      message: error instanceof Error ? error.message : String(error),
    });
    res.status(502).json({ error: 'Unable to fetch Metacritic data.' });
  }
});

const entrypointPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = path.resolve(fileURLToPath(import.meta.url));

if (entrypointPath === modulePath) {
  app.listen(port, () => {
    console.log(`[metacritic-scraper] listening on http://localhost:${port}`);
  });
}

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

function scheduleBrowserIdleClose() {
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
    closeSharedBrowser()
      .catch(() => {
        // Ignore shutdown cleanup errors.
      })
      .finally(() => {
        process.exit(0);
      });
  });
}
