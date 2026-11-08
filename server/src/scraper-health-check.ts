import { config } from './config.js';

/**
 * Scheduled test lookups against each scraper, reported to Healthchecks.io. Each scraper is
 * searched for a title that should always match, calling it directly so the API's caches can't
 * hide a failure, and the result must be the specific game verified for that scraper. A match sends
 * a success ping; an error, no match or the wrong game sends a `/fail` ping with the reason, which
 * Healthchecks.io includes in its alert. Missed pings alert too, which catches the worker or the
 * whole stack being down.
 *
 * Checks are addressed by slug under the project's ping key and created on first ping
 * (`?create=1`), so the only setup is the ping key secret.
 */

// Generous: a psprices lookup can spend up to ~50s in its FlareSolverr fallback.
export const SCRAPER_HEALTH_CHECK_TIMEOUT_MS = 90_000;
// Node can't hold a timer longer than ~24.8 days (it fires after 1ms instead), so the interval is
// capped well below that.
export const MAX_SCRAPER_HEALTH_CHECK_INTERVAL_MINUTES = 7 * 24 * 60;
const PING_TIMEOUT_MS = 10_000;
// Healthchecks.io stores up to 100kB of a ping body; reasons are kept far shorter.
const MAX_PING_BODY_LENGTH = 1_000;
const MAX_ERROR_DETAIL_LENGTH = 200;

export type ScraperHealthVerdict = { ok: true; detail: string } | { ok: false; reason: string };

export interface ScraperHealthProbe {
  /** Healthchecks.io check slug. */
  slug: string;
  name: string;
  baseUrl: string;
  token: string;
  path: string;
  /**
   * Append `path` to the base URL, keeping any path prefix it has, instead of resolving it as an
   * absolute path. Set to match how the API's own client for that scraper builds its URLs, so
   * the check requests exactly what real lookups do.
   */
  keepBasePath?: boolean;
  query: Record<string, string>;
  /** Decides whether the scraper's JSON response is the expected result. */
  check: (body: unknown) => ScraperHealthVerdict;
}

export interface ScraperHealthResult {
  slug: string;
  ok: boolean;
  message: string;
}

/**
 * Whether the health check runs in this worker, and how often. It runs only in the general worker
 * and only once the Healthchecks.io ping key is set.
 */
export function resolveScraperHealthCheckSchedule(params: {
  runGeneralWork: boolean;
  pingKey: string;
  intervalMinutes: number;
}): { enabled: boolean; intervalMs: number } {
  const intervalMinutes = Math.min(
    MAX_SCRAPER_HEALTH_CHECK_INTERVAL_MINUTES,
    Math.max(1, Math.floor(params.intervalMinutes))
  );
  return {
    enabled: params.runGeneralWork && params.pingKey.trim().length > 0,
    intervalMs: intervalMinutes * 60 * 1000,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isNumberInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Checks that the response's `item` is the expected game and carries the data the scraper exists
 * to provide. The scrapers return their closest candidate even when it's only loosely similar, so
 * any item isn't enough; and they keep a matched game whose price, score or playtime failed to
 * parse, so the right game isn't enough either.
 */
function checkItem(
  body: unknown,
  params: {
    fields: string[];
    expected: string;
    isExpected: (item: Record<string, unknown>) => boolean;
    /** What a healthy match must include, e.g. "a price". */
    requiredData: string;
    hasRequiredData: (item: Record<string, unknown>) => boolean;
  }
): ScraperHealthVerdict {
  const item = asRecord(asRecord(body)?.['item']);
  if (!item) {
    return { ok: false, reason: 'no match for a title that should always match' };
  }
  const details = params.fields
    .filter((field) => item[field] !== undefined && item[field] !== null)
    .map((field) => `${field}=${String(item[field])}`)
    .join(', ');
  if (!params.isExpected(item)) {
    return {
      ok: false,
      reason: `matched the wrong result (${details || 'no details'}), expected ${params.expected}`,
    };
  }
  if (!params.hasRequiredData(item)) {
    return {
      ok: false,
      reason: `matched the expected game without ${params.requiredData} (${details})`,
    };
  }
  return { ok: true, detail: `matched (${details})` };
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
      check: (body) => {
        // A failed title variant means the scraper is partly broken (e.g. FlareSolverr failing),
        // even when this lookup still matched.
        if (asRecord(body)?.['incomplete'] === true) {
          return { ok: false, reason: 'search incomplete: a title variant failed in the scraper' };
        }
        return checkItem(body, {
          fields: ['title', 'amount', 'url'],
          expected: 'title "Hades II"',
          isExpected: (item) => {
            const title = item['title'];
            return (
              typeof title === 'string' &&
              title.replace(/\s+/g, ' ').trim().toLowerCase() === 'hades ii'
            );
          },
          // Zero is a valid price: the scraper reports free games as 0.
          requiredData: 'a price',
          hasRequiredData: (item) => isNumberInRange(item['amount'], 0, Number.MAX_SAFE_INTEGER),
        });
      },
    },
    {
      slug: 'gameshelf-hltb',
      name: 'hltb-scraper',
      baseUrl: config.hltbScraperBaseUrl,
      token: config.hltbScraperToken,
      path: '/v1/hltb/search',
      query: { q: 'Hades', releaseYear: '2020', platform: 'PC (Microsoft Windows)' },
      check: (body) =>
        checkItem(body, {
          fields: ['hltbGameId', 'hltbMainHours'],
          expected: 'hltbGameId 62941',
          isExpected: (item) => Number(item['hltbGameId']) === 62941,
          requiredData: 'a main-story time',
          hasRequiredData: (item) =>
            isNumberInRange(item['hltbMainHours'], Number.MIN_VALUE, Number.MAX_SAFE_INTEGER),
        }),
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
      check: (body) =>
        checkItem(body, {
          fields: ['metacriticScore', 'metacriticUrl'],
          expected: 'metacritic.com/game/hades/',
          isExpected: (item) => {
            const url = item['metacriticUrl'];
            return typeof url === 'string' && /\/game\/hades\/?$/.test(url);
          },
          requiredData: 'a score',
          hasRequiredData: (item) => isNumberInRange(item['metacriticScore'], 1, 100),
        }),
    },
    {
      // One lightweight live source (a single JSON file): the full set of compat lists is
      // refreshed weekly, and fetching them all this often would multiply that upstream traffic.
      slug: 'gameshelf-compat',
      name: 'compat-scraper',
      baseUrl: config.compatScraperBaseUrl,
      token: config.compatScraperToken,
      path: '/v1/compat/11',
      // fetchCompatList appends its path to COMPAT_SCRAPER_BASE_URL, keeping any prefix.
      keepBasePath: true,
      query: {},
      check: (body) => {
        const entries = asRecord(body)?.['entries'];
        return Array.isArray(entries) && entries.length > 0
          ? { ok: true, detail: `served ${String(entries.length)} Xbox entries` }
          : { ok: false, reason: 'served no Xbox entries' };
      },
    },
  ];
}

