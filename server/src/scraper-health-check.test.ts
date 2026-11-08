import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_SCRAPER_HEALTH_CHECK_INTERVAL_MINUTES,
  buildScraperHealthProbes,
  resolveScraperHealthCheckSchedule,
  runScraperHealthChecks,
  type ScraperHealthProbe,
  type ScraperHealthVerdict,
} from './scraper-health-check.js';

const PING_KEY = 'test-ping-key';
const PING_BASE_URL = 'https://hc-ping.example';

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function toUrl(input: Parameters<typeof fetch>[0]): string {
  if (input instanceof URL) {
    return input.href;
  }
  return typeof input === 'string' ? input : input.url;
}

/** Answers scraper lookups with `scraperReply` and records every request, pings included. */
function fakeFetch(scraperReply: (url: string, init?: RequestInit) => Promise<Response>): {
  fetchImpl: typeof fetch;
  requests: RecordedRequest[];
  pings: () => RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = toUrl(input);
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    if (url.startsWith(PING_BASE_URL)) {
      return new Response('OK', { status: 200 });
    }
    return scraperReply(url, init);
  }) as typeof fetch;
  return {
    fetchImpl,
    requests,
    pings: () => requests.filter((request) => request.url.startsWith(PING_BASE_URL)),
  };
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  );
}

function probe(overrides: Partial<ScraperHealthProbe> = {}): ScraperHealthProbe {
  return {
    slug: 'gameshelf-test',
    name: 'test-scraper',
    baseUrl: 'http://test-scraper:8000',
    token: '',
    path: '/v1/test/search',
    query: { q: 'Hades' },
    check: (body) =>
      typeof body === 'object' && body !== null && 'item' in body && body.item !== null
        ? { ok: true, detail: 'matched' }
        : { ok: false, reason: 'no match for a title that should always match' },
    ...overrides,
  };
}

void test('scraper health check pings success with the match and auto-creates the check', async () => {
  const { fetchImpl, requests, pings } = fakeFetch(() => jsonResponse({ item: { title: 'x' } }));

  const results = await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe()],
    fetchImpl,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.ok, true);
  assert.equal(requests[0]?.url, 'http://test-scraper:8000/v1/test/search?q=Hades');
  assert.equal(requests[0]?.headers['authorization'], undefined);
  const [ping] = pings();
  assert.ok(ping);
  assert.equal(ping.url, `${PING_BASE_URL}/${PING_KEY}/gameshelf-test?create=1`);
  assert.equal(ping.method, 'POST');
  assert.match(ping.body ?? '', /^test-scraper lookup \/v1\/test\/search\?q=Hades matched in /);
});

void test('scraper health check sends the scraper token when one is configured', async () => {
  const { fetchImpl, requests } = fakeFetch(() => jsonResponse({ item: {} }));
  await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe({ token: 'secret-token' })],
    fetchImpl,
  });
  assert.equal(requests[0]?.headers['authorization'], 'Bearer secret-token');
});

void test('scraper health check pings fail when the known title does not match', async () => {
  const { fetchImpl, pings } = fakeFetch(() => jsonResponse({ item: null }));

  const [result] = await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe()],
    fetchImpl,
  });

  assert.ok(result);
  assert.equal(result.ok, false);
  assert.equal(pings()[0]?.url, `${PING_BASE_URL}/${PING_KEY}/gameshelf-test/fail?create=1`);
  assert.equal(
    pings()[0]?.body,
    'test-scraper lookup /v1/test/search?q=Hades failed: no match for a title that should always match'
  );
});

void test('scraper health check reports the status and scraper error of a failed lookup', async () => {
  const { fetchImpl, pings } = fakeFetch(() =>
    jsonResponse({ error: 'Unable to fetch PSPrices data.', detail: 'internal' }, 502)
  );
  await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe()],
    fetchImpl,
  });
  assert.match(pings()[0]?.body ?? '', /failed: HTTP 502: Unable to fetch PSPrices data\.$/);
});

void test('scraper health check keeps raw response text out of the ping', async () => {
  const { fetchImpl, pings } = fakeFetch(() =>
    Promise.resolve(
      new Response('<html>upstream 10.0.0.5:8790 /srv/app stack trace</html>', { status: 503 })
    )
  );
  await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe()],
    fetchImpl,
  });
  assert.match(pings()[0]?.body ?? '', /failed: HTTP 503$/);
});

void test('scraper health check reports the cause of a network failure', async () => {
  const { fetchImpl, pings } = fakeFetch(() =>
    Promise.reject(
      new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND test-scraper') })
    )
  );
  await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe()],
    fetchImpl,
  });
  assert.match(pings()[0]?.body ?? '', /failed: getaddrinfo ENOTFOUND test-scraper$/);
});

