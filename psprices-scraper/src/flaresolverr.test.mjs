import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import {
  CLOUDFLARE_BLOCK_MEMORY_MS,
  CloudflareBlockError,
  DEFAULT_FLARESOLVERR_URL,
  FLARESOLVERR_SESSION_MAX_AGE_MS,
  FLARESOLVERR_BROWSER_START_MS,
  FLARESOLVERR_REQUEST_GRACE_MS,
  FLARESOLVERR_TIMEOUT_MS,
  assertSearchResponseOk,
  assertSearchResultsPage,
  createCloudflareBlockMemory,
  createFlareSolverrClient,
  fetchHtmlViaFlareSolverr,
  flareSolverrTimeoutWithin,
  isFlareSolverrEnabled,
  resolveFlareSolverrUrl,
  withHtmlPage,
} from './flaresolverr.mjs';

const SEARCH_URL = 'https://psprices.com/region-ch/games/?q=Hades+II&show=games&platform=PS5';
const FLARESOLVERR_URL = 'http://flaresolverr:8191';

function fakeResponse(status, headers = {}) {
  return { status: () => status, headers: () => headers };
}

function fakeFetch(status, body) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return { status, text: async () => body };
  };
  return { fetchImpl, calls };
}

function flareSolverrReply(response) {
  return JSON.stringify({
    status: 'ok',
    message: 'Challenge not detected!',
    solution: { url: SEARCH_URL, status: 200, response },
  });
}

test('isFlareSolverrEnabled is on only for "true", ignoring case and whitespace', () => {
  assert.equal(isFlareSolverrEnabled({ FLARESOLVERR_ENABLED: 'true' }), true);
  assert.equal(isFlareSolverrEnabled({ FLARESOLVERR_ENABLED: ' TRUE ' }), true);
  assert.equal(isFlareSolverrEnabled({ FLARESOLVERR_ENABLED: 'false' }), false);
  assert.equal(isFlareSolverrEnabled({ FLARESOLVERR_ENABLED: '1' }), false);
  assert.equal(isFlareSolverrEnabled({}), false);
});

test('resolveFlareSolverrUrl falls back to the default when unset or blank', () => {
  assert.equal(resolveFlareSolverrUrl({}), DEFAULT_FLARESOLVERR_URL);
  assert.equal(resolveFlareSolverrUrl({ FLARESOLVERR_URL: '  ' }), DEFAULT_FLARESOLVERR_URL);
  assert.equal(
    resolveFlareSolverrUrl({ FLARESOLVERR_URL: ' http://10.0.0.5:8191 ' }),
    'http://10.0.0.5:8191'
  );
});

test('assertSearchResponseOk accepts successful and missing responses', () => {
  assert.doesNotThrow(() => assertSearchResponseOk(null, SEARCH_URL));
  assert.doesNotThrow(() => assertSearchResponseOk(fakeResponse(200), SEARCH_URL));
  assert.doesNotThrow(() => assertSearchResponseOk(fakeResponse(304), SEARCH_URL));
});

test('assertSearchResponseOk flags Cloudflare challenges as CloudflareBlockError', () => {
  assert.throws(
    () => assertSearchResponseOk(fakeResponse(403, { 'cf-mitigated': 'challenge' }), SEARCH_URL),
    (error) =>
      error instanceof CloudflareBlockError &&
      error.message === `PSPrices: 403 for ${SEARCH_URL} (blocked by Cloudflare: challenge)`
  );
});

test('assertSearchResponseOk throws a plain error for other failed responses', () => {
  assert.throws(
    () => assertSearchResponseOk(fakeResponse(500), SEARCH_URL),
    (error) =>
      !(error instanceof CloudflareBlockError) &&
      error.message === `PSPrices: 500 for ${SEARCH_URL}`
  );
});

test('fetchHtmlViaFlareSolverr posts a request.get and returns the rendered page', async () => {
  const html = '<html><head><title>All Games</title></head><body></body></html>';
  const { fetchImpl, calls } = fakeFetch(200, flareSolverrReply(html));

  const result = await fetchHtmlViaFlareSolverr(SEARCH_URL, {
    flareSolverrUrl: FLARESOLVERR_URL,
    fetchImpl,
  });

  assert.equal(result, html);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://flaresolverr:8191/v1');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    cmd: 'request.get',
    url: SEARCH_URL,
    maxTimeout: FLARESOLVERR_TIMEOUT_MS,
  });
});

