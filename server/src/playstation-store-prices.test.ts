import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { config } from './config.js';
import {
  processQueuedPlayStationStorePriceRevalidation,
  registerPlayStationStorePricesRoute,
  type PlayStationStorePriceRevalidationPayload,
} from './playstation-store-prices.js';

// No request spacing in tests (each test file runs in its own process, before the limiter exists).
config.rateLimit.outbound.playstation_store = { maxConcurrent: 10 };
config.playstationStoreCountry = 'CH';
config.playstationStoreLanguage = 'de';

const HADES_II = 'EP4484-PPSA36082_00-0912328937643383';
const HADES = 'EP4484-PPSA03711_00-3235764131417729';
const ASTRO_BOT = 'EP9000-PPSA21567_00-0000000000000000';

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

interface StoreProduct {
  id: string;
  name: string;
  platforms: string[];
  classification: string;
  basePrice: string;
  discountedPrice: string;
  isFree?: boolean;
}

/** A fake PlayStation Store: search results by term, exact prices by product ID. */
function fakeStore(params: {
  search?: Record<string, StoreProduct[]>;
  prices?: Record<string, { base: number; current: number; endTime?: string | null } | null>;
  failWith?: { status: number; body: unknown };
}) {
  const calls = { search: [] as string[], product: [] as string[] };
  const fetchImpl = (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (params.failWith) {
      return Promise.resolve(
        new Response(JSON.stringify(params.failWith.body), { status: params.failWith.status })
      );
    }
    const variables = JSON.parse(url.searchParams.get('variables') ?? '{}') as Record<
      string,
      string
    >;
    if (url.searchParams.get('operationName') === 'getSearchResults') {
      calls.search.push(variables['searchTerm']);
      const results = (params.search?.[variables['searchTerm']] ?? []).map((product) => ({
        __typename: 'Product',
        id: product.id,
        name: product.name,
        platforms: product.platforms,
        storeDisplayClassification: product.classification,
        price: {
          basePrice: product.basePrice,
          discountedPrice: product.discountedPrice,
          discountText: null,
          isFree: product.isFree === true,
        },
        media: [{ role: 'MASTER', type: 'IMAGE', url: `https://image.example/${product.id}.png` }],
      }));
      return Promise.resolve(
        new Response(JSON.stringify({ data: { universalSearch: { results } } }), { status: 200 })
      );
    }
    const productId = variables['productId'];
    calls.product.push(productId);
    const price = params.prices?.[productId];
    if (!price) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: 'Product not available',
                extensions: { error: { reason: 'data_not_found' } },
              },
            ],
            data: { productRetrieve: null },
          }),
          { status: 200 }
        )
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: {
            productRetrieve: {
              id: productId,
              name: params.search
                ? Object.values(params.search)
                    .flat()
                    .find((product) => product.id === productId)?.name
                : 'Pinned Game',
              webctas: [
                {
                  type: 'ADD_TO_CART',
                  price: {
                    basePriceValue: price.base,
                    discountedValue: price.current,
                    currencyCode: 'CHF',
                    isFree: price.current === 0,
                    applicability: 'APPLICABLE',
                    serviceBranding: ['NONE'],
                    isTiedToSubscription: false,
                    endTime: price.endTime ?? null,
                  },
                },
              ],
            },
          },
        }),
        { status: 200 }
      )
    );
  };
  const typedFetch: typeof fetch = fetchImpl;
  return { fetchImpl: typedFetch, calls };
}

const hadesSearch: StoreProduct[] = [
  {
    id: HADES_II,
    name: 'Hades II',
    platforms: ['PS5'],
    classification: 'FULL_GAME',
    basePrice: 'CHF 29.90',
    discountedPrice: 'CHF 29.90',
  },
  {
    id: HADES,
    name: 'Hades',
    platforms: ['PS4', 'PS5'],
    classification: 'FULL_GAME',
    basePrice: 'CHF 24.90',
    discountedPrice: 'CHF 24.90',
  },
  {
    id: 'EP4108-CUSA12641_00-MO3DLC0SCOS04200',
    name: 'Hades II Soundtrack',
    platforms: ['PS5'],
    classification: 'ADD_ON_PACK',
    basePrice: 'CHF 9.90',
    discountedPrice: 'CHF 9.90',
  },
];