void test('scraper health check names the error code when the cause has no message', async () => {
  // Node reports a refusal from every address of a dual-stack host as an empty AggregateError.
  const cause = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' });
  const { fetchImpl, pings } = fakeFetch(() =>
    Promise.reject(new TypeError('fetch failed', { cause }))
  );
  await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe()],
    fetchImpl,
  });
  assert.match(pings()[0]?.body ?? '', /failed: AggregateError \(ECONNREFUSED\)$/);
});

void test('scraper health check fails one check for a malformed base URL and runs the rest', async () => {
  const { fetchImpl, pings } = fakeFetch(() => jsonResponse({ item: {} }));
  const results = await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe({ slug: 'broken', baseUrl: 'metacritic-scraper:8789' }), probe({ slug: 'ok' })],
    fetchImpl,
  });

  assert.deepEqual(
    results.map((result) => [result.slug, result.ok]),
    [
      ['broken', false],
      ['ok', true],
    ]
  );
  assert.equal(pings()[0]?.url, `${PING_BASE_URL}/${PING_KEY}/broken/fail?create=1`);
  assert.match(pings()[0]?.body ?? '', /^test-scraper lookup \/v1\/test\/search failed: /);
  assert.equal(pings()[1]?.url, `${PING_BASE_URL}/${PING_KEY}/ok?create=1`);
});

void test('scraper health check reports a lookup that outlasts the timeout', async () => {
  const { fetchImpl, pings } = fakeFetch(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error);
        });
      })
  );
  await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe()],
    fetchImpl,
    timeoutMs: 10,
  });
  assert.match(pings()[0]?.body ?? '', /failed: timed out$/);
});

void test('scraper health check reports a reply that is not JSON', async () => {
  const { fetchImpl, pings } = fakeFetch(() =>
    Promise.resolve(new Response('<html>Bad Gateway</html>', { status: 200 }))
  );
  await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe()],
    fetchImpl,
  });
  assert.match(pings()[0]?.body ?? '', /failed: response is not JSON$/);
});

void test('scraper health check skips scrapers without a base URL and sends no ping', async () => {
  const { fetchImpl, requests } = fakeFetch(() => jsonResponse({ item: {} }));
  const results = await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe({ baseUrl: '  ' })],
    fetchImpl,
  });
  assert.deepEqual(results, []);
  assert.equal(requests.length, 0);
});

void test('scraper health check keeps going when a ping fails', async () => {
  let pingCalls = 0;
  const fetchImpl = ((input: Parameters<typeof fetch>[0]) => {
    if (toUrl(input).startsWith(PING_BASE_URL)) {
      pingCalls += 1;
      return Promise.reject(new TypeError('fetch failed', { cause: new Error('ECONNRESET') }));
    }
    return Promise.resolve(new Response(JSON.stringify({ item: {} }), { status: 200 }));
  }) as typeof fetch;

  const results = await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe({ slug: 'first' }), probe({ slug: 'second' })],
    fetchImpl,
  });

  assert.deepEqual(
    results.map((result) => [result.slug, result.ok]),
    [
      ['first', true],
      ['second', true],
    ]
  );
  assert.equal(pingCalls, 2);
});

void test('scraper health check tolerates a trailing slash on the ping base URL', async () => {
  const { fetchImpl, pings } = fakeFetch(() => jsonResponse({ item: {} }));
  await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: `${PING_BASE_URL}/`,
    probes: [probe()],
    fetchImpl,
  });
  assert.equal(pings()[0]?.url, `${PING_BASE_URL}/${PING_KEY}/gameshelf-test?create=1`);
});

void test('scraper health probes cover each scraper with a known title', () => {
  const probes = buildScraperHealthProbes();
  assert.deepEqual(
    probes.map((entry) => [entry.slug, entry.path, entry.query['q'] ?? null]),
    [
      ['gameshelf-psprices', '/v1/psprices/search', 'Hades II'],
      ['gameshelf-hltb', '/v1/hltb/search', 'Hades'],
      ['gameshelf-metacritic', '/v1/metacritic/search', 'Hades'],
      ['gameshelf-compat', '/v1/compat/11', null],
    ]
  );
});

