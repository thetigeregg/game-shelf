import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { config } from './config.js';
import {
  buildNintendoEshopRefreshJob,
  lookupNintendoEshopPrice,
  processQueuedNintendoEshopPriceRevalidation,
  registerNintendoEshopPricesRoute,
  type NintendoEshopPriceRevalidationPayload,
} from './nintendo-eshop-prices.js';

// No request spacing in tests (each test file runs in its own process, before the limiter exists).
config.rateLimit.outbound.nintendo_eshop = { maxConcurrent: 10 };
config.nintendoEshopCountry = 'CH';
config.nintendoEshopLanguage = 'de';
// Override saves need the write token when auth is on; most tests run without it (see the auth
// test at the end).
config.requireAuth = false;

const HADES_II = '70010000060676';
const HADES_II_SWITCH_2 = '70010000106342';
const HADES_II_UPGRADE = '70050000062085';
const HADES = '70010000033132';
const UNRELEASED = '70010000134217';

class GamePoolMock {
  private readonly rows = new Map<string, Record<string, unknown>>();
  syncEvents = 0;

  seed(igdbGameId: string, platformIgdbId: number, payload: Record<string, unknown>): void {
    this.rows.set(`${igdbGameId}::${String(platformIgdbId)}`, payload);
  }

  getPayload(igdbGameId: string, platformIgdbId: number): Record<string, unknown> {
    const payload = this.rows.get(`${igdbGameId}::${String(platformIgdbId)}`);
    assert.ok(payload, 'expected a stored game');
    return payload;
  }

