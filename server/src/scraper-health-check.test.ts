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
const PING_ORIGIN = new URL(PING_BASE_URL).origin;

/** Pings are told apart from scraper lookups by origin. */
function isPing(url: string): boolean {
  return new URL(url).origin === PING_ORIGIN;
}

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
    if (isPing(url)) {
      return new Response('OK', { status: 200 });
    }
    return scraperReply(url, init);
  }) as typeof fetch;
  return {
    fetchImpl,
    requests,
    pings: () => requests.filter((request) => isPing(request.url)),
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

void test('scraper health check reports the error code of a network failure', async () => {
  const cause = Object.assign(new Error('getaddrinfo ENOTFOUND test-scraper'), {
    code: 'ENOTFOUND',
  });
  const { fetchImpl, pings } = fakeFetch(() =>
    Promise.reject(new TypeError('fetch failed', { cause }))
  );
  await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe()],
    fetchImpl,
  });
  assert.match(pings()[0]?.body ?? '', /failed: ENOTFOUND$/);
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
  assert.match(pings()[0]?.body ?? '', /failed: ECONNREFUSED$/);
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

void test('scraper health check keeps a base URL path prefix when the probe asks to', async () => {
  const { fetchImpl, requests } = fakeFetch(() => jsonResponse({ item: {} }));
  await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [
      probe({ slug: 'kept', baseUrl: 'http://proxy:8080/compat', keepBasePath: true }),
      probe({ slug: 'kept-slash', baseUrl: 'http://proxy:8080/compat/', keepBasePath: true }),
      probe({ slug: 'resolved', baseUrl: 'http://proxy:8080/compat' }),
    ],
    fetchImpl,
  });
  const lookups = requests.filter((request) => !isPing(request.url)).map((request) => request.url);
  assert.deepEqual(lookups, [
    'http://proxy:8080/compat/v1/test/search?q=Hades',
    'http://proxy:8080/compat/v1/test/search?q=Hades',
    // Without the flag the path resolves from the root, as the HLTB, Metacritic and psprices
    // clients do.
    'http://proxy:8080/v1/test/search?q=Hades',
  ]);
});

void test('scraper health probes build URLs the way each API client does', () => {
  assert.deepEqual(
    buildScraperHealthProbes().map((entry) => [entry.slug, entry.keepBasePath === true]),
    [
      ['gameshelf-psprices', false],
      ['gameshelf-playstation-store', false],
      ['gameshelf-nintendo-eshop', false],
      ['gameshelf-hltb', false],
      ['gameshelf-metacritic', false],
      ['gameshelf-compat', true],
    ]
  );
});

/** Lookups answer with a match; pings go through Node's real fetch, recording what's logged. */
async function runWithRealPingFetch(params: {
  pingBaseUrl: string;
  probes: ScraperHealthProbe[];
  lookupFetch?: typeof fetch;
}): Promise<{ warnings: string }> {
  const warn = console.warn;
  const logged: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    await runScraperHealthChecks({
      pingKey: 'SECRET-PING-KEY',
      pingBaseUrl: params.pingBaseUrl,
      probes: params.probes,
      fetchImpl: (input, init) => {
        const url = toUrl(input);
        if (url.includes('SECRET-PING-KEY')) {
          return fetch(input, init);
        }
        return params.lookupFetch
          ? params.lookupFetch(input, init)
          : jsonResponse({ item: { title: 'x' } });
      },
    });
  } finally {
    console.warn = warn;
  }
  return { warnings: JSON.stringify(logged) };
}

void test('scraper health check keeps credentials and the ping key out of ping failure logs', async () => {
  for (const pingBaseUrl of ['https://user:hunter2@hc.example', 'hc-ping.example']) {
    const { warnings } = await runWithRealPingFetch({ pingBaseUrl, probes: [probe()] });
    assert.match(warnings, /ping_failed/, pingBaseUrl);
    assert.doesNotMatch(warnings, /SECRET-PING-KEY|hunter2|user:/, pingBaseUrl);
  }
  const { warnings } = await runWithRealPingFetch({
    pingBaseUrl: 'https://user:hunter2@hc.example',
    probes: [probe()],
  });
  assert.match(warnings, /URL includes credentials, which fetch rejects/);
});

void test('scraper health check keeps scraper URL credentials out of the ping body', async () => {
  const { fetchImpl, pings } = fakeFetch((url, init) => fetch(url, init));
  await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe({ baseUrl: 'http://user:hunter2@test-scraper:8000' })],
    fetchImpl,
  });
  const body = pings()[0]?.body ?? '';
  assert.match(body, /failed: URL includes credentials, which fetch rejects$/);
  assert.doesNotMatch(body, /hunter2|user:/);
});

void test('scraper health check reports only the error name for an unrecognised error', async () => {
  const { fetchImpl, pings } = fakeFetch(() =>
    Promise.reject(new RangeError('bad thing at https://user:hunter2@test-scraper/SECRET'))
  );
  await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe()],
    fetchImpl,
  });
  assert.match(pings()[0]?.body ?? '', /failed: RangeError$/);
});

