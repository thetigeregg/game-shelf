import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import {
  CloudflareBlockError,
  DEFAULT_FLARESOLVERR_URL,
  FLARESOLVERR_TIMEOUT_MS,
  assertSearchResponseOk,
  fetchHtmlViaFlareSolverr,
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
