import express from 'express';
import fs from 'node:fs';
import { chromium } from 'playwright';

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
const browserTimeoutMs = Number.parseInt(process.env.METACRITIC_SCRAPER_TIMEOUT_MS ?? '25000', 10);
const browserIdleTtlMs = Number.parseInt(
  process.env.METACRITIC_SCRAPER_BROWSER_IDLE_MS ?? '30000',
  10
);
const debugLogsEnabled =
  String(process.env.DEBUG_METACRITIC_SCRAPER_LOGS ?? '').toLowerCase() === 'true';
const igdbToMetacriticPlatformDisplayById = loadIgdbToMetacriticPlatformDisplayById();

let sharedBrowser = null;
let sharedBrowserPromise = null;
let browserIdleTimer = null;

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

function normalizeTitle(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

const variantTokens = new Set([
  'remaster',
  'remastered',
  'remake',
  'redux',
  'definitive',
  'special',
  'ultimate',
  'anniversary',
  'goty',
  'edition',
  'collection',
  'complete',
  'director',
  'deluxe',
  'hd'
]);

function hasVariantToken(normalizedTitle) {
  const title = String(normalizedTitle ?? '');
  const tokens = title.split(' ').filter(Boolean);
  if (tokens.some((token) => variantTokens.has(token))) {
    return true;
  }
  return title.includes('game of the year');
}

const seriesIndexTokens = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']);
const romanToArabicSeriesMap = new Map([
  ['i', '1'],
  ['ii', '2'],
  ['iii', '3'],
  ['iv', '4'],
  ['v', '5'],
  ['vi', '6'],
  ['vii', '7'],
  ['viii', '8'],
  ['ix', '9'],
  ['x', '10']
]);

function canonicalizeSeriesToken(token) {
  if (/^\d+$/.test(token)) {
    return String(Number.parseInt(token, 10));
  }

  return romanToArabicSeriesMap.get(token) ?? null;
}

function extractSeriesTokens(normalizedTitle) {
  return new Set(
    String(normalizedTitle ?? '')
      .split(' ')
      .map((token) => canonicalizeSeriesToken(token))
      .filter((token) => Boolean(token))
  );
}

function normalizeTitleForMatching(value) {
  return normalizeTitle(value)
    .split(' ')
    .filter(Boolean)
    .map((token) => canonicalizeSeriesToken(token) ?? token)
    .join(' ');
}

function hasAddonQualifier(rawTitle, normalizedTitle) {
  const raw = String(rawTitle ?? '').toLowerCase();
  const normalized = String(normalizedTitle ?? '');

  if (
    /\b(dlc|expansion|expansions|season pass|expansion pass|add on|add-on|addon|downloadable content)\b/.test(
      normalized
    )
  ) {
    return true;
  }

  if (/\b(dual pack|bundle)\b/.test(normalized)) {
    return true;
  }

  if (/\bpart\s+[0-9ivx]+\b/.test(normalized)) {
    return true;
  }

  if (raw.includes(' / ') || raw.includes(' + ')) {
    return true;
  }

  return false;
}

function parseMetacriticScore(rawValue) {
  const text = String(rawValue ?? '')
    .toLowerCase()
    .trim();
  if (text.length === 0 || text.includes('tbd') || text.includes('null')) {
    return null;
  }

  const match = text.match(/\b([1-9]\d?|100)\b/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
}

function normalizePlatformValue(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\band more\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizePlatform(value) {
  const normalized = normalizePlatformValue(value);

  if (normalized === 'nintendo 3ds' || normalized === '3ds' || normalized === 'nintendo 3 ds') {
    return '3ds';
  }

  if (normalized === 'playstation 5' || normalized === 'ps5') {
    return 'ps5';
  }

  if (normalized === 'playstation 4' || normalized === 'ps4') {
    return 'ps4';
  }

  if (
    normalized === 'playstation vita' ||
    normalized === 'ps vita' ||
    normalized === 'psvita' ||
    normalized === 'vita'
  ) {
    return 'ps vita';
  }

  if (normalized === 'xbox one') {
    return 'xbox one';
  }

  if (
    normalized === 'xbox series x' ||
    normalized === 'xbox series s' ||
    normalized === 'xbox series x s'
  ) {
    return 'xbox series';
  }

  if (normalized === 'nintendo switch' || normalized === 'switch') {
    return 'switch';
  }

  if (normalized === 'pc' || normalized === 'microsoft windows' || normalized === 'windows') {
    return 'pc';
  }

  return normalized;
}

function resolveExpectedPlatformAliases(expectedPlatform, expectedPlatformIgdbId) {
  const aliases = new Set();

  const byId =
    typeof expectedPlatformIgdbId === 'number' && Number.isInteger(expectedPlatformIgdbId)
      ? (igdbToMetacriticPlatformDisplayById.get(expectedPlatformIgdbId) ?? '')
      : '';
  const normalizedById = canonicalizePlatform(byId);
  if (normalizedById.length > 0) {
    aliases.add(normalizedById);
  }

  const normalizedByName = canonicalizePlatform(expectedPlatform);
  if (normalizedByName.length > 0) {
    aliases.add(normalizedByName);
  }

  return aliases;
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

function rankCandidate(
  expectedTitle,
  expectedYear,
  expectedPlatform,
  expectedPlatformIgdbId,
  candidate
) {
  const normalizedExpected = normalizeTitleForMatching(expectedTitle);
  const normalizedCandidate = normalizeTitleForMatching(candidate.title);

  if (!normalizedExpected || !normalizedCandidate) {
    return -1;
  }

  let score = 0;

  if (normalizedExpected === normalizedCandidate) {
    score += 100;
  }

  const expectedTokensList = normalizedExpected.split(' ').filter(Boolean);
  const candidateTokensList = normalizedCandidate.split(' ').filter(Boolean);
  if (expectedTokensList.length === 1 && normalizedExpected !== normalizedCandidate) {
    // Generic single-token queries (for example "control") are noisy.
    // Down-rank non-exact multi-word titles to avoid aggressive auto-matches.
    if (candidateTokensList.length > 1) {
      score -= 18;
    }
  }

  if (
    normalizedExpected.includes(normalizedCandidate) ||
    normalizedCandidate.includes(normalizedExpected)
  ) {
    score += 20;
  }

  const expectedHasAddonQualifier = hasAddonQualifier(expectedTitle, normalizedExpected);
  const candidateHasAddonQualifier = hasAddonQualifier(candidate.title, normalizedCandidate);
  if (expectedHasAddonQualifier !== candidateHasAddonQualifier) {
    score -= candidateHasAddonQualifier ? 30 : 20;
  }

  const expectedHasVariant = hasVariantToken(normalizedExpected);
  const candidateHasVariant = hasVariantToken(normalizedCandidate);
  if (expectedHasVariant !== candidateHasVariant) {
    score -= 18;
  }

  const expectedSeriesTokens = extractSeriesTokens(normalizedExpected);
  const candidateSeriesTokens = extractSeriesTokens(normalizedCandidate);
  if (expectedSeriesTokens.size > 0) {
    const candidateMatchesAnyExpected = [...expectedSeriesTokens].some((token) =>
      candidateSeriesTokens.has(token)
    );
    if (!candidateMatchesAnyExpected) {
      score -= 30;
    } else {
      const hasUnexpectedSeriesToken = [...candidateSeriesTokens].some(
        (token) => !expectedSeriesTokens.has(token)
      );
      if (hasUnexpectedSeriesToken) {
        score -= 12;
      }
    }
  } else if (candidateSeriesTokens.size > 0) {
    score -= 6;
  }

  const expectedTokens = new Set(expectedTokensList);
  const candidateTokens = new Set(candidateTokensList);
  let tokenOverlap = 0;
  for (const token of expectedTokens) {
    if (candidateTokens.has(token)) {
      tokenOverlap += 1;
    }
  }
  score += tokenOverlap * 8;

  if (expectedYear !== null && Number.isInteger(candidate.releaseYear)) {
    const delta = Math.abs(candidate.releaseYear - expectedYear);
    if (delta === 0) {
      score += 20;
    } else if (delta === 1) {
      score += 10;
    } else if (delta <= 3) {
      score += 4;
    } else if (delta >= 10) {
      score -= 20;
    } else if (delta >= 5) {
      score -= 10;
    }
  }

  const expectedPlatformAliases = resolveExpectedPlatformAliases(
    expectedPlatform,
    expectedPlatformIgdbId
  );
  const normalizedCandidatePlatform = canonicalizePlatform(candidate.platform);

  if (expectedPlatformAliases.size > 0 && normalizedCandidatePlatform.length > 0) {
    const isPlatformMatch = [...expectedPlatformAliases].some(
      (expectedAlias) =>
        normalizedCandidatePlatform === expectedAlias ||
        normalizedCandidatePlatform.includes(expectedAlias) ||
        expectedAlias.includes(normalizedCandidatePlatform)
    );

    if (isPlatformMatch) {
      score += 12;
    }
  }

  if (typeof candidate.metacriticScore === 'number') {
    score += 2;
  }

  return score;
}

async function searchMetacriticInBrowser(page, query) {
  const normalizedQuery = normalizeTitle(query);
  const queryForPath = normalizedQuery.length > 0 ? normalizedQuery : String(query ?? '').trim();
  const encodedPathQuery = encodeURIComponent(queryForPath);
  const searchUrl = `https://www.metacritic.com/search/${encodedPathQuery}/?category=13`;

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: browserTimeoutMs });
  await page.waitForTimeout(300);

  const items = await page.evaluate(() => {
    const parseMetacriticScoreInPage = (rawValue) => {
      const text = String(rawValue ?? '')
        .toLowerCase()
        .trim();
      if (text.length === 0 || text.includes('tbd') || text.includes('null')) {
        return null;
      }

      const match = text.match(/\b([1-9]\d?|100)\b/);
      if (!match) {
        return null;
      }

      const parsed = Number.parseInt(match[1], 10);
      return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
    };

    const rows = Array.from(
      document.querySelectorAll(
        '[data-testid="search-result-item"], [data-testid="search-results"] [data-testid="result-item"], .c-finderProductCard'
      )
    );

    const parsed = [];

    for (const row of rows) {
      const hrefOnRow = String(row.getAttribute('href') ?? '').trim();
      const resultTypeTag = String(
        row.querySelector(
          '[data-testid="tag-list"] .c-tagList_button, [data-testid="tag-list"] span'
        )?.textContent ?? ''
      )
        .toLowerCase()
        .trim();
      const isGameByHref = hrefOnRow.startsWith('/game/') || hrefOnRow.includes('/game/');
      const isGameByTag = resultTypeTag === 'game';
      if (!isGameByHref && !isGameByTag) {
        continue;
      }

      const titleEl =
        row.querySelector(
          '[data-testid="product-title"], h3, .c-finderProductCard_title, a.c-finderProductCard_container'
        ) || row.querySelector('a[href*="/game/"]');
      const title = titleEl ? String(titleEl.textContent ?? '').trim() : '';
      if (!title) {
        continue;
      }

      const linkEl = row.matches('a[href*="/game/"]')
        ? row
        : row.querySelector('a[href*="/game/"]');
      const href = linkEl ? String(linkEl.getAttribute('href') ?? '').trim() : '';
      const url = href.startsWith('http')
        ? href
        : href.startsWith('/')
          ? `https://www.metacritic.com${href}`
          : null;

      const scoreEl =
        row.querySelector(
          '[data-testid="product-metascore"] span, [data-testid="critic-score"] span, .c-siteReviewScore span, .metascore_w'
        ) ??
        row.querySelector(
          '[data-testid="product-metascore"] [aria-label*="Metascore"], [data-testid="product-metascore"] [title*="Metascore"], [aria-label*="Metascore"], [title*="Metascore"]'
        );
      const scoreRaw = scoreEl
        ? String(
            scoreEl.textContent ??
              scoreEl.getAttribute('aria-label') ??
              scoreEl.getAttribute('title') ??
              ''
          ).trim()
        : '';
      const scoreValue = parseMetacriticScoreInPage(scoreRaw);

      const releaseDateText = String(
        row.querySelector('[data-testid="product-release-date"], time, .c-finderProductCard_meta')
          ?.textContent ?? ''
      ).trim();
      const yearMatch =
        releaseDateText.match(/\b(19|20)\d{2}\b/) ??
        title.match(/\((19|20)\d{2}\)|\b(19|20)\d{2}\b/);
      const releaseYear = yearMatch ? Number.parseInt(yearMatch[0], 10) : null;

      const platformEl = row.querySelector(
        '[data-testid="product-platform"], [data-testid="platform"], .c-finderProductCard_meta'
      );
      const platform = platformEl ? String(platformEl.textContent ?? '').trim() : null;

      const imageEl = row.querySelector('img');
      const imageUrl = imageEl ? String(imageEl.getAttribute('src') ?? '').trim() : null;

      parsed.push({
        title,
        releaseYear: Number.isInteger(releaseYear) ? releaseYear : null,
        platform: platform && platform.length > 0 ? platform : null,
        metacriticScore: scoreValue,
        metacriticUrl: url,
        imageUrl: imageUrl && imageUrl.length > 0 ? imageUrl : null
      });
    }

    return parsed;
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
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    let allCandidates = [];

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
          candidateCount: candidates.length
        });
      }
      if (candidates.length > 0) {
        allCandidates = candidates;
        break;
      }
    }

    const ranked = allCandidates
      .map((candidate) => ({
        candidate,
        score: rankCandidate(query, releaseYear, platform, platformIgdbId, candidate)
      }))
      .filter((entry) => entry.score >= 0)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.candidate)
      .slice(0, 30);

    const best = ranked[0] ?? null;
    const bestScore = best ? rankCandidate(query, releaseYear, platform, platformIgdbId, best) : -1;
    const confidenceThreshold = 115;

    const item =
      best && bestScore >= confidenceThreshold
        ? {
            metacriticScore: best.metacriticScore ?? null,
            metacriticUrl: best.metacriticUrl ?? null
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
        bestCandidate: best
      });
    }

    await context.close();
    scheduleBrowserIdleClose();

    res.json(includeCandidates ? { item, candidates: ranked } : { item });
  } catch (error) {
    console.error('[metacritic-scraper] request_failed', {
      query,
      message: error instanceof Error ? error.message : String(error)
    });
    res.status(502).json({ error: 'Unable to fetch Metacritic data.' });
  }
});

app.listen(port, () => {
  console.log(`[metacritic-scraper] listening on http://localhost:${port}`);
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
