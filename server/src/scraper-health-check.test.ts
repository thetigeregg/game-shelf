import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildScraperHealthProbes,
  runScraperHealthChecks,
  type ScraperHealthProbe,
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
    describeMatch: (body) =>
      typeof body === 'object' && body !== null && 'item' in body && body.item !== null
        ? 'matched'
        : null,
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

void test('scraper health check reports the status and body of a failed lookup', async () => {
  const { fetchImpl, pings } = fakeFetch(() =>
    jsonResponse({ error: 'Unable to fetch PSPrices data.' }, 502)
  );
  await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe()],
    fetchImpl,
  });
  assert.match(
    pings()[0]?.body ?? '',
    /failed: HTTP 502 \{"error":"Unable to fetch PSPrices data\."\}$/
  );
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

void test('scraper health probes recognise each scraper response shape', () => {
  const bySlug = new Map(buildScraperHealthProbes().map((entry) => [entry.slug, entry]));
  const describe = (slug: string, body: unknown): string | null => {
    const entry = bySlug.get(slug);
    assert.ok(entry, `missing probe ${slug}`);
    return entry.describeMatch(body);
  };

  assert.equal(
    describe('gameshelf-psprices', {
      item: { title: 'Hades II', amount: 29.9, url: 'https://psprices.com/x' },
      incomplete: false,
    }),
    'matched (title=Hades II, amount=29.9, url=https://psprices.com/x)'
  );
  assert.equal(
    describe('gameshelf-hltb', { item: { hltbGameId: 62941, hltbMainHours: 23.6 } }),
    'matched (hltbGameId=62941, hltbMainHours=23.6)'
  );
  assert.equal(
    describe('gameshelf-metacritic', {
      item: { metacriticScore: 93, metacriticUrl: 'https://www.metacritic.com/game/hades/' },
    }),
    'matched (metacriticScore=93, metacriticUrl=https://www.metacritic.com/game/hades/)'
  );
  assert.equal(
    describe('gameshelf-compat', { emulator: 'xemu', entries: [{}, {}] }),
    'served 2 Xbox entries'
  );

  for (const slug of ['gameshelf-psprices', 'gameshelf-hltb', 'gameshelf-metacritic']) {
    assert.equal(describe(slug, { item: null }), null, slug);
    assert.equal(describe(slug, { item: {} }), null, slug);
    assert.equal(describe(slug, []), null, slug);
  }
  assert.equal(describe('gameshelf-compat', { entries: [] }), null);
  assert.equal(describe('gameshelf-compat', { entries: 'nope' }), null);
});
