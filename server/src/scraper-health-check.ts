import { config } from './config.js';

/**
 * Scheduled test lookups against each scraper, reported to Healthchecks.io. Each scraper is
 * searched for a title that should always match, calling it directly so the API's caches can't
 * hide a failure. A match sends a success ping; an error or no match sends a `/fail` ping with the
 * reason, which Healthchecks.io includes in its alert. Missed pings alert too, which catches the
 * worker or the whole stack being down.
 *
 * Checks are addressed by slug under the project's ping key and created on first ping
 * (`?create=1`), so the only setup is the ping key secret.
 */

// Generous: a psprices lookup can spend up to ~50s in its FlareSolverr fallback.
export const SCRAPER_HEALTH_CHECK_TIMEOUT_MS = 90_000;
const PING_TIMEOUT_MS = 10_000;
// Healthchecks.io stores up to 100kB of a ping body; reasons are kept far shorter.
const MAX_PING_BODY_LENGTH = 1_000;

export interface ScraperHealthProbe {
  /** Healthchecks.io check slug. */
  slug: string;
  name: string;
  baseUrl: string;
  token: string;
  path: string;
  query: Record<string, string>;
  /** Returns a description of the match, or null when the response doesn't contain one. */
  describeMatch: (body: unknown) => string | null;
}

export interface ScraperHealthResult {
  slug: string;
  ok: boolean;
  message: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function describeItem(body: unknown, fields: string[]): string | null {
  const item = asRecord(asRecord(body)?.['item']);
  if (!item) {
    return null;
  }
  const details = fields
    .filter((field) => item[field] !== undefined && item[field] !== null)
    .map((field) => `${field}=${String(item[field])}`);
  return details.length > 0 ? `matched (${details.join(', ')})` : null;
}

export function buildScraperHealthProbes(): ScraperHealthProbe[] {
  return [
    {
      slug: 'gameshelf-psprices',
      name: 'psprices-scraper',
      baseUrl: config.pspricesScraperBaseUrl,
      token: config.pspricesScraperToken,
      path: '/v1/psprices/search',
      query: {
        q: 'Hades II',
        platform: 'PS5',
        region: config.pspricesRegionPath,
        show: config.pspricesShow,
      },
      describeMatch: (body) => describeItem(body, ['title', 'amount', 'url']),
    },
    {
      slug: 'gameshelf-hltb',
      name: 'hltb-scraper',
      baseUrl: config.hltbScraperBaseUrl,
      token: config.hltbScraperToken,
      path: '/v1/hltb/search',
      query: { q: 'Hades', releaseYear: '2020', platform: 'PC (Microsoft Windows)' },
      describeMatch: (body) => describeItem(body, ['hltbGameId', 'hltbMainHours']),
    },
    {
      slug: 'gameshelf-metacritic',
      name: 'metacritic-scraper',
      baseUrl: config.metacriticScraperBaseUrl,
      token: config.metacriticScraperToken,
      path: '/v1/metacritic/search',
      query: {
        q: 'Hades',
        releaseYear: '2020',
        platform: 'PC (Microsoft Windows)',
        platformIgdbId: '6',
      },
      describeMatch: (body) => describeItem(body, ['metacriticScore', 'metacriticUrl']),
    },
    {
      // One lightweight live source (a single JSON file): the full set of compat lists is
      // refreshed weekly, and fetching them all this often would multiply that upstream traffic.
      slug: 'gameshelf-compat',
      name: 'compat-scraper',
      baseUrl: config.compatScraperBaseUrl,
      token: config.compatScraperToken,
      path: '/v1/compat/11',
      query: {},
      describeMatch: (body) => {
        const entries = asRecord(body)?.['entries'];
        return Array.isArray(entries) && entries.length > 0
          ? `served ${String(entries.length)} Xbox entries`
          : null;
      },
    },
  ];
}

function errorMessage(error: unknown): string {
  // Node's fetch only says "fetch failed"; the cause names the actual problem, e.g. ENOTFOUND.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  if (cause instanceof Error && cause.name === 'TimeoutError') {
    return 'timed out';
  }
  return cause instanceof Error ? cause.message : String(cause);
}

async function runProbe(
  probe: ScraperHealthProbe,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<ScraperHealthResult> {
  const url = new URL(probe.path, probe.baseUrl);
  for (const [key, value] of Object.entries(probe.query)) {
    url.searchParams.set(key, value);
  }
  const lookup = `${probe.name} lookup ${url.pathname}${url.search}`;
  const startedAt = Date.now();
  const fail = (reason: string): ScraperHealthResult => ({
    slug: probe.slug,
    ok: false,
    message: `${lookup} failed: ${reason}`,
  });

  let response: Response;
  let text: string;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        ...(probe.token.length > 0 ? { Authorization: `Bearer ${probe.token}` } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await response.text();
  } catch (error) {
    return fail(errorMessage(error));
  }

  if (!response.ok) {
    return fail(`HTTP ${String(response.status)} ${text.slice(0, 200)}`.trim());
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return fail('response is not JSON');
  }

  const match = probe.describeMatch(body);
  if (match === null) {
    return fail('no match for a title that should always match');
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  return { slug: probe.slug, ok: true, message: `${lookup} ${match} in ${seconds}s` };
}

/** Never throws: a failed ping is logged, so one unreachable check doesn't stop the others. */
async function sendPing(
  result: ScraperHealthResult,
  options: { pingKey: string; pingBaseUrl: string; fetchImpl: typeof fetch }
): Promise<void> {
  const base = options.pingBaseUrl.replace(/\/+$/, '');
  const pingUrl = `${base}/${options.pingKey}/${result.slug}${result.ok ? '' : '/fail'}?create=1`;
  try {
    const response = await options.fetchImpl(pingUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: result.message.slice(0, MAX_PING_BODY_LENGTH),
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn('[scraper-health-check] ping_failed', {
        slug: result.slug,
        status: response.status,
      });
    }
  } catch (error) {
    // The ping URL carries the ping key, so only the slug is logged.
    console.warn('[scraper-health-check] ping_failed', {
      slug: result.slug,
      error: errorMessage(error),
    });
  }
}

/**
 * Runs each probe in turn and pings its check. Probes whose scraper has no base URL configured
 * are skipped without a ping.
 */
export async function runScraperHealthChecks(options: {
  pingKey: string;
  pingBaseUrl: string;
  probes?: ScraperHealthProbe[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ScraperHealthResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const probes = options.probes ?? buildScraperHealthProbes();
  const results: ScraperHealthResult[] = [];

  for (const probe of probes) {
    if (probe.baseUrl.trim().length === 0) {
      continue;
    }
    const result = await runProbe(
      probe,
      fetchImpl,
      options.timeoutMs ?? SCRAPER_HEALTH_CHECK_TIMEOUT_MS
    );
    results.push(result);
    if (result.ok) {
      console.info('[scraper-health-check] passed', { slug: result.slug, message: result.message });
    } else {
      console.warn('[scraper-health-check] failed', { slug: result.slug, message: result.message });
    }
    await sendPing(result, {
      pingKey: options.pingKey,
      pingBaseUrl: options.pingBaseUrl,
      fetchImpl,
    });
  }

  return results;
}
