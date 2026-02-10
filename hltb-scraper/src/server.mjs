import express from 'express';
import { chromium } from 'playwright';

const app = express();
const port = Number.parseInt(process.env.PORT ?? '8788', 10);
const apiToken = (process.env.HLTB_SCRAPER_TOKEN ?? '').trim();
const browserTimeoutMs = Number.parseInt(process.env.HLTB_SCRAPER_TIMEOUT_MS ?? '25000', 10);
const debugLogsEnabled = String(process.env.DEBUG_HLTB_SCRAPER_LOGS ?? '').toLowerCase() === 'true';

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
  return String(req.query.platform ?? '').trim();
}

function normalizeTitle(value) {
  return String(value ?? '')
    .toLowerCase()
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
  const titleCaseNormalized = normalized
    .split(' ')
    .filter(Boolean)
    .map(token => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');

  return [...new Set([base, titleCaseNormalized].filter(value => value.length > 0))];
}

function levenshteinDistance(left, right) {
  const leftLength = left.length;
  const rightLength = right.length;

  if (leftLength === 0) {
    return rightLength;
  }

  if (rightLength === 0) {
    return leftLength;
  }

  const matrix = Array.from({ length: leftLength + 1 }, () => Array(rightLength + 1).fill(0));

  for (let i = 0; i <= leftLength; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= rightLength; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= leftLength; i += 1) {
    for (let j = 1; j <= rightLength; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[leftLength][rightLength];
}

function getTitleSimilarityScore(expectedTitle, candidateTitle) {
  const expected = normalizeTitle(expectedTitle);
  const candidate = normalizeTitle(candidateTitle);

  if (!expected || !candidate) {
    return -1;
  }

  let score = 0;

  if (expected === candidate) {
    score += 100;
  }

  if (expected.includes(candidate) || candidate.includes(expected)) {
    score += 25;
  }

  const expectedTokens = expected.split(' ').filter(Boolean);
  const candidateTokens = candidate.split(' ').filter(Boolean);
  const expectedTokenSet = new Set(expectedTokens);
  const candidateTokenSet = new Set(candidateTokens);
  const intersectionCount = [...expectedTokenSet].filter(token => candidateTokenSet.has(token)).length;
  const unionCount = new Set([...expectedTokenSet, ...candidateTokenSet]).size;

  if (unionCount > 0) {
    score += (intersectionCount / unionCount) * 40;
  }

  const distance = levenshteinDistance(expected, candidate);
  const maxLength = Math.max(expected.length, candidate.length);

  if (maxLength > 0) {
    score += (1 - distance / maxLength) * 30;
  }

  return score;
}

function normalizeHours(minutesValue) {
  const numeric = typeof minutesValue === 'number' ? minutesValue : Number.parseFloat(String(minutesValue ?? ''));

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Math.round((numeric / 3600) * 10) / 10;
}

function normalizeReleaseYear(value) {
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);

  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }

  if (numeric >= 1970 && numeric <= 2100) {
    return numeric;
  }

  const asDate = new Date(numeric * 1000);
  const year = asDate.getUTCFullYear();
  return Number.isInteger(year) && year >= 1970 && year <= 2100 ? year : null;
}

function normalizePlatformText(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.join(' ');
  }

  return '';
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const title = typeof entry.game_name === 'string' && entry.game_name.trim().length > 0
    ? entry.game_name.trim()
    : (typeof entry.name === 'string' ? entry.name.trim() : '');

  if (!title) {
    return null;
  }

  const normalized = {
    title,
    releaseYear: normalizeReleaseYear(entry.release_world ?? entry.release_na ?? entry.release_eu ?? entry.release_jp),
    platformText: normalizePlatformText(entry.profile_platform ?? entry.platform ?? entry.profile_platforms ?? entry.platforms),
    hltbMainHours: normalizeHours(entry.comp_main),
    hltbMainExtraHours: normalizeHours(entry.comp_plus),
    hltbCompletionistHours: normalizeHours(entry.comp_100),
  };

  if (normalized.hltbMainHours === null && normalized.hltbMainExtraHours === null && normalized.hltbCompletionistHours === null) {
    return null;
  }

  return normalized;
}

