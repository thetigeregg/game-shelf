// Cloudflare fallback for the PSPrices search page. With FLARESOLVERR_ENABLED=true, a search
// Cloudflare's bot protection blocks is retried through FlareSolverr, whose browser gets past the
// challenge that blocks this scraper's headless Chromium. Every search still goes direct first, so
// the fallback stops being used by itself once a block lifts.

export const DEFAULT_FLARESOLVERR_URL = 'http://flaresolverr:8191';
export const FLARESOLVERR_TIMEOUT_MS = 60_000;
// Headroom over FlareSolverr's own timeout, so it can report a failed solve before we give up.
const FLARESOLVERR_REQUEST_GRACE_MS = 10_000;

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
 * Loads the URL in FlareSolverr's browser and returns the rendered HTML. FlareSolverr reports its
 * own failures as JSON under an error status, so its body is read whatever the status.
 * `solution.status` isn't checked: FlareSolverr v3 always reports 200, whatever the page returned.
 */
export async function fetchHtmlViaFlareSolverr(url, { flareSolverrUrl, fetchImpl = fetch } = {}) {
  const baseUrl = flareSolverrUrl || DEFAULT_FLARESOLVERR_URL;
  let response;
  let text;
  try {
    response = await fetchImpl(new URL('/v1', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: FLARESOLVERR_TIMEOUT_MS }),
      signal: AbortSignal.timeout(FLARESOLVERR_TIMEOUT_MS + FLARESOLVERR_REQUEST_GRACE_MS),
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
      `${String(response.status)} with a non-JSON reply from ${baseUrl}, check FLARESOLVERR_URL`
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