test('fetchHtmlViaFlareSolverr passes a shorter timeout through to FlareSolverr', async () => {
  const { fetchImpl, calls } = fakeFetch(200, flareSolverrReply('<html></html>'));
  await fetchHtmlViaFlareSolverr(SEARCH_URL, {
    flareSolverrUrl: FLARESOLVERR_URL,
    maxTimeoutMs: 7_000,
    fetchImpl,
  });
  assert.equal(JSON.parse(calls[0].init.body).maxTimeout, 7_000);
});

test('flareSolverrTimeoutWithin caps the solve at the default and the remaining budget', () => {
  assert.equal(flareSolverrTimeoutWithin(50_000), FLARESOLVERR_TIMEOUT_MS);
  assert.equal(
    flareSolverrTimeoutWithin(FLARESOLVERR_TIMEOUT_MS + FLARESOLVERR_REQUEST_GRACE_MS),
    FLARESOLVERR_TIMEOUT_MS
  );
  assert.equal(flareSolverrTimeoutWithin(15_000), 15_000 - FLARESOLVERR_REQUEST_GRACE_MS);
  assert.equal(flareSolverrTimeoutWithin(FLARESOLVERR_REQUEST_GRACE_MS + 5_000), 5_000);
});

test('flareSolverrTimeoutWithin skips the call when too little budget is left', () => {
  assert.equal(flareSolverrTimeoutWithin(FLARESOLVERR_REQUEST_GRACE_MS + 4_999), null);
  assert.equal(flareSolverrTimeoutWithin(0), null);
  assert.equal(flareSolverrTimeoutWithin(-1_000), null);
});

test('fetchHtmlViaFlareSolverr reports FlareSolverr errors from an error status', async () => {
  const { fetchImpl } = fakeFetch(
    500,
    JSON.stringify({ status: 'error', message: 'Error: Error solving the challenge. Timeout' })
  );
  await assert.rejects(
    fetchHtmlViaFlareSolverr(SEARCH_URL, { flareSolverrUrl: FLARESOLVERR_URL, fetchImpl }),
    {
      message: 'Error: Error solving the challenge. Timeout',
    }
  );
});

test('fetchHtmlViaFlareSolverr rejects an ok reply without a solution', async () => {
  const { fetchImpl } = fakeFetch(200, JSON.stringify({ status: 'ok' }));
  await assert.rejects(
    fetchHtmlViaFlareSolverr(SEARCH_URL, { flareSolverrUrl: FLARESOLVERR_URL, fetchImpl }),
    {
      message: 'no solution returned',
    }
  );
});

test('fetchHtmlViaFlareSolverr names the status and URL on a non-JSON reply', async () => {
  const { fetchImpl } = fakeFetch(404, '<html>Not Found</html>');
  await assert.rejects(
    fetchHtmlViaFlareSolverr(SEARCH_URL, { flareSolverrUrl: 'http://wrong:8191', fetchImpl }),
    { message: '404 with a non-JSON reply from http://wrong:8191, check FLARESOLVERR_URL' }
  );
});

test('fetchHtmlViaFlareSolverr surfaces the underlying cause of a network failure', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed', {
      cause: new Error('getaddrinfo ENOTFOUND flaresolverr'),
    });
  };
  await assert.rejects(
    fetchHtmlViaFlareSolverr(SEARCH_URL, { flareSolverrUrl: FLARESOLVERR_URL, fetchImpl }),
    {
      message: 'getaddrinfo ENOTFOUND flaresolverr',
    }
  );
});

test('fetchHtmlViaFlareSolverr names the session when given one', async () => {
  const { fetchImpl, calls } = fakeFetch(200, flareSolverrReply('<html></html>'));
  await fetchHtmlViaFlareSolverr(SEARCH_URL, {
    flareSolverrUrl: FLARESOLVERR_URL,
    session: 'gameshelf-psprices-1',
    fetchImpl,
  });
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    cmd: 'request.get',
    url: SEARCH_URL,
    maxTimeout: FLARESOLVERR_TIMEOUT_MS,
    session: 'gameshelf-psprices-1',
  });
});