async function buildApp(
  pool: GamePoolMock,
  fetchImpl: typeof fetch,
  extra: Parameters<typeof registerPlayStationStorePricesRoute>[2] = {}
) {
  const app = Fastify();
  await registerPlayStationStorePricesRoute(app, pool as unknown as Pool, {
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

void test('PlayStation Store route returns unsupported_platform for non-PlayStation platforms', async () => {
  const pool = new GamePoolMock();
  const store = fakeStore({});
  const app = await buildApp(pool, store.fetchImpl);

  for (const platformIgdbId of [6, 130, 508]) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/playstation-store/prices?igdbGameId=1&platformIgdbId=${String(platformIgdbId)}`,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(json(response.body)['status'], 'unsupported_platform');
  }
  assert.equal(store.calls.search.length + store.calls.product.length, 0);
  await app.close();
});

void test('PlayStation Store route validates the request', async () => {
  const pool = new GamePoolMock();
  const app = await buildApp(pool, fakeStore({}).fetchImpl);

  const missing = await app.inject({ method: 'GET', url: '/v1/playstation-store/prices' });
  assert.equal(missing.statusCode, 400);

  const badProduct = await app.inject({
    method: 'GET',
    url: '/v1/playstation-store/prices?igdbGameId=1&platformIgdbId=167&productId=nope',
  });
  assert.equal(badProduct.statusCode, 400);

  const notFound = await app.inject({
    method: 'GET',
    url: '/v1/playstation-store/prices?igdbGameId=1&platformIgdbId=167',
  });
  assert.equal(notFound.statusCode, 404);
  await app.close();
});

void test('PlayStation Store route searches, matches and saves the exact price', async () => {
  const pool = new GamePoolMock();
  pool.seed('1', 167, { title: 'Hades II', listType: 'wishlist' });
  const store = fakeStore({
    search: { 'Hades II': hadesSearch },
    prices: { [HADES_II]: { base: 2990, current: 2093, endTime: '1795219140000' } },
  });
  const app = await buildApp(pool, store.fetchImpl);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/playstation-store/prices?igdbGameId=1&platformIgdbId=167&includeCandidates=1',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-playstation-store-cache'], 'MISS');
  const body = json(response.body);
  assert.equal(body['status'], 'ok');
  assert.equal(body['platform'], 'PS5');
  assert.deepEqual(body['bestPrice'], {
    title: 'Hades II',
    productId: HADES_II,
    amount: 20.93,
    currency: 'CHF',
    regularAmount: 29.9,
    discountPercent: 30,
    isFree: false,
    url: `https://store.playstation.com/de-ch/product/${HADES_II}`,
    imageUrl: `https://image.example/${HADES_II}.png`,
    saleEndsAt: '2026-11-20T23:59:00.000Z',
  });
  assert.equal((body['match'] as Record<string, unknown>)['confidence'], 'high');
  // The add-on is filtered out; Hades is a weaker match.
  const candidates = body['candidates'] as Array<Record<string, unknown>>;
  assert.deepEqual(
    candidates.map((candidate) => candidate['productId']),
    [HADES_II, HADES]
  );
  assert.deepEqual(store.calls, { search: ['Hades II'], product: [HADES_II] });

  const stored = pool.getPayload('1', 167);
  assert.equal(stored['priceSource'], 'playstation_store');
  assert.equal(stored['priceAmount'], 20.93);
  assert.equal(stored['priceRegularAmount'], 29.9);
  assert.equal(stored['priceDiscountPercent'], 30);
  assert.equal(stored['priceUrl'], `https://store.playstation.com/de-ch/product/${HADES_II}`);
  assert.equal(stored['playstationStoreProductId'], HADES_II);
  assert.equal(stored['playstationStorePlatform'], 'PS5');
  assert.equal(stored['playstationStoreCountry'], 'CH');
  assert.equal(stored['playstationStoreLanguage'], 'de');
  assert.equal(stored['playstationStoreSaleEndsAt'], '2026-11-20T23:59:00.000Z');
  assert.equal(stored['playstationStoreMatchQueryTitle'], 'Hades II');
  assert.equal((stored['playstationStoreCandidates'] as unknown[]).length, 2);
  assert.equal(stored['playstationStoreMatchLocked'], undefined);
  assert.equal(pool.syncEvents, 1);
  await app.close();
});

void test('PlayStation Store route takes over a PS game from psprices', async () => {
  const pool = new GamePoolMock();
  pool.seed('1', 167, {
    title: 'Hades II',
    listType: 'wishlist',
    priceSource: 'psprices',
    priceAmount: 31.9,
    psPricesUrl: 'https://psprices.com/region-ch/game/123/hades-ii',
    psPricesTitle: 'Hades II',
    psPricesPlatform: 'PS5',
    psPricesMatchLocked: true,
  });
  const store = fakeStore({
    search: { 'Hades II': hadesSearch },
    prices: { [HADES_II]: { base: 2990, current: 2990 } },
  });
  const app = await buildApp(pool, store.fetchImpl);

  await app.inject({
    method: 'GET',
    url: '/v1/playstation-store/prices?igdbGameId=1&platformIgdbId=167',
  });

  const stored = pool.getPayload('1', 167);
  assert.equal(stored['priceSource'], 'playstation_store');
  assert.equal(stored['priceAmount'], 29.9);
  assert.equal(stored['psPricesUrl'], null);
  assert.equal(stored['psPricesTitle'], null);
  assert.equal(stored['psPricesPlatform'], null);
  assert.equal(stored['psPricesMatchLocked'], null);
  await app.close();
});

void test('PlayStation Store route only keeps products for the game platform', async () => {
  const pool = new GamePoolMock();
  pool.seed('2', 48, { title: 'Hades II' });
  const store = fakeStore({ search: { 'Hades II': hadesSearch } });
  const app = await buildApp(pool, store.fetchImpl);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/playstation-store/prices?igdbGameId=2&platformIgdbId=48&includeCandidates=1',
  });

  const body = json(response.body);
  // Hades II is PS5-only; on PS4 only Hades (PS4/PS5) is a candidate, and it isn't the game.
  assert.equal(body['status'], 'unavailable');
  assert.equal(body['bestPrice'], null);
  assert.deepEqual(
    (body['candidates'] as Array<Record<string, unknown>>).map((c) => c['productId']),
    [HADES]
  );
  assert.equal(store.calls.product.length, 0, 'no price lookup without a confident match');
  const stored = pool.getPayload('2', 48);
  assert.equal(stored['priceSource'], undefined);
  assert.equal(stored['playstationStoreMatchConfidence'], 'low');
  await app.close();
});