  query(
    sql: string,
    params: unknown[]
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    const key = `${String(params[0])}::${String(params[1])}`;

    if (normalized.startsWith('select payload from games where igdb_game_id = $1')) {
      const payload = this.rows.get(key);
      return Promise.resolve({ rows: payload ? [{ payload }] : [] });
    }
    if (normalized.startsWith('with current_row as ( select payload from games')) {
      const existing = this.rows.get(key) ?? {};
      const merged = { ...existing, ...(JSON.parse(String(params[2])) as Record<string, unknown>) };
      if (JSON.stringify(existing) === JSON.stringify(merged)) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      this.rows.set(key, merged);
      return Promise.resolve({
        rows: [{ previous_payload: existing, next_payload: merged }],
        rowCount: 1,
      });
    }
    if (normalized.startsWith('insert into sync_events')) {
      this.syncEvents += 1;
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    // Sale notifications read settings and device tokens; none are configured here.
    if (
      normalized.startsWith('select setting_key, setting_value from settings') ||
      normalized.startsWith('select token from fcm_tokens')
    ) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    throw new Error(`Unsupported SQL in GamePoolMock: ${sql}`);
  }
}

interface EshopGame {
  title: string;
  nsuids: string[];
  platforms: string[];
}

interface EshopPrice {
  regular: number;
  discount?: number;
  endsAt?: string;
}

/** A fake eShop: search results by (lowercased) term, prices by nsuid. */
function fakeEshop(params: {
  search?: Record<string, EshopGame[]>;
  prices?: Record<string, EshopPrice>;
  failWith?: number;
}) {
  const calls = { search: [] as string[], byNsuid: [] as string[], prices: [] as string[][] };
  const allGames = Object.values(params.search ?? {}).flat();
  const fetchImpl = (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (params.failWith) {
      return Promise.resolve(new Response('{}', { status: params.failWith }));
    }
    if (url.pathname.endsWith('/select')) {
      const fq = url.searchParams.get('fq') ?? '';
      const byNsuid = fq.match(/nsuid_txt:(\d+)/)?.[1];
      let games: EshopGame[];
      if (byNsuid) {
        calls.byNsuid.push(byNsuid);
        games = allGames.filter((game) => game.nsuids.includes(byNsuid));
      } else {
        const term = (url.searchParams.get('q') ?? '').replace(/\\(.)/g, '$1');
        calls.search.push(term);
        const platform = fq.match(/playable_on_txt:(\w+)/)?.[1] ?? '';
        games = (params.search?.[term] ?? []).filter((game) => game.platforms.includes(platform));
      }
      const docs = games.map((game) => ({
        title: game.title,
        nsuid_txt: game.nsuids,
        playable_on_txt: game.platforms,
        image_url_sq_s: `https://image.example/${game.nsuids.join('-')}.jpg`,
      }));
      return Promise.resolve(
        new Response(JSON.stringify({ response: { numFound: docs.length, docs } }), {
          status: 200,
        })
      );
    }
    const ids = (url.searchParams.get('ids') ?? '').split(',');
    calls.prices.push(ids);
    const prices = ids.map((id) => {
      const price = params.prices?.[id];
      if (!price) {
        return { title_id: Number(id), sales_status: 'unreleased' };
      }
      return {
        title_id: Number(id),
        sales_status: 'onsale',
        regular_price: { currency: 'CHF', raw_value: String(price.regular) },
        ...(price.discount !== undefined
          ? {
              discount_price: {
                currency: 'CHF',
                raw_value: String(price.discount),
                end_datetime: price.endsAt ?? '2026-11-25T22:59:59Z',
              },
            }
          : {}),
      };
    });
    return Promise.resolve(
      new Response(JSON.stringify({ personalized: false, country: 'CH', prices }), {
        status: 200,
      })
    );
  };
  const typedFetch: typeof fetch = fetchImpl;
  return { fetchImpl: typedFetch, calls };
}

const hadesSearch: EshopGame[] = [
  { title: 'Hades II', nsuids: [HADES_II], platforms: ['HAC'] },
  {
    title: 'Hades II – Nintendo Switch 2 Edition',
    nsuids: [HADES_II_UPGRADE, HADES_II_SWITCH_2],
    platforms: ['BEE'],
  },
  { title: 'Hades', nsuids: [HADES], platforms: ['HAC'] },
];
const hadesPrices: Record<string, EshopPrice> = {
  [HADES_II]: { regular: 32.5, discount: 22.75, endsAt: '2026-11-25T22:59:59Z' },
  [HADES_II_SWITCH_2]: { regular: 32.5 },
  [HADES_II_UPGRADE]: { regular: 0 },
  [HADES]: { regular: 27 },
};

async function buildApp(
  pool: GamePoolMock,
  fetchImpl: typeof fetch,
  extra: Parameters<typeof registerNintendoEshopPricesRoute>[2] = {}
) {
  const app = Fastify();
  await registerNintendoEshopPricesRoute(app, pool as unknown as Pool, {
    fetchImpl,
    enableStaleWhileRevalidate: true,
    freshTtlSeconds: 86400,
    staleTtlSeconds: 86400 * 90,
    ...extra,
  });
  return app;
}

function json(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

void test('Nintendo eShop route returns unsupported_platform for non-Nintendo platforms', async () => {
  const pool = new GamePoolMock();
  const eshop = fakeEshop({});
  const app = await buildApp(pool, eshop.fetchImpl);

  for (const platformIgdbId of [6, 48, 167]) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/nintendo-eshop/prices?igdbGameId=1&platformIgdbId=${String(platformIgdbId)}`,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(json(response.body)['status'], 'unsupported_platform');
  }
  assert.equal(eshop.calls.search.length + eshop.calls.prices.length, 0);
  await app.close();
});

void test('Nintendo eShop route validates the request', async () => {
  const pool = new GamePoolMock();
  const app = await buildApp(pool, fakeEshop({}).fetchImpl);

  const missing = await app.inject({ method: 'GET', url: '/v1/nintendo-eshop/prices' });
  assert.equal(missing.statusCode, 400);

  const badNsuid = await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=1&platformIgdbId=130&nsuid=nope',
  });
  assert.equal(badNsuid.statusCode, 400);

  const notFound = await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=1&platformIgdbId=130',
  });
  assert.equal(notFound.statusCode, 404);
  await app.close();
});

void test('Nintendo eShop route searches, prices every result in one request and saves the match', async () => {
  const pool = new GamePoolMock();
  pool.seed('1', 130, { title: 'Hades II', listType: 'wishlist' });
  const eshop = fakeEshop({ search: { 'hades ii': hadesSearch }, prices: hadesPrices });
  const app = await buildApp(pool, eshop.fetchImpl);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=1&platformIgdbId=130&includeCandidates=1',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-nintendo-eshop-cache'], 'MISS');
  const body = json(response.body);
  assert.equal(body['status'], 'ok');
  assert.equal(body['platform'], 'Switch');
  assert.deepEqual(body['bestPrice'], {
    title: 'Hades II',
    nsuid: HADES_II,
    amount: 22.75,
    currency: 'CHF',
    regularAmount: 32.5,
    discountPercent: 30,
    isFree: false,
    url: `https://ec.nintendo.com/CH/de/titles/${HADES_II}`,
    imageUrl: `https://image.example/${HADES_II}.jpg`,
    saleEndsAt: '2026-11-25T22:59:59.000Z',
  });
  assert.equal((body['match'] as Record<string, unknown>)['confidence'], 'high');
  // Only Switch games: the Switch 2 Edition is a different platform.
  assert.deepEqual(
    (body['candidates'] as Array<Record<string, unknown>>).map((candidate) => candidate['nsuid']),
    [HADES_II, HADES]
  );
  assert.deepEqual(eshop.calls.search, ['hades ii']);
  assert.deepEqual(eshop.calls.prices, [[HADES_II, HADES]]);

  const stored = pool.getPayload('1', 130);
  assert.equal(stored['priceSource'], 'nintendo_eshop');
  assert.equal(stored['priceAmount'], 22.75);
  assert.equal(stored['priceRegularAmount'], 32.5);
  assert.equal(stored['priceUrl'], `https://ec.nintendo.com/CH/de/titles/${HADES_II}`);
  assert.equal(stored['nintendoEshopNsuid'], HADES_II);
  assert.equal(stored['nintendoEshopTitle'], 'Hades II');
  assert.equal(stored['nintendoEshopPlatform'], 'Switch');
  assert.equal(stored['nintendoEshopCountry'], 'CH');
  assert.equal(stored['nintendoEshopSaleEndsAt'], '2026-11-25T22:59:59.000Z');
  assert.equal((stored['nintendoEshopCandidates'] as unknown[]).length, 2);
  assert.equal(stored['nintendoEshopMatchLocked'], undefined);
  assert.equal(pool.syncEvents, 1);
  await app.close();
});