test('fetchHtmlViaFlareSolverr rejects an empty page', async () => {
  const { fetchImpl } = fakeFetch(200, flareSolverrReply('   '));
  await assert.rejects(
    fetchHtmlViaFlareSolverr(SEARCH_URL, { flareSolverrUrl: FLARESOLVERR_URL, fetchImpl }),
    {
      message: 'it returned an empty page',
    }
  );
});

test('fetchHtmlViaFlareSolverr rejects a page that is still the Cloudflare challenge', async () => {
  const { fetchImpl } = fakeFetch(
    200,
    flareSolverrReply('<html><head><title>Just a moment...</title></head></html>')
  );
  await assert.rejects(
    fetchHtmlViaFlareSolverr(SEARCH_URL, { flareSolverrUrl: FLARESOLVERR_URL, fetchImpl }),
    {
      message: 'it returned the Cloudflare challenge page',
    }
  );
});

test('withHtmlPage serves the HTML at its real URL with scripts and requests blocked', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const html = `<!DOCTYPE html>
      <html><head><title>All Games</title></head>
      <body>
        <div class="game-fragment"><a href="/region-ch/game/1/hades-ii"><h3>Hades II</h3></a></div>
        <img src="/static/cover.png" />
        <script>document.body.dataset.scripted = 'yes';</script>
      </body></html>`;

    const result = await withHtmlPage(browser, SEARCH_URL, html, async (page) =>
      page.evaluate(() => ({
        url: location.href,
        title: document.querySelector('.game-fragment h3')?.textContent,
        href: document.querySelector('.game-fragment a')?.href,
        scripted: document.body.dataset.scripted ?? null,
      }))
    );

    assert.deepEqual(result, {
      url: SEARCH_URL,
      title: 'Hades II',
      href: 'https://psprices.com/region-ch/game/1/hades-ii',
      scripted: null,
    });
    assert.equal(browser.contexts().length, 0, 'the fallback context is closed afterwards');
  } finally {
    await browser.close();
  }
});

test('assertSearchResultsPage accepts search pages with and without results', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const withResults = `<div data-list-results><div class="listing-card-grid">
      <div class="game-fragment"><h3>Hades II</h3></div></div></div>`;
    const noResults = `<div data-list-results><div class="listing-card-grid"></div></div>
      <h2>No Games Found</h2>`;
    for (const html of [withResults, noResults]) {
      await withHtmlPage(browser, SEARCH_URL, html, async (page) => {
        await assert.doesNotReject(assertSearchResultsPage(page));
      });
    }
  } finally {
    await browser.close();
  }
});

test('assertSearchResultsPage rejects pages that are not search results', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const errorPage = '<html><head><title>PSPrices</title></head><body><h1>404</h1></body></html>';
    await withHtmlPage(browser, SEARCH_URL, errorPage, async (page) => {
      await assert.rejects(assertSearchResultsPage(page), {
        message: "it returned a page that isn't PSPrices search results",
      });
    });
  } finally {
    await browser.close();
  }
});

/**
 * A fake FlareSolverr whose request.get calls stay pending until the test settles them, so tests
 * can see what's in flight. sessions.list returns `sessions`; sessions.destroy answers with
 * `destroyReply(name)`, ok by default.
 */
function controlledFlareSolverr({
  sessions = [],
  destroyReply = () => ({ status: 'ok', message: 'The session has been removed.' }),
} = {}) {
  const pending = [];
  const commands = [];
  const json = (value) => ({ status: 200, text: async () => JSON.stringify(value) });
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    commands.push(body);
    if (body.cmd === 'sessions.list') {
      return json({ status: 'ok', sessions });
    }
    if (body.cmd === 'sessions.destroy') {
      return json(destroyReply(body.session));
    }
    return await new Promise((resolve, reject) => {
      pending.push({ body, resolve, reject });
    });
  };
  const reply = (html) => ({ status: 200, text: async () => flareSolverrReply(html) });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  /** The session commands sent, without the first call's sessions.list. */
  const sessionCommands = () =>
    commands.filter(({ cmd }) => cmd !== 'sessions.list').map(({ cmd, session }) => [cmd, session]);
  return { fetchImpl, pending, commands, reply, flush, sessionCommands };
}

