// Cloudflare fallback for the PSPrices search page. With FLARESOLVERR_ENABLED=true, a search
// Cloudflare's bot protection blocks is retried through FlareSolverr, whose browser gets past the
// challenge that blocks this scraper's headless Chromium. For a while after a block, searches skip
// the direct request (see createCloudflareBlockMemory); after that they try directly again, so the
// fallback stops being used by itself once a block lifts.

import { randomUUID } from 'node:crypto';
import { SEARCH_RESULTS_CONTAINER_SELECTOR } from './search-dom.mjs';

export const DEFAULT_FLARESOLVERR_URL = 'http://flaresolverr:8191';
// The longest FlareSolverr may spend on one page. Each call is also capped by what is left of the
// request's time budget (see flareSolverrTimeoutWithin).
export const FLARESOLVERR_TIMEOUT_MS = 20_000;
// Headroom over FlareSolverr's own timeout, so it can report a failed solve before we give up.
export const FLARESOLVERR_REQUEST_GRACE_MS = 5_000;
// Below this a solve is unlikely to finish, so the call isn't worth starting.
const MIN_FLARESOLVERR_TIMEOUT_MS = 5_000;
// FlareSolverr starts a session's browser before its maxTimeout clock does, which takes around
// 10 seconds on a NAS. Waiting this much longer for a cold session keeps a slow start from
// cutting off a solve that would have finished.
export const FLARESOLVERR_BROWSER_START_MS = 15_000;
// The client replaces its session after this long, so one browser isn't kept forever. It does this
// itself rather than through FlareSolverr's session_ttl_minutes, whose clock starts only once the
// browser is up, so the client always knows which requests start a browser.
export const FLARESOLVERR_SESSION_MAX_AGE_MS = 30 * 60_000;
// When FlareSolverr doesn't confirm a session was destroyed, the destroy is retried after these
// delays. A request the client gave up on may still be starting that session's browser, and
// FlareSolverr only registers the session once it's up; nothing else would ever close it.
export const FLARESOLVERR_CLEANUP_RETRY_DELAYS_MS = [30_000, 60_000, 120_000];
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
    browserStartMs = 0,
    fetchImpl = fetch,
  }
) {
  // FlareSolverr creates a named session on its first use, so there's no separate create step.
  const body = { cmd: 'request.get', url, maxTimeout: maxTimeoutMs };
  if (session) {
    body.session = session;
  }

  let response;
  let text;
  try {
    response = await fetchImpl(new URL('/v1', flareSolverrUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(maxTimeoutMs + FLARESOLVERR_REQUEST_GRACE_MS + browserStartMs),
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
 * Sends FlareSolverr one request at a time, all through one long-lived browser session. Parallel
 * solves each start a fresh browser, which is slow on a NAS, and a burst of fresh browsers is what
 * gets them challenged. A kept session starts its browser once and keeps Cloudflare's clearance
 * cookie between searches.
 *
 * `fetchHtml` waits its turn and then spends what is left of the caller's `deadline` (see
 * flareSolverrTimeoutWithin). It gives up waiting once too little is left to be worth a call.
 *
 * Sessions are named `${sessionPrefix}-${runId}-N`, unique to this run and never reused, so a
 * delayed cleanup can't hit a live session. The first call removes any left in FlareSolverr by an
 * earlier run of the scraper (a crash, or a shutdown that raced a search), since FlareSolverr never
 * closes an unused session by itself.
 */
export function createFlareSolverrClient({
  flareSolverrUrl,
  fetchImpl = fetch,
  sessionPrefix = 'gameshelf-psprices',
  runId = randomUUID().slice(0, 8),
  idleMs = FLARESOLVERR_SESSION_IDLE_MS,
  cleanupRetryDelaysMs = FLARESOLVERR_CLEANUP_RETRY_DELAYS_MS,
  now = Date.now,
}) {
  // Settles when the latest queued call is finished with FlareSolverr; never rejects.
  let queue = Promise.resolve();
  let sessionNumber = 0;
  let session = null;
  let sessionStartedAt = 0;
  let idleTimer = null;
  let leftoversRemoved = false;
  let closing = false;
  const cleanupTimers = new Set();

  function clearIdleTimer() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  async function command(body) {
    const response = await fetchImpl(new URL('/v1', flareSolverrUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /** Best effort, retried later (see FLARESOLVERR_CLEANUP_RETRY_DELAYS_MS) unless confirmed. */
  async function destroyRemoteSession(name, attempt = 0) {
    let reply = null;
    try {
      reply = await command({ cmd: 'sessions.destroy', session: name });
    } catch {
      // FlareSolverr is gone or busy.
    }
    const delayMs = cleanupRetryDelaysMs[attempt];
    if (reply?.status === 'ok' || delayMs === undefined || closing) {
      return;
    }
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      void destroyRemoteSession(name, attempt + 1);
    }, delayMs);
    timer.unref?.();
    cleanupTimers.add(timer);
  }

  async function retireSession() {
    clearIdleTimer();
    if (!session) {
      return;
    }
    const retired = session;
    session = null;
    await destroyRemoteSession(retired);
  }

  async function removeLeftoverSessions() {
    let reply;
    try {
      reply = await command({ cmd: 'sessions.list' });
    } catch {
      return; // Tried again on the next call.
    }
    leftoversRemoved = true;
    const names = Array.isArray(reply?.sessions) ? reply.sessions : [];
    const leftovers = names.filter(
      (name) =>
        typeof name === 'string' &&
        name.startsWith(`${sessionPrefix}-`) &&
        !name.startsWith(`${sessionPrefix}-${runId}-`)
    );
    await Promise.all(leftovers.map((name) => destroyRemoteSession(name)));
  }

  async function fetchInSession(url, deadline) {
    clearIdleTimer();
    try {
      if (closing) {
        throw new Error('the scraper is shutting down');
      }
      if (!leftoversRemoved) {
        await removeLeftoverSessions();
      }
      if (session && now() - sessionStartedAt >= FLARESOLVERR_SESSION_MAX_AGE_MS) {
        await retireSession();
      }

      const browserStartMs = session ? 0 : FLARESOLVERR_BROWSER_START_MS;
      const maxTimeoutMs = flareSolverrTimeoutWithin(deadline - Date.now() - browserStartMs);
      if (maxTimeoutMs === null) {
        throw new Error('request time budget used up waiting for FlareSolverr');
      }
      if (!session) {
        sessionNumber += 1;
        session = `${sessionPrefix}-${runId}-${String(sessionNumber)}`;
        sessionStartedAt = now();
      }
      try {
        return await fetchHtmlViaFlareSolverr(url, {
          flareSolverrUrl,
          maxTimeoutMs,
          session,
          browserStartMs,
          fetchImpl,
        });
      } catch (error) {
        // Whatever went wrong, the session's browser is in an unknown state: it may be stuck on a
        // challenge or still working on this request. The next call starts a fresh one.
        void retireSession();
        throw error;
      }
    } finally {
      if (session && !closing) {
        idleTimer = setTimeout(() => void retireSession(), idleMs);
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
    /**
     * Stops queued calls from starting and destroys the session, which also ends a call in flight.
     * A session that call was still creating is removed by the next run's first call.
     */
    async close() {
      closing = true;
      for (const timer of cleanupTimers) {
        clearTimeout(timer);
      }
      cleanupTimers.clear();
      await retireSession();
    },
  };
}

/**
 * Remembers a Cloudflare block across requests for `memoryMs`, so searches in that window skip the
 * direct request and go straight to FlareSolverr. Once it runs out, the next search tries directly
 * again, so the fallback still stops by itself once a block lifts. A failed fallback for a
 * remembered block forgets it early (see fallbackFailed).
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
      const error = new CloudflareBlockError(
        `PSPrices: blocked by Cloudflare ${String(Math.round(ageMs / 1000))}s ago, direct request skipped`
      );
      error.rememberedBlockAt = blockedAt;
      return error;
    },
    /**
     * Call when FlareSolverr failed for `blockError`. If that block was only remembered, it's
     * forgotten and this returns true: the direct request should be tried again, since FlareSolverr
     * may be down while the block has lifted. A block recorded since is kept.
     */
    fallbackFailed(blockError) {
      const rememberedAt = blockError?.rememberedBlockAt;
      if (rememberedAt === undefined) {
        return false;
      }
      if (blockedAt === rememberedAt) {
        blockedAt = null;
      }
      return true;
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