void test('Nintendo eShop route prices a Switch 2 game from its Switch 2 Edition', async () => {
  const pool = new GamePoolMock();
  pool.seed('2', 508, { title: 'Hades II', listType: 'wishlist' });
  const eshop = fakeEshop({ search: { 'hades ii': hadesSearch }, prices: hadesPrices });
  const app = await buildApp(pool, eshop.fetchImpl);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=2&platformIgdbId=508',
  });

  const body = json(response.body);
  assert.equal(body['platform'], 'Switch 2');
  const bestPrice = body['bestPrice'] as Record<string, unknown>;
  // The edition itself, not its free upgrade pack.
  assert.equal(bestPrice['nsuid'], HADES_II_SWITCH_2);
  assert.equal(bestPrice['amount'], 32.5);
  assert.equal(pool.getPayload('2', 508)['priceSource'], 'nintendo_eshop');
  await app.close();
});

void test('Nintendo eShop route takes over a Switch game from psprices', async () => {
  const pool = new GamePoolMock();
  pool.seed('3', 130, {
    title: 'Hades II',
    listType: 'wishlist',
    priceSource: 'psprices',
    priceAmount: 31.9,
    psPricesUrl: 'https://psprices.com/region-ch/game/123/hades-ii',
    psPricesTitle: 'Hades II',
    psPricesPlatform: 'Switch',
    psPricesMatchLocked: true,
  });
  const eshop = fakeEshop({ search: { 'hades ii': hadesSearch }, prices: hadesPrices });
  const app = await buildApp(pool, eshop.fetchImpl);

  await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=3&platformIgdbId=130',
  });

  const stored = pool.getPayload('3', 130);
  assert.equal(stored['priceSource'], 'nintendo_eshop');
  assert.equal(stored['priceAmount'], 22.75);
  assert.equal(stored['psPricesUrl'], null);
  assert.equal(stored['psPricesTitle'], null);
  assert.equal(stored['psPricesPlatform'], null);
  assert.equal(stored['psPricesMatchLocked'], null);
  await app.close();
});