const plenty = () => Date.now() + 60_000;

test('createFlareSolverrClient sends one request at a time, in order, in one session', async () => {
  const fake = controlledFlareSolverr();
  const client = createFlareSolverrClient({
    flareSolverrUrl: FLARESOLVERR_URL,
    fetchImpl: fake.fetchImpl,
  });
  try {
    const first = client.fetchHtml(`${SEARCH_URL}&n=1`, { deadline: plenty() });
    const second = client.fetchHtml(`${SEARCH_URL}&n=2`, { deadline: plenty() });
    await fake.flush();
    assert.equal(fake.pending.length, 1, 'the second call waits for the first');

    fake.pending[0].resolve(fake.reply('<html>one</html>'));
    assert.equal(await first, '<html>one</html>');
    await fake.flush();
    assert.equal(fake.pending.length, 2);

    fake.pending[1].resolve(fake.reply('<html>two</html>'));
    assert.equal(await second, '<html>two</html>');
    assert.deepEqual(
      fake.pending.map(({ body }) => [body.url.slice(-3), body.session]),
      [
        ['n=1', 'gameshelf-psprices-1'],
        ['n=2', 'gameshelf-psprices-1'],
      ]
    );
  } finally {
    await client.close();
  }
});

test('createFlareSolverrClient starts a fresh session after a failed solve', async () => {
  const fake = controlledFlareSolverr();
  const client = createFlareSolverrClient({
    flareSolverrUrl: FLARESOLVERR_URL,
    fetchImpl: fake.fetchImpl,
  });
  try {
    const failed = client.fetchHtml(SEARCH_URL, { deadline: plenty() });
    await fake.flush();
    fake.pending[0].resolve({
      status: 500,
      text: async () =>
        JSON.stringify({ status: 'error', message: 'Error: Error solving the challenge.' }),
    });
    await assert.rejects(failed, { message: 'Error: Error solving the challenge.' });

    const next = client.fetchHtml(SEARCH_URL, { deadline: plenty() });
    await fake.flush();
    fake.pending[1].resolve(fake.reply('<html></html>'));
    await next;
    assert.deepEqual(fake.sessionCommands(), [
      ['request.get', 'gameshelf-psprices-1'],
      ['sessions.destroy', 'gameshelf-psprices-1'],
      ['request.get', 'gameshelf-psprices-2'],
    ]);
  } finally {
    await client.close();
  }
});

test('createFlareSolverrClient retires the session when FlareSolverr gives no reply', async () => {
  const fake = controlledFlareSolverr();
  const client = createFlareSolverrClient({
    flareSolverrUrl: FLARESOLVERR_URL,
    fetchImpl: fake.fetchImpl,
  });
  try {
    const failed = client.fetchHtml(SEARCH_URL, { deadline: plenty() });
    await fake.flush();
    fake.pending[0].reject(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    );
    await assert.rejects(failed, { message: 'The operation was aborted due to timeout' });

    const next = client.fetchHtml(SEARCH_URL, { deadline: plenty() });
    await fake.flush();
    fake.pending[1].resolve(fake.reply('<html></html>'));
    await next;
    assert.deepEqual(fake.sessionCommands(), [
      ['request.get', 'gameshelf-psprices-1'],
      ['sessions.destroy', 'gameshelf-psprices-1'],
      ['request.get', 'gameshelf-psprices-2'],
    ]);
  } finally {
    await client.close();
  }
});