void test('PlayStation Store route prices a pinned product directly', async () => {
  const pool = new GamePoolMock();
  pool.seed('3', 167, { title: 'Astro Bot', playstationStoreProductId: ASTRO_BOT });
  const store = fakeStore({ prices: { [ASTRO_BOT]: { base: 6990, current: 4962 } } });
  const app = await buildApp(pool, store.fetchImpl);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/playstation-store/prices?igdbGameId=3&platformIgdbId=167',
  });

  const body = json(response.body);
  assert.equal(body['status'], 'ok');
  assert.equal((body['bestPrice'] as Record<string, unknown>)['amount'], 49.62);
  assert.deepEqual(store.calls, { search: [], product: [ASTRO_BOT] });
  assert.equal(pool.getPayload('3', 167)['priceAmount'], 49.62);
  await app.close();
});

void test('PlayStation Store route searches again when a pinned product is no longer sold', async () => {
  const pool = new GamePoolMock();
  pool.seed('4', 167, { title: 'Hades II', playstationStoreProductId: ASTRO_BOT });
  const store = fakeStore({
    search: { 'Hades II': hadesSearch },
    prices: { [HADES_II]: { base: 2990, current: 2990 } },
  });
  const app = await buildApp(pool, store.fetchImpl);

  await app.inject({
    method: 'GET',
    url: '/v1/playstation-store/prices?igdbGameId=4&platformIgdbId=167',
  });

  assert.deepEqual(store.calls, { search: ['Hades II'], product: [ASTRO_BOT, HADES_II] });
  assert.equal(pool.getPayload('4', 167)['playstationStoreProductId'], HADES_II);
  await app.close();
});