void test('a matched game not for sale in the country is not saved as a price', async () => {
  const pool = new GamePoolMock();
  pool.seed('4', 130, { title: 'Future Game', listType: 'wishlist' });
  const eshop = fakeEshop({
    search: {
      'future game': [{ title: 'Future Game', nsuids: [UNRELEASED], platforms: ['HAC'] }],
    },
    prices: {},
  });
  const app = await buildApp(pool, eshop.fetchImpl);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=4&platformIgdbId=130&includeCandidates=1',
  });

  const body = json(response.body);
  assert.equal(body['status'], 'unavailable');
  assert.equal(body['bestPrice'], null);
  assert.equal((body['match'] as Record<string, unknown>)['confidence'], 'low');
  // The picker only offers games with a price.
  assert.deepEqual(body['candidates'], []);
  const stored = pool.getPayload('4', 130);
  assert.equal(stored['priceSource'], undefined);
  assert.equal(stored['nintendoEshopNsuid'], undefined);
  await app.close();
});

void test('Nintendo eShop route prices a pinned nsuid directly, reusing its saved title', async () => {
  const pool = new GamePoolMock();
  pool.seed('5', 130, {
    title: 'Hades 2',
    nintendoEshopNsuid: HADES_II,
    nintendoEshopTitle: 'Hades II',
  });
  const eshop = fakeEshop({ search: { 'hades ii': hadesSearch }, prices: hadesPrices });
  const app = await buildApp(pool, eshop.fetchImpl);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=5&platformIgdbId=130',
  });

  const bestPrice = json(response.body)['bestPrice'] as Record<string, unknown>;
  assert.equal(bestPrice['amount'], 22.75);
  assert.equal(bestPrice['title'], 'Hades II');
  assert.deepEqual(eshop.calls, { search: [], byNsuid: [], prices: [[HADES_II]] });
  await app.close();
});

void test('Nintendo eShop route searches again when a pinned nsuid is no longer sold', async () => {
  const pool = new GamePoolMock();
  pool.seed('6', 130, { title: 'Hades II', nintendoEshopNsuid: UNRELEASED });
  const eshop = fakeEshop({ search: { 'hades ii': hadesSearch }, prices: hadesPrices });
  const app = await buildApp(pool, eshop.fetchImpl);

  await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=6&platformIgdbId=130',
  });

  assert.deepEqual(eshop.calls.search, ['hades ii']);
  assert.equal(pool.getPayload('6', 130)['nintendoEshopNsuid'], HADES_II);
  await app.close();
});

void test('an nsuid override looks up its title, pins it and locks the match', async () => {
  const pool = new GamePoolMock();
  pool.seed('7', 130, { title: 'Something Else' });
  const eshop = fakeEshop({ search: { 'hades ii': hadesSearch }, prices: hadesPrices });
  const app = await buildApp(pool, eshop.fetchImpl);

  const link = encodeURIComponent(`https://ec.nintendo.com/CH/de/titles/${HADES}`);
  const response = await app.inject({
    method: 'GET',
    url: `/v1/nintendo-eshop/prices?igdbGameId=7&platformIgdbId=130&nsuid=${link}`,
  });

  assert.equal(json(response.body)['status'], 'ok');
  assert.deepEqual(eshop.calls.byNsuid, [HADES]);
  const stored = pool.getPayload('7', 130);
  assert.equal(stored['nintendoEshopNsuid'], HADES);
  assert.equal(stored['nintendoEshopTitle'], 'Hades');
  assert.equal(stored['priceAmount'], 27);
  assert.equal(stored['nintendoEshopMatchLocked'], true);
  await app.close();
});