function errorCode(error: unknown): string | null {
  const code: unknown = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

/**
 * A safe reason for a failed request. Error messages can quote the request URL, including any
 * credentials in it and, for pings, the ping key; and these reasons are logged and sent to
 * Healthchecks.io. So only error codes, error names and fixed descriptions are used, never a
 * message.
 */
function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown error';
  }
  if (error.name === 'TimeoutError') {
    return 'timed out';
  }
  // Node's fetch rejects such URLs with a message that quotes the whole URL.
  if (error instanceof TypeError && error.message.includes('URL that includes credentials')) {
    return 'URL includes credentials, which fetch rejects';
  }
  // Node's fetch only says "fetch failed"; the cause's code names the actual problem, e.g.
  // ECONNREFUSED or ENOTFOUND.
  const cause = error.cause instanceof Error ? error.cause : null;
  const code = errorCode(cause) ?? errorCode(error);
  if (code === 'ERR_INVALID_URL') {
    return 'invalid URL';
  }
  return code ?? (cause ?? error).name;
}

/**
 * A failed lookup's reason for the ping. The ping goes to a third-party service, so only the
 * scraper's own JSON `error` message is included, never raw response text.
 */
function describeHttpFailure(status: number, text: string): string {
  let detail = '';
  try {
    const error = asRecord(JSON.parse(text) as unknown)?.['error'];
    if (typeof error === 'string' && error.trim().length > 0) {
      detail = `: ${error.trim().slice(0, MAX_ERROR_DETAIL_LENGTH)}`;
    }
  } catch {
    // Not JSON: report the status only.
  }
  return `HTTP ${String(status)}${detail}`;
}

async function runProbe(
  probe: ScraperHealthProbe,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<ScraperHealthResult> {
  const startedAt = Date.now();
  let lookup = `${probe.name} lookup ${probe.path}`;
  const fail = (reason: string): ScraperHealthResult => ({
    slug: probe.slug,
    ok: false,
    message: `${lookup} failed: ${reason}`,
  });

  let response: Response;
  let text: string;
  try {
    // Built inside the try so a malformed base URL fails this check, not the whole run.
    const url = probe.keepBasePath
      ? new URL(`${probe.baseUrl.replace(/\/+$/, '')}${probe.path}`)
      : new URL(probe.path, probe.baseUrl);
    for (const [key, value] of Object.entries(probe.query)) {
      url.searchParams.set(key, value);
    }
    lookup = `${probe.name} lookup ${url.pathname}${url.search}`;
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
    return fail(describeHttpFailure(response.status, text));
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return fail('response is not JSON');
  }

  const verdict = probe.check(body);
  if (!verdict.ok) {
    return fail(verdict.reason);
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  return { slug: probe.slug, ok: true, message: `${lookup} ${verdict.detail} in ${seconds}s` };
}

/** Never throws: a failed ping is logged, so one unreachable check doesn't stop the others. */
async function sendPing(
  result: ScraperHealthResult,
  options: { pingKey: string; pingBaseUrl: string; fetchImpl: typeof fetch }
): Promise<void> {
  try {
    const base = options.pingBaseUrl.replace(/\/+$/, '');
    const pingUrl = `${base}/${options.pingKey}/${result.slug}${result.ok ? '' : '/fail'}?create=1`;
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
