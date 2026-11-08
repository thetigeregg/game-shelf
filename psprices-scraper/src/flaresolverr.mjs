// Cloudflare fallback for the PSPrices search page. With FLARESOLVERR_ENABLED=true, a search
// Cloudflare's bot protection blocks is retried through FlareSolverr, whose browser gets past the
// challenge that blocks this scraper's headless Chromium. Every request still goes direct first, so
// the fallback stops being used by itself once a block lifts.

import { SEARCH_RESULTS_CONTAINER_SELECTOR } from './search-dom.mjs';

export const DEFAULT_FLARESOLVERR_URL = 'http://flaresolverr:8191';
// The longest FlareSolverr may spend on one page. Each call is also capped by what is left of the
// request's time budget (see flareSolverrTimeoutWithin).
export const FLARESOLVERR_TIMEOUT_MS = 20_000;
// Headroom over FlareSolverr's own timeout, so it can report a failed solve before we give up.
export const FLARESOLVERR_REQUEST_GRACE_MS = 5_000;
// Below this a solve is unlikely to finish, so the call isn't worth starting.
const MIN_FLARESOLVERR_TIMEOUT_MS = 5_000;

/** A response Cloudflare's bot protection answered, not PSPrices itself. */
export class CloudflareBlockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CloudflareBlockError';
  }
}

export function isFlareSolverrEnabled(env = process.env) {
  return (
    String(env.FLARESOLVERR_ENABLED ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

export function resolveFlareSolverrUrl(env = process.env) {
  return String(env.FLARESOLVERR_URL ?? '').trim() || DEFAULT_FLARESOLVERR_URL;
}

/**
 * Throws on a failed navigation instead of letting it parse as "no results". Cloudflare marks its
 * bot-protection responses with `cf-mitigated`, which tells a block apart from a PSPrices error.
 * A null response (same-document navigation) has nothing to check.
 */
export function assertSearchResponseOk(response, url) {
  if (!response) {
    return;
  }

  const status = response.status();
  if (status >= 200 && status < 400) {
    return;
  }

  const failure = `PSPrices: ${String(status)} for ${url}`;
  const mitigated = response.headers()['cf-mitigated'];
  if (mitigated) {
    throw new CloudflareBlockError(`${failure} (blocked by Cloudflare: ${mitigated})`);
  }
  throw new Error(failure);
}

/**
 * The `maxTimeout` to give FlareSolverr when `remainingMs` is left of the request's time budget,
 * leaving room for the grace period. Returns null when too little is left to be worth a call.
 */
export function flareSolverrTimeoutWithin(remainingMs) {
  const timeoutMs = Math.min(FLARESOLVERR_TIMEOUT_MS, remainingMs - FLARESOLVERR_REQUEST_GRACE_MS);
  return timeoutMs >= MIN_FLARESOLVERR_TIMEOUT_MS ? timeoutMs : null;
}

/**
 * Loads the URL in FlareSolverr's browser and returns the rendered HTML. FlareSolverr reports its
 * own failures as JSON under an error status, so its body is read whatever the status.
 * `solution.status` isn't checked: FlareSolverr v3 always reports 200, whatever the page returned.
 */
export async function fetchHtmlViaFlareSolverr(
  url,
  { flareSolverrUrl, maxTimeoutMs = FLARESOLVERR_TIMEOUT_MS, fetchImpl = fetch }
) {
  let response;
  let text;
  try {
    response = await fetchImpl(new URL('/v1', flareSolverrUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: maxTimeoutMs }),
      signal: AbortSignal.timeout(maxTimeoutMs + FLARESOLVERR_REQUEST_GRACE_MS),
    });
    text = await response.text();
  } catch (error) {
    // Node's fetch only says "fetch failed"; the cause names the actual problem, e.g. ENOTFOUND
    // when the scraper isn't on FlareSolverr's network.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    throw new Error(cause instanceof Error ? cause.message : String(cause));
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(
      `${String(response.status)} with a non-JSON reply from ${flareSolverrUrl}, check FLARESOLVERR_URL`
    );
  }

  if (result?.status !== 'ok' || !result.solution) {
    throw new Error(result?.message || 'no solution returned');
  }

  const html = result.solution.response;
  if (typeof html !== 'string' || html.trim().length === 0) {
    throw new Error('it returned an empty page');
  }
  if (/<title>\s*Just a moment/i.test(html)) {
    throw new Error('it returned the Cloudflare challenge page');
  }
  return html;
}

/**
 * Opens FlareSolverr's HTML at its real URL, so relative links resolve to PSPrices, and hands the
 * page to `use`. JavaScript is off and every other request is aborted, so the page's own scripts
 * and assets can't run into the challenge again; the results are already in the rendered HTML.
 */
export async function withHtmlPage(browser, url, html, use) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const request = route.request();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      }
      return route.abort();
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return await use(page);
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * FlareSolverr reports success for any page its browser loaded, including PSPrices error and
 * maintenance pages, which would otherwise parse as "no results". A search page always has the
 * results container, whether or not anything matched.
 */
export async function assertSearchResultsPage(page) {
  if ((await page.locator(SEARCH_RESULTS_CONTAINER_SELECTOR).count()) === 0) {
    throw new Error("it returned a page that isn't PSPrices search results");
  }
}