void test('a title override skips the cache and locks the match; one that finds nothing does not', async () => {
  const pool = new GamePoolMock();
  pool.seed('8', 130, {
    title: 'Hades 2',
    nintendoEshopFetchedAt: new Date().toISOString(),
    nintendoEshopCountry: 'CH',
    nintendoEshopLanguage: 'de',
    nintendoEshopPlatform: 'Switch',
    nintendoEshopPriceAmount: 1,
  });
  const eshop = fakeEshop({ search: { 'hades ii': hadesSearch }, prices: hadesPrices });
  const app = await buildApp(pool, eshop.fetchImpl);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=8&platformIgdbId=130&title=Hades%20II',
  });
  assert.equal(response.headers['x-gameshelf-nintendo-eshop-cache'], 'MISS');
  assert.equal(pool.getPayload('8', 130)['nintendoEshopMatchLocked'], true);
  assert.equal(pool.getPayload('8', 130)['nintendoEshopMatchQueryTitle'], 'Hades II');

  pool.seed('9', 130, { title: 'Hades II' });
  await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=9&platformIgdbId=130&title=No%20Such%20Game',
  });
  assert.equal(pool.getPayload('9', 130)['nintendoEshopMatchLocked'], undefined);
  await app.close();
});

function cachedPayload(fetchedAt: string): Record<string, unknown> {
  return {
    title: 'Hades II',
    nintendoEshopFetchedAt: fetchedAt,
    nintendoEshopCountry: 'CH',
    nintendoEshopLanguage: 'de',
    nintendoEshopPlatform: 'Switch',
    nintendoEshopNsuid: HADES_II,
    nintendoEshopTitle: 'Hades II',
    nintendoEshopPriceAmount: 32.5,
    nintendoEshopPriceCurrency: 'CHF',
    nintendoEshopRegularPriceAmount: 32.5,
    nintendoEshopDiscountPercent: 0,
    nintendoEshopIsFree: false,
    nintendoEshopUrl: `https://ec.nintendo.com/CH/de/titles/${HADES_II}`,
    nintendoEshopMatchQueryTitle: 'Hades II',
    nintendoEshopMatchTitle: 'Hades II',
    nintendoEshopMatchScore: 100,
    nintendoEshopMatchConfidence: 'high',
    nintendoEshopCandidates: [
      { title: 'Hades II', nsuid: HADES_II, amount: 32.5, isFree: false, score: 100 },
    ],
  };
}

void test('Nintendo eShop route serves a fresh cached price without calling the eShop', async () => {
  const pool = new GamePoolMock();
  pool.seed('10', 130, cachedPayload('2026-03-10T11:00:00.000Z'));
  const eshop = fakeEshop({});
  const app = await buildApp(pool, eshop.fetchImpl, {
    nowProvider: () => Date.parse('2026-03-10T12:00:00.000Z'),
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=10&platformIgdbId=130&includeCandidates=1',
  });

  assert.equal(response.headers['x-gameshelf-nintendo-eshop-cache'], 'HIT_FRESH');
  const body = json(response.body);
  assert.equal((body['bestPrice'] as Record<string, unknown>)['amount'], 32.5);
  assert.equal((body['candidates'] as unknown[]).length, 1);
  assert.equal(eshop.calls.search.length + eshop.calls.prices.length, 0);
  await app.close();
});

void test('Nintendo eShop route ignores a cached price from another country', async () => {
  const pool = new GamePoolMock();
  pool.seed('11', 130, { ...cachedPayload(new Date().toISOString()), nintendoEshopCountry: 'DE' });
  const eshop = fakeEshop({ search: { 'hades ii': hadesSearch }, prices: hadesPrices });
  const app = await buildApp(pool, eshop.fetchImpl);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=11&platformIgdbId=130',
  });

  assert.equal(response.headers['x-gameshelf-nintendo-eshop-cache'], 'MISS');
  await app.close();
});