function filterEntriesByTitle(entries, expectedTitle) {
  return entries.filter(entry => {
    const normalized = normalizeEntry(entry);

    if (!normalized) {
      return false;
    }

    return getTitleSimilarityScore(expectedTitle, normalized.title) >= 20;
  });
}

function collectCandidateEntriesFromUnknown(value, sink, depth = 0) {
  if (depth > 12 || !value) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(item => collectCandidateEntriesFromUnknown(item, sink, depth + 1));
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  const normalized = normalizeEntry(value);

  if (normalized) {
    sink.push(value);
  }

  Object.values(value).forEach(nested => {
    collectCandidateEntriesFromUnknown(nested, sink, depth + 1);
  });
}

async function collectCandidatesFromNextData(page, sink) {
  try {
    const nextData = await page.evaluate(() => {
      return typeof window !== 'undefined' && typeof window.__NEXT_DATA__ !== 'undefined'
        ? window.__NEXT_DATA__
        : null;
    });

    if (nextData) {
      collectCandidateEntriesFromUnknown(nextData, sink);
    }
  } catch {
    // Ignore page evaluation failures.
  }
}

function findBestMatch(entries, expectedTitle, expectedReleaseYear, expectedPlatform) {
  const normalizedExpectedPlatform = normalizeTitle(expectedPlatform);
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const entry of entries) {
    const normalized = normalizeEntry(entry);

    if (!normalized) {
      continue;
    }

    const titleScore = getTitleSimilarityScore(expectedTitle, normalized.title);

    if (!Number.isFinite(titleScore) || titleScore < 20) {
      continue;
    }

    let score = titleScore * 100;

    if (normalizeTitle(expectedTitle) === normalizeTitle(normalized.title)) {
      score += 100;
    }

    if (expectedReleaseYear && normalized.releaseYear) {
      const diff = Math.abs(expectedReleaseYear - normalized.releaseYear);

      if (diff === 0) {
        score += 70;
      } else if (diff === 1) {
        score += 30;
      } else if (diff === 2) {
        score += 10;
      }
    }

    if (normalizedExpectedPlatform.length > 0) {
      const normalizedPlatformText = normalizeTitle(normalized.platformText);

      if (normalizedPlatformText.includes(normalizedExpectedPlatform)) {
        score += 40;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = normalized;
    }
  }

  if (!best) {
    return null;
  }

  return {
    hltbMainHours: best.hltbMainHours,
    hltbMainExtraHours: best.hltbMainExtraHours,
    hltbCompletionistHours: best.hltbCompletionistHours,
  };
}