void test('PlayStation Store route skips the cache and locks the match for a title override', async () => {
  const pool = new GamePoolMock();
  pool.seed('5', 167, {
    title: 'Hades 2',
    playstationStoreFetchedAt: new Date().toISOString(),
    playstationStoreCountry: 'CH',
    playstationStoreLanguage: 'de',
    playstationStorePlatform: 'PS5',
    playstationStorePriceAmount: 1,
  });
  const store = fakeStore({
    search: { 'Hades II': hadesSearch },
    prices: { [HADES_II]: { base: 2990, current: 2990 } },
  });
  const app = await buildApp(pool, store.fetchImpl);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/playstation-store/prices?igdbGameId=5&platformIgdbId=167&title=Hades%20II',
  });

  assert.equal(response.headers['x-gameshelf-playstation-store-cache'], 'MISS');
  const stored = pool.getPayload('5', 167);
  assert.equal(stored['playstationStoreMatchLocked'], true);
  assert.equal(stored['playstationStoreMatchQueryTitle'], 'Hades II');
  assert.equal(stored['priceAmount'], 29.9);
  await app.close();
});

void test('PlayStation Store route accepts a product URL override', async () => {
  const pool = new GamePoolMock();
  pool.seed('6', 167, { title: 'Something Else' });
  const store = fakeStore({ prices: { [ASTRO_BOT]: { base: 6990, current: 6990 } } });
  const app = await buildApp(pool, store.fetchImpl);

  const productUrl = encodeURIComponent(`https://store.playstation.com/de-ch/product/${ASTRO_BOT}`);
  const response = await app.inject({
    method: 'GET',
    url: `/v1/playstation-store/prices?igdbGameId=6&platformIgdbId=167&productId=${productUrl}`,
  });

  assert.equal(json(response.body)['status'], 'ok');
  const stored = pool.getPayload('6', 167);
  assert.equal(stored['playstationStoreProductId'], ASTRO_BOT);
  assert.equal(stored['playstationStoreMatchLocked'], true);
  await app.close();
});

function cachedPayload(fetchedAt: string): Record<string, unknown> {
  return {
    title: 'Hades II',
    playstationStoreFetchedAt: fetchedAt,
    playstationStoreCountry: 'CH',
    playstationStoreLanguage: 'de',
    playstationStorePlatform: 'PS5',
    playstationStoreProductId: HADES_II,
    playstationStoreTitle: 'Hades II',
    playstationStorePriceAmount: 29.9,
    playstationStorePriceCurrency: 'CHF',
    playstationStoreRegularPriceAmount: 29.9,
    playstationStoreDiscountPercent: 0,
    playstationStoreIsFree: false,
    playstationStoreUrl: `https://store.playstation.com/de-ch/product/${HADES_II}`,
    playstationStoreMatchQueryTitle: 'Hades II',
    playstationStoreMatchTitle: 'Hades II',
    playstationStoreMatchScore: 100,
    playstationStoreMatchConfidence: 'high',
    playstationStoreCandidates: [
      { title: 'Hades II', productId: HADES_II, amount: 29.9, isFree: false, score: 100 },
    ],
  };
}

void test('PlayStation Store route serves a fresh cached price without calling the store', async () => {
  const pool = new GamePoolMock();
  pool.seed('7', 167, cachedPayload('2026-03-10T11:00:00.000Z'));
  const store = fakeStore({});
  const app = await buildApp(pool, store.fetchImpl, {
    nowProvider: () => Date.parse('2026-03-10T12:00:00.000Z'),
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/playstation-store/prices?igdbGameId=7&platformIgdbId=167&includeCandidates=1',
  });

  assert.equal(response.headers['x-gameshelf-playstation-store-cache'], 'HIT_FRESH');
  const body = json(response.body);
  assert.equal(body['cached'], true);
  assert.equal((body['bestPrice'] as Record<string, unknown>)['amount'], 29.9);
  assert.equal((body['candidates'] as unknown[]).length, 1);
  assert.equal(store.calls.search.length + store.calls.product.length, 0);
  await app.close();
});