void test('Nintendo eShop route serves a stale price and queues a refresh', async () => {
  const pool = new GamePoolMock();
  pool.seed('12', 130, cachedPayload('2026-03-01T12:00:00.000Z'));
  const eshop = fakeEshop({});
  const queued: NintendoEshopPriceRevalidationPayload[] = [];
  const app = await buildApp(pool, eshop.fetchImpl, {
    nowProvider: () => Date.parse('2026-03-10T12:00:00.000Z'),
    enqueueRevalidationJob: (payload) => {
      queued.push(payload);
    },
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=12&platformIgdbId=130',
  });

  assert.equal(response.headers['x-gameshelf-nintendo-eshop-cache'], 'HIT_STALE');
  assert.equal(response.headers['x-gameshelf-nintendo-eshop-revalidate'], 'scheduled');
  assert.deepEqual(queued, [
    {
      cacheKey: '12:130:ch:de:switch',
      igdbGameId: '12',
      platformIgdbId: 130,
      title: 'Hades II',
      nsuid: HADES_II,
    },
  ]);
  await app.close();
});

void test('Nintendo eShop route reports an eShop failure as an upstream error without saving', async () => {
  const pool = new GamePoolMock();
  pool.seed('13', 130, { title: 'Hades II', priceSource: 'psprices', priceAmount: 31.9 });
  const app = await buildApp(pool, fakeEshop({ failWith: 503 }).fetchImpl);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=13&platformIgdbId=130',
  });

  assert.equal(response.statusCode, 502);
  assert.equal(pool.getPayload('13', 130)['priceAmount'], 31.9);
  await app.close();
});

void test('Nintendo eShop picker search returns candidates without saving anything', async () => {
  const pool = new GamePoolMock();
  pool.seed('14', 130, {
    title: 'Hades II',
    nintendoEshopNsuid: HADES,
    priceSource: 'nintendo_eshop',
    priceAmount: 27,
  });
  const eshop = fakeEshop({ search: { 'hades ii': hadesSearch }, prices: hadesPrices });
  const app = await buildApp(pool, eshop.fetchImpl);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=14&platformIgdbId=130&title=Hades%20II&includeCandidates=1',
  });

  assert.equal((json(response.body)['candidates'] as unknown[]).length, 2);
  const stored = pool.getPayload('14', 130);
  assert.equal(stored['nintendoEshopNsuid'], HADES);
  assert.equal(stored['priceAmount'], 27);
  assert.equal(pool.syncEvents, 0);
  await app.close();
});

void test('Nintendo eShop lookup without a match clears its stale price and a psprices leftover', async () => {
  const pool = new GamePoolMock();
  pool.seed('15', 130, {
    ...cachedPayload('2026-01-01T00:00:00.000Z'),
    nintendoEshopNsuid: UNRELEASED,
    priceSource: 'nintendo_eshop',
    priceAmount: 32.5,
  });
  pool.seed('16', 508, {
    title: 'Obscure Game',
    listType: 'wishlist',
    priceSource: 'psprices',
    priceAmount: 9.9,
    psPricesUrl: 'https://psprices.com/region-ch/game/1/obscure',
  });
  const eshop = fakeEshop({ search: {}, prices: {} });
  const app = await buildApp(pool, eshop.fetchImpl, { enableStaleWhileRevalidate: false });

  await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=15&platformIgdbId=130',
  });
  const kept = pool.getPayload('15', 130);
  assert.equal(kept['nintendoEshopPriceAmount'], null);
  assert.equal(kept['nintendoEshopNsuid'], UNRELEASED, 'the pin stays');
  assert.equal(kept['priceAmount'], 32.5, 'a price this source saved is kept through a miss');

  await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=16&platformIgdbId=508',
  });
  const cleared = pool.getPayload('16', 508);
  assert.equal(cleared['priceSource'], null);
  assert.equal(cleared['priceAmount'], null);
  assert.equal(cleared['psPricesUrl'], null);
  assert.equal(cleared['nintendoEshopMatchConfidence'], 'none');
  await app.close();
});