async function searchHltbInBrowser(page, title, releaseYear, platform) {
  const capturedEntries = [];
  const networkEvents = [];
  const responseListener = async response => {
    const request = response.request();
    const resourceType = request.resourceType();

    if (resourceType !== 'fetch' && resourceType !== 'xhr') {
      return;
    }

    const url = response.url();
    const status = response.status();
    const contentType = String(response.headers()['content-type'] ?? '');
    let candidatesAdded = 0;

    if (contentType.includes('application/json')) {
      try {
        const payload = await response.json();
        const before = capturedEntries.length;
        collectCandidateEntriesFromUnknown(payload, capturedEntries);
        candidatesAdded = capturedEntries.length - before;
      } catch {
        candidatesAdded = 0;
      }
    }

    networkEvents.push({ url, status, candidatesAdded });
  };

  try {
    // Load the shell first without collecting data so homepage preloads don't pollute candidates.
    await page.goto('https://howlongtobeat.com/', { waitUntil: 'domcontentloaded', timeout: browserTimeoutMs });

    const searchInput = page.locator('input[name="site-search"]').first();

    if (await searchInput.count() > 0) {
      page.on('response', responseListener);
      await searchInput.fill(title);
      await searchInput.press('Enter');
      try {
        await page.waitForLoadState('networkidle', { timeout: 7000 });
      } catch {
        // Ignore timeout and continue with what we captured.
      }
      await page.waitForTimeout(1200);
      await collectCandidatesFromNextData(page, capturedEntries);
      page.off('response', responseListener);
    }

    if (capturedEntries.length === 0) {
      const directUrls = [
        `https://howlongtobeat.com/search?q=${encodeURIComponent(title)}`,
        `https://howlongtobeat.com/?q=${encodeURIComponent(title)}`,
      ];

      for (const directUrl of directUrls) {
        page.on('response', responseListener);
        await page.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: browserTimeoutMs });
        try {
          await page.waitForLoadState('networkidle', { timeout: 5000 });
        } catch {
          // Ignore timeout and continue.
        }
        await page.waitForTimeout(1000);
        await collectCandidatesFromNextData(page, capturedEntries);
        page.off('response', responseListener);

        if (capturedEntries.length > 0) {
          break;
        }
      }
    }

    const relevantEntries = filterEntriesByTitle(capturedEntries, title);
    const entriesForMatch = relevantEntries.length > 0 ? relevantEntries : capturedEntries;
    const item = findBestMatch(entriesForMatch, title, releaseYear, platform);
    const sampledTimes = capturedEntries
      .slice(0, 5)
      .map(entry => ({
        title: typeof entry?.game_name === 'string' ? entry.game_name : (typeof entry?.name === 'string' ? entry.name : null),
        rawMain: entry?.comp_main ?? null,
        rawMainExtra: entry?.comp_plus ?? null,
        rawCompletionist: entry?.comp_100 ?? null,
        normalizedMain: normalizeHours(entry?.comp_main),
        normalizedMainExtra: normalizeHours(entry?.comp_plus),
        normalizedCompletionist: normalizeHours(entry?.comp_100),
      }));
    const lastStatus = networkEvents.length > 0 ? networkEvents[networkEvents.length - 1].status : 0;

    return {
      item,
      diagnostic: {
        ok: entriesForMatch.length > 0,
        status: Number.isInteger(lastStatus) ? lastStatus : 0,
        candidates: entriesForMatch.length,
        rawCandidates: capturedEntries.length,
        finalUrl: page.url(),
        sampledTimes,
      },
    };
  } finally {
    page.off('response', responseListener);
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/v1/hltb/search', async (req, res) => {
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

  if (query.length < 2) {
    res.status(400).json({ error: 'Query must be at least 2 characters.' });
    return;
  }

  let browser;

  try {
    const titleVariants = buildSearchTitleVariants(query);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    let item = null;

    for (const variant of titleVariants) {
      const result = await searchHltbInBrowser(page, variant, releaseYear, platform);

      if (debugLogsEnabled) {
        console.info('[hltb-scraper] search_attempt', {
          query,
          variant,
          releaseYear,
          platform: platform || null,
          status: result.diagnostic.status,
          ok: result.diagnostic.ok,
          candidates: result.diagnostic.candidates,
          matched: result.item !== null,
          sampledTimes: result.diagnostic.sampledTimes,
          matchedItem: result.item,
          finalUrl: result.diagnostic.finalUrl,
        });
      }

      if (result.item !== null) {
        item = result.item;
        break;
      }
    }

    await context.close();

    res.json({ item });
  } catch (error) {
    console.error('[hltb-scraper] request_failed', {
      query,
      message: error instanceof Error ? error.message : String(error),
    });
    res.status(502).json({ error: 'Unable to fetch HLTB data.' });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.listen(port, () => {
  console.log(`[hltb-scraper] listening on http://localhost:${port}`);
});