void test('PlayStation Store route ignores a cached price from another locale', async () => {
  const pool = new GamePoolMock();
  pool.seed('8', 167, {
    ...cachedPayload(new Date().toISOString()),
    playstationStoreCountry: 'US',
  });
  const store = fakeStore({ prices: { [HADES_II]: { base: 2990, current: 2990 } } });
  const app = await buildApp(pool, store.fetchImpl);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/playstation-store/prices?igdbGameId=8&platformIgdbId=167',
  });

  assert.equal(response.headers['x-gameshelf-playstation-store-cache'], 'MISS');
  await app.close();
});

void test('PlayStation Store route serves a stale price and queues a refresh', async () => {
  const pool = new GamePoolMock();
  pool.seed('9', 167, cachedPayload('2026-03-01T12:00:00.000Z'));
  const store = fakeStore({});
  const queued: PlayStationStorePriceRevalidationPayload[] = [];
  const app = await buildApp(pool, store.fetchImpl, {
    nowProvider: () => Date.parse('2026-03-10T12:00:00.000Z'),
    enqueueRevalidationJob: (payload) => {
      queued.push(payload);
    },
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/playstation-store/prices?igdbGameId=9&platformIgdbId=167',
  });

  assert.equal(response.headers['x-gameshelf-playstation-store-cache'], 'HIT_STALE');
  assert.equal(response.headers['x-gameshelf-playstation-store-revalidate'], 'scheduled');
  assert.deepEqual(queued, [
    {
      cacheKey: '9:167:ch:de:ps5',
      igdbGameId: '9',
      platformIgdbId: 167,
      title: 'Hades II',
      productId: HADES_II,
    },
  ]);
  assert.equal(store.calls.search.length + store.calls.product.length, 0);
  await app.close();
});

void test('PlayStation Store route reports a rejected query as an upstream error', async () => {
  const pool = new GamePoolMock();
  pool.seed('10', 167, { title: 'Hades II', priceSource: 'psprices', priceAmount: 31.9 });
  const store = fakeStore({
    failWith: { status: 400, body: { message: 'Query 4df6 not whitelisted' } },
  });
  const app = await buildApp(pool, store.fetchImpl);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/playstation-store/prices?igdbGameId=10&platformIgdbId=167',
  });

  assert.equal(response.statusCode, 502);
  // Nothing is overwritten.
  assert.equal(pool.getPayload('10', 167)['priceAmount'], 31.9);
  await app.close();
});

void test('queued PlayStation Store refresh prices the game and tracks discovery retries', async () => {
  const pool = new GamePoolMock();
  pool.seed('11', 167, { title: 'Hades II', listType: 'discovery' });
  const store = fakeStore({ search: { 'Hades II': [] } });

  await processQueuedPlayStationStorePriceRevalidation(
    pool as unknown as Pool,
    { cacheKey: 'k', igdbGameId: '11', platformIgdbId: 167, title: 'Hades II', productId: '' },
    { fetchImpl: store.fetchImpl }
  );

  const stored = pool.getPayload('11', 167);
  assert.equal(stored['playstationStoreMatchConfidence'], 'none');
  const retry = (stored['enrichmentRetry'] as Record<string, Record<string, unknown>>)[
    'playstationStore'
  ];
  assert.equal(retry['attempts'], 1);
  assert.equal(stored['priceSource'], undefined);
  // Discovery games don't create sync events.
  assert.equal(pool.syncEvents, 0);
});

void test('queued PlayStation Store refresh rejects other platforms and missing rows', async () => {
  const pool = new GamePoolMock();
  const fetchImpl = fakeStore({}).fetchImpl;
  await assert.rejects(
    processQueuedPlayStationStorePriceRevalidation(
      pool as unknown as Pool,
      { cacheKey: 'k', igdbGameId: '1', platformIgdbId: 130 },
      { fetchImpl }
    ),
    { message: 'Unsupported PlayStation Store platform for revalidation.' }
  );
  await assert.rejects(
    processQueuedPlayStationStorePriceRevalidation(
      pool as unknown as Pool,
      { cacheKey: 'k', igdbGameId: '1', platformIgdbId: 167 },
      { fetchImpl }
    ),
    { message: 'PlayStation Store revalidation game row not found.' }
  );
});