void test('a manual Nintendo eShop price without an nsuid is served as saved and not refreshed', async () => {
  const pool = new GamePoolMock();
  pool.seed('17', 130, {
    ...cachedPayload('2026-01-01T00:00:00.000Z'),
    nintendoEshopNsuid: null,
    nintendoEshopPriceAmount: 12.5,
    nintendoEshopMatchLocked: true,
  });
  const eshop = fakeEshop({ search: { 'hades ii': hadesSearch }, prices: hadesPrices });
  const app = await buildApp(pool, eshop.fetchImpl);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices?igdbGameId=17&platformIgdbId=130',
  });
  assert.equal(response.headers['x-gameshelf-nintendo-eshop-cache'], 'LOCKED');
  assert.equal((json(response.body)['bestPrice'] as Record<string, unknown>)['amount'], 12.5);

  await processQueuedNintendoEshopPriceRevalidation(
    pool as unknown as Pool,
    { cacheKey: 'k', igdbGameId: '17', platformIgdbId: 130, title: 'Hades II' },
    { fetchImpl: eshop.fetchImpl }
  );
  assert.equal(eshop.calls.search.length + eshop.calls.prices.length, 0);
  await app.close();
});

void test('queued Nintendo eShop refresh prices the game and tracks discovery retries', async () => {
  const pool = new GamePoolMock();
  pool.seed('18', 130, { title: 'Hades II', listType: 'discovery' });
  const eshop = fakeEshop({ search: {} });

  await processQueuedNintendoEshopPriceRevalidation(
    pool as unknown as Pool,
    { cacheKey: 'k', igdbGameId: '18', platformIgdbId: 130, title: 'Hades II', nsuid: '' },
    { fetchImpl: eshop.fetchImpl }
  );

  const stored = pool.getPayload('18', 130);
  assert.equal(stored['nintendoEshopMatchConfidence'], 'none');
  const retry = (stored['enrichmentRetry'] as Record<string, Record<string, unknown>>)[
    'nintendoEshop'
  ];
  assert.equal(retry['attempts'], 1);
  assert.equal(pool.syncEvents, 0);
});

void test('queued Nintendo eShop refresh uses the current pin and rejects other platforms', async () => {
  const pool = new GamePoolMock();
  // Queued with Hades pinned; an admin has since pinned Hades II.
  pool.seed('19', 130, {
    title: 'Hades II',
    nintendoEshopNsuid: HADES_II,
    nintendoEshopTitle: 'Hades II',
  });
  const eshop = fakeEshop({ prices: hadesPrices });

  await processQueuedNintendoEshopPriceRevalidation(
    pool as unknown as Pool,
    { cacheKey: 'k', igdbGameId: '19', platformIgdbId: 130, title: 'Hades', nsuid: HADES },
    { fetchImpl: eshop.fetchImpl }
  );
  assert.deepEqual(eshop.calls.prices, [[HADES_II]]);

  await assert.rejects(
    processQueuedNintendoEshopPriceRevalidation(
      pool as unknown as Pool,
      { cacheKey: 'k', igdbGameId: '1', platformIgdbId: 167 },
      { fetchImpl: eshop.fetchImpl }
    ),
    { message: 'Unsupported Nintendo eShop platform for revalidation.' }
  );
  await assert.rejects(
    processQueuedNintendoEshopPriceRevalidation(
      pool as unknown as Pool,
      { cacheKey: 'k', igdbGameId: 'missing', platformIgdbId: 130 },
      { fetchImpl: eshop.fetchImpl }
    ),
    { message: 'Nintendo eShop revalidation game row not found.' }
  );
});

