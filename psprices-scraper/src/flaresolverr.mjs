// Cloudflare fallback for the PSPrices search page. With FLARESOLVERR_ENABLED=true, a search
// Cloudflare's bot protection blocks is retried through FlareSolverr, whose browser gets past the
// challenge that blocks this scraper's headless Chromium. For a while after a block, searches skip
// the direct request (see createCloudflareBlockMemory); after that they try directly again, so the
// fallback stops being used by itself once a block lifts.

import { SEARCH_RESULTS_CONTAINER_SELECTOR } from './search-dom.mjs';

export const DEFAULT_FLARESOLVERR_URL = 'http://flaresolverr:8191';
// The longest FlareSolverr may spend on one page. Each call is also capped by what is left of the
// request's time budget (see flareSolverrTimeoutWithin).
export const FLARESOLVERR_TIMEOUT_MS = 20_000;
// Headroom over FlareSolverr's own timeout, so it can report a failed solve before we give up.
export const FLARESOLVERR_REQUEST_GRACE_MS = 5_000;
// Below this a solve is unlikely to finish, so the call isn't worth starting.
const MIN_FLARESOLVERR_TIMEOUT_MS = 5_000;
// FlareSolverr replaces a session's browser on the first request after this long, so one browser
// isn't kept forever.
export const FLARESOLVERR_SESSION_TTL_MINUTES = 30;
// An unused session is closed after this long, so FlareSolverr isn't left running an idle browser.
export const FLARESOLVERR_SESSION_IDLE_MS = 10 * 60_000;
// After a Cloudflare block, searches skip the direct request for this long and go straight to
// FlareSolverr. Each blocked direct request is another bot signal from the NAS's address.
export const CLOUDFLARE_BLOCK_MEMORY_MS = 15 * 60_000;

/** A response Cloudflare's bot protection answered, not PSPrices itself. */
export class CloudflareBlockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CloudflareBlockError';
  }
}

/**
 * FlareSolverr didn't answer (unreachable, or the request timed out). It may still be working on
 * the request, so the session that request used shouldn't be given another one.
 */
export class FlareSolverrNoReplyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FlareSolverrNoReplyError';
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
  {
    flareSolverrUrl,
    maxTimeoutMs = FLARESOLVERR_TIMEOUT_MS,
    session = null,
    sessionTtlMinutes = FLARESOLVERR_SESSION_TTL_MINUTES,
    fetchImpl = fetch,
  }
) {
  // FlareSolverr creates a named session on its first use, so there's no separate create step.
  const body = { cmd: 'request.get', url, maxTimeout: maxTimeoutMs };
  if (session) {
    body.session = session;
    body.session_ttl_minutes = sessionTtlMinutes;
  }

  let response;
  let text;
  try {
    response = await fetchImpl(new URL('/v1', flareSolverrUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(maxTimeoutMs + FLARESOLVERR_REQUEST_GRACE_MS),
    });
    text = await response.text();
  } catch (error) {
    // Node's fetch only says "fetch failed"; the cause names the actual problem, e.g. ENOTFOUND
    // when the scraper isn't on FlareSolverr's network.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    throw new FlareSolverrNoReplyError(cause instanceof Error ? cause.message : String(cause));
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
 * Sends FlareSolverr one request at a time, all through one long-lived browser session. Parallel
 * solves each start a fresh browser, which is slow on a NAS, and a burst of fresh browsers is what
 * gets them challenged. A kept session starts its browser once and keeps Cloudflare's clearance
 * cookie between searches.
 *
 * `fetchHtml` waits its turn and then spends what is left of the caller's `deadline` (see
 * flareSolverrTimeoutWithin). It gives up waiting once too little is left to be worth a call.
 */
export function createFlareSolverrClient({
  flareSolverrUrl,
  fetchImpl = fetch,
  sessionPrefix = 'gameshelf-psprices',
  idleMs = FLARESOLVERR_SESSION_IDLE_MS,
}) {
  // Settles when the latest queued call is finished with FlareSolverr; never rejects.
  let queue = Promise.resolve();
  let sessionNumber = 0;
  let session = null;
  let idleTimer = null;

  function clearIdleTimer() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  /** Best effort: a session that outlives this fails nothing, it only holds a browser open. */
  async function destroySession() {
    clearIdleTimer();
    if (!session) {
      return;
    }
    const retired = session;
    session = null;
    try {
      const response = await fetchImpl(new URL('/v1', flareSolverrUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: 'sessions.destroy', session: retired }),
        signal: AbortSignal.timeout(10_000),
      });
      await response.text();
    } catch {
      // FlareSolverr is gone or busy; it drops the session when it restarts.
    }
  }

  async function fetchInSession(url, deadline) {
    clearIdleTimer();
    try {
      const maxTimeoutMs = flareSolverrTimeoutWithin(deadline - Date.now());
      if (maxTimeoutMs === null) {
        throw new Error('request time budget used up waiting for FlareSolverr');
      }
      if (!session) {
        sessionNumber += 1;
        session = `${sessionPrefix}-${String(sessionNumber)}`;
      }
      try {
        return await fetchHtmlViaFlareSolverr(url, {
          flareSolverrUrl,
          maxTimeoutMs,
          session,
          fetchImpl,
        });
      } catch (error) {
        // FlareSolverr may still be working in this session, so the next call gets a fresh one.
        if (error instanceof FlareSolverrNoReplyError) {
          void destroySession();
        }
        throw error;
      }
    } finally {
      if (session) {
        idleTimer = setTimeout(() => void destroySession(), idleMs);
        idleTimer.unref?.();
      }
    }
  }

  function waitForTurn(previous, deadline) {
    const waitMs =
      deadline - Date.now() - (MIN_FLARESOLVERR_TIMEOUT_MS + FLARESOLVERR_REQUEST_GRACE_MS);
    let timer = null;
    const outOfTime = new Promise((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('request time budget used up waiting for FlareSolverr')),
        Math.max(0, waitMs)
      );
    });
    return Promise.race([previous, outOfTime]).finally(() => clearTimeout(timer));
  }

  return {
    async fetchHtml(url, { deadline }) {
      const previous = queue;
      let release;
      queue = new Promise((resolve) => {
        release = resolve;
      });
      try {
        await waitForTurn(previous, deadline);
        return await fetchInSession(url, deadline);
      } finally {
        // The next call still goes after the one before this, even if this one stopped waiting.
        void previous.then(release);
      }
    },
    close: destroySession,
  };
}

/**
 * Remembers a Cloudflare block across requests for `memoryMs`, so searches in that window skip the
 * direct request and go straight to FlareSolverr. Once it runs out, the next search tries directly
 * again, so the fallback still stops by itself once a block lifts.
 */
export function createCloudflareBlockMemory({
  memoryMs = CLOUDFLARE_BLOCK_MEMORY_MS,
  now = Date.now,
} = {}) {
  let blockedAt = null;
  return {
    record() {
      blockedAt = now();
    },
    /** An error standing in for the skipped direct request while a block is remembered, else null. */
    activeBlock() {
      if (blockedAt === null) {
        return null;
      }
      const ageMs = now() - blockedAt;
      if (ageMs >= memoryMs) {
        blockedAt = null;
        return null;
      }
      return new CloudflareBlockError(
        `PSPrices: blocked by Cloudflare ${String(Math.round(ageMs / 1000))}s ago, direct request skipped`
      );
    },
  };
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