void test('scraper health probes accept the verified result for each scraper', () => {
  const verdict = probeVerdict;
  assert.deepEqual(
    verdict('gameshelf-psprices', {
      item: { title: 'Hades II', amount: 29.9, url: 'https://psprices.com/x' },
      incomplete: false,
    }),
    { ok: true, detail: 'matched (title=Hades II, amount=29.9, url=https://psprices.com/x)' }
  );
  assert.deepEqual(
    verdict('gameshelf-hltb', { item: { hltbGameId: 62941, hltbMainHours: 23.6 } }),
    {
      ok: true,
      detail: 'matched (hltbGameId=62941, hltbMainHours=23.6)',
    }
  );
  assert.deepEqual(
    verdict('gameshelf-metacritic', {
      item: { metacriticScore: 93, metacriticUrl: 'https://www.metacritic.com/game/hades/' },
    }),
    {
      ok: true,
      detail: 'matched (metacriticScore=93, metacriticUrl=https://www.metacritic.com/game/hades/)',
    }
  );
  assert.deepEqual(verdict('gameshelf-compat', { emulator: 'xemu', entries: [{}, {}] }), {
    ok: true,
    detail: 'served 2 Xbox entries',
  });
});

void test('scraper health probes reject a missing match', () => {
  for (const slug of ['gameshelf-psprices', 'gameshelf-hltb', 'gameshelf-metacritic']) {
    for (const body of [{ item: null }, [], 'nope']) {
      assert.deepEqual(
        probeVerdict(slug, body),
        { ok: false, reason: 'no match for a title that should always match' },
        slug
      );
    }
  }
  for (const body of [{ entries: [] }, { entries: 'nope' }, null]) {
    assert.deepEqual(probeVerdict('gameshelf-compat', body), {
      ok: false,
      reason: 'served no Xbox entries',
    });
  }
});

void test('scraper health probes reject a match on the wrong game', () => {
  assert.deepEqual(probeVerdict('gameshelf-psprices', { item: { title: 'Hades', amount: 19.9 } }), {
    ok: false,
    reason: 'matched the wrong result (title=Hades, amount=19.9), expected title "Hades II"',
  });
  assert.deepEqual(probeVerdict('gameshelf-hltb', { item: { hltbGameId: 118218 } }), {
    ok: false,
    reason: 'matched the wrong result (hltbGameId=118218), expected hltbGameId 62941',
  });
  assert.deepEqual(
    probeVerdict('gameshelf-metacritic', {
      item: { metacriticUrl: 'https://www.metacritic.com/game/hades-ii/' },
    }),
    {
      ok: false,
      reason:
        'matched the wrong result (metacriticUrl=https://www.metacritic.com/game/hades-ii/), expected metacritic.com/game/hades/',
    }
  );
  assert.deepEqual(probeVerdict('gameshelf-hltb', { item: {} }), {
    ok: false,
    reason: 'matched the wrong result (no details), expected hltbGameId 62941',
  });
});

void test('scraper health psprices probe fails an incomplete search even when it matched', () => {
  assert.deepEqual(
    probeVerdict('gameshelf-psprices', {
      item: { title: 'Hades II', amount: 29.9 },
      incomplete: true,
    }),
    { ok: false, reason: 'search incomplete: a title variant failed in the scraper' }
  );
});

void test('scraper health check schedule runs only in the general worker with a ping key', () => {
  const schedule = (runGeneralWork: boolean, pingKey: string) =>
    resolveScraperHealthCheckSchedule({ runGeneralWork, pingKey, intervalMinutes: 360 });
  assert.deepEqual(schedule(true, 'key'), { enabled: true, intervalMs: 360 * 60_000 });
  assert.equal(schedule(false, 'key').enabled, false);
  assert.equal(schedule(true, '').enabled, false);
  assert.equal(schedule(true, '   ').enabled, false);
});

void test('scraper health check schedule keeps the interval within what a timer can hold', () => {
  const intervalMs = (intervalMinutes: number) =>
    resolveScraperHealthCheckSchedule({ runGeneralWork: true, pingKey: 'key', intervalMinutes })
      .intervalMs;
  assert.equal(intervalMs(43_200), MAX_SCRAPER_HEALTH_CHECK_INTERVAL_MINUTES * 60_000);
  assert.ok(intervalMs(Number.MAX_SAFE_INTEGER) <= 2_147_483_647);
  assert.equal(intervalMs(0), 60_000);
  assert.equal(intervalMs(-5), 60_000);
  assert.equal(intervalMs(90.7), 90 * 60_000);
});

function probeVerdict(slug: string, body: unknown): ScraperHealthVerdict {
  const entry = buildScraperHealthProbes().find((candidate) => candidate.slug === slug);
  assert.ok(entry, `missing probe ${slug}`);
  return entry.check(body);
}