void test('scraper health check reports a malformed base URL as invalid', async () => {
  const { fetchImpl, pings } = fakeFetch(() => jsonResponse({ item: {} }));
  await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    probes: [probe({ baseUrl: 'metacritic-scraper:8789' })],
    fetchImpl,
  });
  assert.match(pings()[0]?.body ?? '', /failed: invalid URL$/);
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
    if (isPing(toUrl(input))) {
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
      ['gameshelf-playstation-store', 'Hades II (PS5)', null],
      ['gameshelf-nintendo-eshop', 'Hades II (Switch)', null],
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

void test('scraper health probes reject the expected game without its data', () => {
  assert.deepEqual(
    probeVerdict('gameshelf-psprices', {
      item: { title: 'Hades II', amount: null, url: 'https://psprices.com/x' },
    }),
    {
      ok: false,
      reason:
        'matched the expected game without a price (title=Hades II, url=https://psprices.com/x)',
    }
  );
  assert.deepEqual(probeVerdict('gameshelf-hltb', { item: { hltbGameId: 62941 } }), {
    ok: false,
    reason: 'matched the expected game without a main-story time (hltbGameId=62941)',
  });
  assert.equal(
    probeVerdict('gameshelf-hltb', { item: { hltbGameId: 62941, hltbMainHours: 0 } }).ok,
    false
  );
  const metacritic = (metacriticScore: unknown) =>
    probeVerdict('gameshelf-metacritic', {
      item: { metacriticScore, metacriticUrl: 'https://www.metacritic.com/game/hades/' },
    });
  assert.deepEqual(metacritic(null), {
    ok: false,
    reason:
      'matched the expected game without a score (metacriticUrl=https://www.metacritic.com/game/hades/)',
  });
  for (const score of [0, 101, '93', Number.NaN]) {
    assert.equal(metacritic(score).ok, false, String(score));
  }
  assert.equal(metacritic(1).ok, true);
  assert.equal(metacritic(100).ok, true);
});

void test('scraper health psprices probe accepts a free price', () => {
  assert.equal(
    probeVerdict('gameshelf-psprices', { item: { title: 'Hades II', amount: 0 } }).ok,
    true
  );
  assert.equal(
    probeVerdict('gameshelf-psprices', { item: { title: 'Hades II', amount: -1 } }).ok,
    false
  );
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

void test('psprices probe looks up a Switch title, since PS4/PS5 use the PlayStation Store', () => {
  const entry = buildScraperHealthProbes().find((item) => item.slug === 'gameshelf-psprices');
  assert.equal(entry?.query['platform'], 'Switch');
});

void test('PlayStation Store probe accepts only the verified product with a price', () => {
  const hadesII = 'EP4484-PPSA36082_00-0912328937643383';
  assert.deepEqual(
    probeVerdict('gameshelf-playstation-store', {
      item: { productId: hadesII, title: 'Hades II', amount: 29.9 },
    }),
    { ok: true, detail: `matched (productId=${hadesII}, title=Hades II, amount=29.9)` }
  );
  assert.equal(
    probeVerdict('gameshelf-playstation-store', {
      item: { productId: 'EP4484-PPSA03711_00-3235764131417729', title: 'Hades', amount: 24.9 },
    }).ok,
    false
  );
  assert.deepEqual(
    probeVerdict('gameshelf-playstation-store', {
      item: { productId: hadesII, title: 'Hades II', amount: null },
    }),
    {
      ok: false,
      reason: `matched the expected game without a price (productId=${hadesII}, title=Hades II)`,
    }
  );
  assert.deepEqual(probeVerdict('gameshelf-playstation-store', { item: null }), {
    ok: false,
    reason: 'no match for a title that should always match',
  });
});

void test('Nintendo eShop probe accepts only the verified nsuid with a price', () => {
  assert.deepEqual(
    probeVerdict('gameshelf-nintendo-eshop', {
      item: { nsuid: '70010000060676', title: 'Hades II', amount: 32.5 },
    }),
    { ok: true, detail: 'matched (nsuid=70010000060676, title=Hades II, amount=32.5)' }
  );
  assert.equal(
    probeVerdict('gameshelf-nintendo-eshop', {
      item: { nsuid: '70010000033132', title: 'Hades', amount: 27 },
    }).ok,
    false
  );
  assert.deepEqual(
    probeVerdict('gameshelf-nintendo-eshop', {
      item: { nsuid: '70010000060676', title: 'Hades II', amount: null },
    }),
    {
      ok: false,
      reason: 'matched the expected game without a price (nsuid=70010000060676, title=Hades II)',
    }
  );
});

void test('a probe with run calls it instead of the scraper URL and pings the result', async () => {
  const { fetchImpl, requests, pings } = fakeFetch(() => jsonResponse({}));
  let runs = 0;
  const results = await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    fetchImpl,
    probes: [
      probe({
        path: 'Hades II (PS5)',
        run: () => {
          runs += 1;
          return Promise.resolve({ item: { title: 'Hades II' } });
        },
      }),
    ],
  });

  assert.equal(runs, 1);
  assert.equal(results[0].ok, true);
  assert.match(results[0].message, /^test-scraper lookup Hades II \(PS5\) matched in /);
  assert.equal(requests.length, 1, 'only the ping goes out');
  assert.equal(pings().length, 1);
});

void test('a run probe reports a rejected PlayStation Store query in plain words', async () => {
  const { fetchImpl, pings } = fakeFetch(() => jsonResponse({}));
  const rejected = new Error(
    'PlayStation Store rejected the getSearchResults query: Query 4df6 not whitelisted'
  );
  rejected.name = 'PlayStationStoreQueryRejectedError';
  const results = await runScraperHealthChecks({
    pingKey: PING_KEY,
    pingBaseUrl: PING_BASE_URL,
    fetchImpl,
    probes: [probe({ path: 'Hades II (PS5)', run: () => Promise.reject(rejected) })],
  });

  assert.equal(results[0].ok, false);
  assert.equal(
    results[0].message,
    'test-scraper lookup Hades II (PS5) failed: query not whitelisted: the PlayStation Store query hash needs updating'
  );
  assert.ok(pings()[0].url.endsWith('/gameshelf-test/fail?create=1'));
});