test('createFlareSolverrClient stops waiting once too little budget is left, keeping the order', async () => {
  const fake = controlledFlareSolverr();
  const client = createFlareSolverrClient({
    flareSolverrUrl: FLARESOLVERR_URL,
    fetchImpl: fake.fetchImpl,
  });
  try {
    const first = client.fetchHtml(`${SEARCH_URL}&n=1`, { deadline: plenty() });
    // Just over the minimum a call needs, so it has to give up after a short wait.
    const tight = Date.now() + FLARESOLVERR_REQUEST_GRACE_MS + 5_000 + 30;
    const starved = client.fetchHtml(`${SEARCH_URL}&n=2`, { deadline: tight });
    const third = client.fetchHtml(`${SEARCH_URL}&n=3`, { deadline: plenty() });

    await assert.rejects(starved, {
      message: 'request time budget used up waiting for FlareSolverr',
    });
    await fake.flush();
    assert.equal(fake.pending.length, 1, 'the third call still waits for the first');

    fake.pending[0].resolve(fake.reply('<html>one</html>'));
    await first;
    await fake.flush();
    assert.equal(fake.pending.length, 2);
    assert.match(fake.pending[1].body.url, /n=3$/);
    fake.pending[1].resolve(fake.reply('<html>three</html>'));
    assert.equal(await third, '<html>three</html>');
  } finally {
    await client.close();
  }
});

test('createFlareSolverrClient sets aside browser start time for a cold session only', async () => {
  const fake = controlledFlareSolverr();
  const client = createFlareSolverrClient({
    flareSolverrUrl: FLARESOLVERR_URL,
    fetchImpl: fake.fetchImpl,
  });
  const inRange = (value, max) => value <= max && value > max - 1_000;
  try {
    // Cold: 30s left, less the browser start and the grace period.
    const cold = client.fetchHtml(SEARCH_URL, { deadline: Date.now() + 30_000 });
    await fake.flush();
    const coldTimeout = fake.pending[0].body.maxTimeout;
    const coldMax = 30_000 - FLARESOLVERR_BROWSER_START_MS - FLARESOLVERR_REQUEST_GRACE_MS;
    assert.ok(inRange(coldTimeout, coldMax), `cold maxTimeout ${String(coldTimeout)}`);
    fake.pending[0].resolve(fake.reply('<html></html>'));
    await cold;

    // Warm: the same session needs no start time, so 15s left is enough for a call.
    const warm = client.fetchHtml(SEARCH_URL, { deadline: Date.now() + 15_000 });
    await fake.flush();
    const warmTimeout = fake.pending[1].body.maxTimeout;
    assert.ok(
      inRange(warmTimeout, 15_000 - FLARESOLVERR_REQUEST_GRACE_MS),
      `warm ${String(warmTimeout)}`
    );
    fake.pending[1].resolve(fake.reply('<html></html>'));
    await warm;
  } finally {
    await client.close();
  }
});

test('createFlareSolverrClient skips a cold session when the budget cannot cover its start', async () => {
  const fake = controlledFlareSolverr();
  const client = createFlareSolverrClient({
    flareSolverrUrl: FLARESOLVERR_URL,
    fetchImpl: fake.fetchImpl,
  });
  try {
    await assert.rejects(client.fetchHtml(SEARCH_URL, { deadline: Date.now() + 15_000 }), {
      message: 'request time budget used up waiting for FlareSolverr',
    });
    assert.equal(fake.pending.length, 0);
  } finally {
    await client.close();
  }
});

test('createFlareSolverrClient closes an idle session', async () => {
  const fake = controlledFlareSolverr();
  const client = createFlareSolverrClient({
    flareSolverrUrl: FLARESOLVERR_URL,
    fetchImpl: fake.fetchImpl,
    idleMs: 20,
  });
  const call = client.fetchHtml(SEARCH_URL, { deadline: plenty() });
  await fake.flush();
  fake.pending[0].resolve(fake.reply('<html></html>'));
  await call;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(fake.commands.at(-1), {
    cmd: 'sessions.destroy',
    session: 'gameshelf-psprices-1',
  });

  // The next call starts a new session.
  const next = client.fetchHtml(SEARCH_URL, { deadline: plenty() });
  await fake.flush();
  assert.equal(fake.pending[1].body.session, 'gameshelf-psprices-2');
  fake.pending[1].resolve(fake.reply('<html></html>'));
  await next;
  await client.close();
});