void test('buildNintendoEshopRefreshJob enqueues Switch games and skips the rest', () => {
  const nowMs = Date.parse('2026-03-10T10:00:00.000Z');
  assert.deepEqual(
    buildNintendoEshopRefreshJob({
      igdbGameId: '1',
      platformIgdbId: 508,
      payload: {
        title: 'Hades 2',
        nintendoEshopMatchQueryTitle: 'Hades II',
        nintendoEshopNsuid: HADES_II,
      },
      dedupePrefix: 'pricing-refresh:wishlist',
      nowMs,
    }),
    {
      kind: 'enqueue',
      dedupeKey: 'pricing-refresh:wishlist:nintendo-eshop:1:508:ch:de',
      payload: {
        cacheKey: 'pricing-refresh:wishlist:1:508:ch:de',
        igdbGameId: '1',
        platformIgdbId: 508,
        title: 'Hades II',
        nsuid: HADES_II,
      },
    }
  );

  const build = (platformIgdbId: number, payload: Record<string, unknown>) =>
    buildNintendoEshopRefreshJob({
      igdbGameId: '2',
      platformIgdbId,
      payload,
      dedupePrefix: 'p',
      nowMs,
    });
  assert.deepEqual(build(167, { title: 'PS Game' }), {
    kind: 'skip',
    reason: 'unsupported-platform',
  });
  assert.deepEqual(build(130, {}), { kind: 'skip', reason: 'missing-data' });
  assert.deepEqual(
    build(130, { title: 'Manual', nintendoEshopMatchLocked: true, nintendoEshopPriceAmount: 12 }),
    { kind: 'skip', reason: 'manual-price' }
  );
  assert.equal(
    build(130, { title: 'Pinned', nintendoEshopMatchLocked: true, nintendoEshopNsuid: HADES }).kind,
    'enqueue'
  );
  assert.deepEqual(
    build(130, {
      title: 'Backed Off',
      listType: 'discovery',
      enrichmentRetry: {
        nintendoEshop: {
          attempts: 6,
          lastTriedAt: '2026-03-10T09:00:00.000Z',
          nextTryAt: null,
          permanentMiss: true,
        },
      },
    }),
    { kind: 'skip', reason: 'backoff' }
  );
});

void test('lookupNintendoEshopPrice rejects a platform the eShop index has no code for', async () => {
  await assert.rejects(
    lookupNintendoEshopPrice({
      title: 'Hades',
      platform: 'PS5',
      preferredNsuid: null,
      locale: { country: 'CH', language: 'de' },
      fetchImpl: fakeEshop({}).fetchImpl,
    }),
    /Unsupported Nintendo eShop platform/
  );
});

void test('saving a Nintendo eShop override needs the write token when auth is required', async () => {
  const pool = new GamePoolMock();
  pool.seed('40', 130, { title: 'Something Else' });
  const eshop = fakeEshop({ search: { 'hades ii': hadesSearch }, prices: hadesPrices });
  const app = await buildApp(pool, eshop.fetchImpl);
  const original = { requireAuth: config.requireAuth, clientWriteTokens: config.clientWriteTokens };
  config.requireAuth = true;
  config.clientWriteTokens = ['device-token-1'];
  const url = `/v1/nintendo-eshop/prices?igdbGameId=40&platformIgdbId=130&nsuid=${HADES_II}`;

  try {
    const anonymous = await app.inject({ method: 'GET', url });
    assert.equal(anonymous.statusCode, 401);
    assert.equal(pool.getPayload('40', 130)['nintendoEshopNsuid'], undefined);

    const pickerSearch = await app.inject({
      method: 'GET',
      url: '/v1/nintendo-eshop/prices?igdbGameId=40&platformIgdbId=130&title=Hades%20II&includeCandidates=1',
    });
    assert.equal(pickerSearch.statusCode, 200);

    const authorized = await app.inject({
      method: 'GET',
      url,
      headers: { 'x-game-shelf-client-token': 'device-token-1' },
    });
    assert.equal(authorized.statusCode, 200);
    assert.equal(pool.getPayload('40', 130)['nintendoEshopNsuid'], HADES_II);
    assert.equal(pool.getPayload('40', 130)['nintendoEshopMatchLocked'], true);
  } finally {
    config.requireAuth = original.requireAuth;
    config.clientWriteTokens = original.clientWriteTokens;
    await app.close();
  }
});