test('createCloudflareBlockMemory remembers a block for its window only', () => {
  let now = 1_000_000;
  const memory = createCloudflareBlockMemory({ now: () => now });
  assert.equal(memory.activeBlock(), null);

  memory.record();
  now += 90_000;
  const block = memory.activeBlock();
  assert.ok(block instanceof CloudflareBlockError);
  assert.equal(block.message, 'PSPrices: blocked by Cloudflare 90s ago, direct request skipped');

  now += CLOUDFLARE_BLOCK_MEMORY_MS - 90_000;
  assert.equal(memory.activeBlock(), null);
  assert.equal(memory.activeBlock(), null);
});

test('createCloudflareBlockMemory forgets a remembered block whose fallback failed', () => {
  let now = 1_000_000;
  const memory = createCloudflareBlockMemory({ now: () => now });
  const directBlock = new CloudflareBlockError('PSPrices: 403 (blocked by Cloudflare: challenge)');

  memory.record();
  // A block this request hit directly is still there, so it's kept.
  assert.equal(memory.fallbackFailed(directBlock), false);
  assert.ok(memory.activeBlock());

  now += 1_000;
  assert.equal(memory.fallbackFailed(memory.activeBlock()), true);
  assert.equal(memory.activeBlock(), null);
  assert.equal(memory.fallbackFailed(null), false);
});

test('createCloudflareBlockMemory keeps a block recorded after the remembered one', () => {
  let now = 1_000_000;
  const memory = createCloudflareBlockMemory({ now: () => now });
  memory.record();
  const stale = memory.activeBlock();
  now += 1_000;
  memory.record();

  // Still tells the caller to try directly, but leaves the newer block in place.
  assert.equal(memory.fallbackFailed(stale), true);
  assert.ok(memory.activeBlock());
});

test('createFlareSolverrClient removes sessions an earlier run left, once', async () => {
  const fake = controlledFlareSolverr({
    sessions: ['gameshelf-psprices-3', 'go-gather', 'gameshelf-psprices-7', 'gameshelf-pspricesX'],
  });
  const client = createFlareSolverrClient({
    flareSolverrUrl: FLARESOLVERR_URL,
    fetchImpl: fake.fetchImpl,
  });
  try {
    for (const n of [0, 1]) {
      const call = client.fetchHtml(SEARCH_URL, { deadline: plenty() });
      await fake.flush();
      fake.pending[n].resolve(fake.reply('<html></html>'));
      await call;
    }
    assert.deepEqual(
      fake.commands.map(({ cmd, session }) => [cmd, session]),
      [
        ['sessions.list', undefined],
        ['sessions.destroy', 'gameshelf-psprices-3'],
        ['sessions.destroy', 'gameshelf-psprices-7'],
        ['request.get', 'gameshelf-psprices-1'],
        ['request.get', 'gameshelf-psprices-1'],
      ]
    );
  } finally {
    await client.close();
  }
});

test('createFlareSolverrClient retries a destroy FlareSolverr does not confirm', async () => {
  // FlareSolverr registers a session only once its browser is up, so a destroy can come too early.
  let registered = false;
  const fake = controlledFlareSolverr({
    destroyReply: () =>
      registered
        ? { status: 'ok', message: 'The session has been removed.' }
        : { status: 'error', message: "The session doesn't exist." },
  });
  const client = createFlareSolverrClient({
    flareSolverrUrl: FLARESOLVERR_URL,
    fetchImpl: fake.fetchImpl,
    cleanupRetryDelaysMs: [20, 20, 20],
  });
  try {
    const failed = client.fetchHtml(SEARCH_URL, { deadline: plenty() });
    await fake.flush();
    fake.pending[0].reject(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    );
    await assert.rejects(failed);
    await fake.flush();
    registered = true;
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.deepEqual(fake.sessionCommands(), [
      ['request.get', 'gameshelf-psprices-1'],
      ['sessions.destroy', 'gameshelf-psprices-1'],
      ['sessions.destroy', 'gameshelf-psprices-1'],
    ]);
  } finally {
    await client.close();
  }
});

test('createFlareSolverrClient gives up retrying a destroy after the last delay', async () => {
  const fake = controlledFlareSolverr({
    destroyReply: () => ({ status: 'error', message: "The session doesn't exist." }),
  });
  const client = createFlareSolverrClient({
    flareSolverrUrl: FLARESOLVERR_URL,
    fetchImpl: fake.fetchImpl,
    cleanupRetryDelaysMs: [5, 5],
  });
  const call = client.fetchHtml(SEARCH_URL, { deadline: plenty() });
  await fake.flush();
  fake.pending[0].resolve(fake.reply('<html></html>'));
  await call;
  await client.close();
  // close() stops retries, so retire through a fresh client run instead.
  const destroys = () => fake.commands.filter(({ cmd }) => cmd === 'sessions.destroy').length;
  assert.equal(destroys(), 1, 'close() sends one destroy and schedules no retries');

  const retrying = createFlareSolverrClient({
    flareSolverrUrl: FLARESOLVERR_URL,
    fetchImpl: fake.fetchImpl,
    cleanupRetryDelaysMs: [5, 5],
  });
  const failed = retrying.fetchHtml(SEARCH_URL, { deadline: plenty() });
  await fake.flush();
  fake.pending[1].reject(new Error('boom'));
  await assert.rejects(failed);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(destroys(), 1 + 3, 'one destroy plus two retries');
  await retrying.close();
});

test('createFlareSolverrClient replaces a session at its maximum age, as a cold start', async () => {
  let now = 1_000_000;
  const fake = controlledFlareSolverr();
  const client = createFlareSolverrClient({
    flareSolverrUrl: FLARESOLVERR_URL,
    fetchImpl: fake.fetchImpl,
    now: () => now,
  });
  try {
    const first = client.fetchHtml(SEARCH_URL, { deadline: plenty() });
    await fake.flush();
    fake.pending[0].resolve(fake.reply('<html></html>'));
    await first;

    now += FLARESOLVERR_SESSION_MAX_AGE_MS - 1;
    const warm = client.fetchHtml(SEARCH_URL, { deadline: plenty() });
    await fake.flush();
    fake.pending[1].resolve(fake.reply('<html></html>'));
    await warm;

    now += 1;
    const renewed = client.fetchHtml(SEARCH_URL, { deadline: Date.now() + 30_000 });
    await fake.flush();
    const { maxTimeout } = fake.pending[2].body;
    assert.ok(
      maxTimeout <= 30_000 - FLARESOLVERR_BROWSER_START_MS - FLARESOLVERR_REQUEST_GRACE_MS,
      `renewed session gets the browser start allowance, maxTimeout ${String(maxTimeout)}`
    );
    fake.pending[2].resolve(fake.reply('<html></html>'));
    await renewed;

    assert.deepEqual(fake.sessionCommands(), [
      ['request.get', 'gameshelf-psprices-1'],
      ['request.get', 'gameshelf-psprices-1'],
      ['sessions.destroy', 'gameshelf-psprices-1'],
      ['request.get', 'gameshelf-psprices-2'],
    ]);
  } finally {
    await client.close();
  }
});

test('createFlareSolverrClient close() stops queued calls from starting a session', async () => {
  const fake = controlledFlareSolverr();
  const client = createFlareSolverrClient({
    flareSolverrUrl: FLARESOLVERR_URL,
    fetchImpl: fake.fetchImpl,
  });
  const inFlight = client.fetchHtml(SEARCH_URL, { deadline: plenty() });
  const queued = client.fetchHtml(SEARCH_URL, { deadline: plenty() });
  await fake.flush();

  const closed = client.close();
  // FlareSolverr fails the in-flight request once its session is destroyed.
  fake.pending[0].resolve({
    status: 500,
    text: async () => JSON.stringify({ status: 'error', message: 'session closed' }),
  });
  await closed;
  await assert.rejects(inFlight, { message: 'session closed' });
  await assert.rejects(queued, { message: 'the scraper is shutting down' });

  assert.equal(fake.pending.length, 1);
  assert.deepEqual(fake.sessionCommands(), [
    ['request.get', 'gameshelf-psprices-1'],
    ['sessions.destroy', 'gameshelf-psprices-1'],
  ]);
});
