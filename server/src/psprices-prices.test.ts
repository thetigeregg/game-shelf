import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { getCacheMetrics } from './cache-metrics.js';
import { registerPsPricesRoute } from './psprices-prices.js';

interface GameRow {
  payload: Record<string, unknown>;
}

class GamePoolMock {
  private readonly rowsByIdentity = new Map<string, GameRow>();
  private syncEventInsertCount = 0;
  private notificationSettingsReadCount = 0;
  private notificationTokenReadCount = 0;

  seed(igdbGameId: string, platformIgdbId: number, payload: Record<string, unknown>): void {
    this.rowsByIdentity.set(`${igdbGameId}::${String(platformIgdbId)}`, { payload });
  }

  getPayload(igdbGameId: string, platformIgdbId: number): Record<string, unknown> | null {
    return this.rowsByIdentity.get(`${igdbGameId}::${String(platformIgdbId)}`)?.payload ?? null;
  }

  getSyncEventInsertCount(): number {
    return this.syncEventInsertCount;
  }

  getNotificationSettingsReadCount(): number {
    return this.notificationSettingsReadCount;
  }

  getNotificationTokenReadCount(): number {
    return this.notificationTokenReadCount;
  }

  query(
    sql: string,
    params: unknown[]
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (
      normalized.startsWith(
        'select payload from games where igdb_game_id = $1 and platform_igdb_id = $2'
      )
    ) {
      const igdbGameId = typeof params[0] === 'string' ? params[0] : '';
      const platformIgdbId =
        typeof params[1] === 'number' && Number.isInteger(params[1]) ? params[1] : 0;
      const key = `${igdbGameId}::${String(platformIgdbId)}`;
      const row = this.rowsByIdentity.get(key);
      return Promise.resolve({ rows: row ? [row] : [] });
    }

    if (
      normalized.startsWith(
        'with current_row as ( select payload from games where igdb_game_id = $1'
      )
    ) {
      const igdbGameId = typeof params[0] === 'string' ? params[0] : '';
      const platformIgdbId =
        typeof params[1] === 'number' && Number.isInteger(params[1]) ? params[1] : 0;
      const payloadRaw = typeof params[2] === 'string' ? params[2] : '{}';
      const patch = JSON.parse(payloadRaw) as Record<string, unknown>;
      const key = `${igdbGameId}::${String(platformIgdbId)}`;
      const existing = this.rowsByIdentity.get(key)?.payload ?? {};
      const merged = { ...existing, ...patch };
      const changed = JSON.stringify(existing) !== JSON.stringify(merged);
      if (changed) {
        this.rowsByIdentity.set(key, { payload: merged });
        return Promise.resolve({
          rows: [{ previous_payload: existing, next_payload: merged }],
          rowCount: 1
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (
      normalized.startsWith(
        'insert into sync_events (entity_type, entity_key, operation, payload, server_timestamp)'
      )
    ) {
      this.syncEventInsertCount += 1;
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (normalized.startsWith('select setting_key, setting_value from settings')) {
      this.notificationSettingsReadCount += 1;
      return Promise.resolve({
        rows: [
          {
            setting_key: 'game-shelf:notifications:release:enabled',
            setting_value: 'true'
          },
          {
            setting_key: 'game-shelf:notifications:release:events',
            setting_value: JSON.stringify({ sale: true })
          }
        ],
        rowCount: 2
      });
    }

    if (
      normalized.startsWith(
        'select token from fcm_tokens where is_active = true order by token asc limit $1'
      )
    ) {
      this.notificationTokenReadCount += 1;
      void params;
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (normalized.startsWith('insert into release_notification_log')) {
      void params;
      return Promise.resolve({ rows: [{ inserted: 1 }], rowCount: 1 });
    }

    if (normalized.startsWith('update release_notification_log set payload = $1::jsonb')) {
      void params;
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (
      normalized.startsWith(
        'delete from release_notification_log where event_key = $1 and sent_count = 0'
      )
    ) {
      void params;
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (normalized.startsWith('update fcm_tokens set is_active = false, updated_at = now()')) {
      void params;
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    throw new Error(`Unsupported SQL in GamePoolMock: ${sql}`);
  }
}

function parseJsonRecord(responseBody: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(responseBody);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected JSON object response body');
  }
  return parsed as Record<string, unknown>;
}

function readCandidateTitles(body: Record<string, unknown>): string[] {
  const candidates = Array.isArray(body['candidates']) ? body['candidates'] : [];
  const titles: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    if (typeof record['title'] === 'string') {
      titles.push(record['title']);
    }
  }
  return titles;
}

void test('PSPrices route returns unsupported_platform outside supported IGDB platforms', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  let fetchCalls = 0;

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () => {
      fetchCalls += 1;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=1&platformIgdbId=6'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'unsupported_platform');
  assert.equal(fetchCalls, 0);

  await app.close();
});

void test('PSPrices route returns 404 when game row does not exist', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();

  await registerPsPricesRoute(app, pool as unknown as Pool);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=999&platformIgdbId=167'
  });

  assert.equal(response.statusCode, 404);
  const body = parseJsonRecord(response.body);
  assert.equal(body['error'], 'Game not found.');

  await app.close();
});

void test('PSPrices route fetches scraper result and persists normalized fields', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('332273', 167, {
    title: 'Monster Train 2'
  });
  const requestUrls: string[] = [];

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: (input) => {
      const url =
        input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
      requestUrls.push(url.href);
      assert.equal(url.pathname, '/v1/psprices/search');
      assert.equal(url.searchParams.get('q'), 'Monster Train 2');
      assert.equal(url.searchParams.get('platform'), 'PS5');
      assert.equal(url.searchParams.get('region'), 'region-ch');
      assert.equal(url.searchParams.get('show'), 'games');
      assert.equal(url.searchParams.get('includeCandidates'), '1');

      return Promise.resolve(
        new Response(
          JSON.stringify({
            item: {
              title: 'Monster Train 2',
              priceAmount: 49.9,
              currency: 'CHF',
              regularPriceAmount: 69.9,
              discountPercent: 28,
              isFree: false,
              url: 'https://psprices.com/region-ch/game/1234/monster-train-2'
            }
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      );
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=332273&platformIgdbId=167'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-psprices-cache'], 'MISS');
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');
  assert.equal(body['cached'], false);
  assert.equal(body['platform'], 'PS5');

  const bestPrice = body['bestPrice'] as Record<string, unknown>;
  assert.equal(bestPrice['amount'], 49.9);
  assert.equal(bestPrice['currency'], 'CHF');
  assert.equal(bestPrice['regularAmount'], 69.9);
  assert.equal(bestPrice['discountPercent'], 28);
  assert.equal(bestPrice['url'], 'https://psprices.com/region-ch/game/1234/monster-train-2');

  const persisted = pool.getPayload('332273', 167);
  assert.ok(persisted);
  assert.equal(persisted['psPricesRegionPath'], 'region-ch');
  assert.equal(persisted['psPricesShow'], 'games');
  assert.equal(persisted['psPricesPlatform'], 'PS5');
  assert.equal(persisted['psPricesPriceAmount'], 49.9);
  assert.equal(persisted['psPricesPriceCurrency'], 'CHF');
  assert.equal(persisted['priceSource'], 'psprices');
  assert.equal(persisted['priceAmount'], 49.9);
  assert.equal(persisted['priceCurrency'], 'CHF');
  assert.equal(persisted['priceRegularAmount'], 69.9);
  assert.equal(persisted['priceDiscountPercent'], 28);
  assert.equal(persisted['priceIsFree'], false);
  assert.equal(persisted['priceUrl'], 'https://psprices.com/region-ch/game/1234/monster-train-2');
  assert.equal(pool.getSyncEventInsertCount(), 1);
  assert.equal(requestUrls.length, 1);

  await app.close();
});

void test('PSPrices route falls back currency from region when scraper omits it', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('332273', 167, {
    title: 'Monster Train 2'
  });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: {
              title: 'Monster Train 2',
              priceAmount: 49.9,
              regularPriceAmount: 69.9,
              discountPercent: 28,
              isFree: false,
              url: 'https://psprices.com/region-ch/game/1234/monster-train-2'
            }
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=332273&platformIgdbId=167'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  const bestPrice = body['bestPrice'] as Record<string, unknown>;
  assert.equal(bestPrice['currency'], 'CHF');

  const persisted = pool.getPayload('332273', 167);
  assert.ok(persisted);
  assert.equal(persisted['psPricesPriceCurrency'], 'CHF');
  assert.equal(persisted['priceCurrency'], 'CHF');

  await app.close();
});

void test('PSPrices route suppresses sync event writes for discovery rows', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('332273', 167, {
    listType: 'discovery',
    title: 'Monster Train 2'
  });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: {
              title: 'Monster Train 2',
              priceAmount: 49.9,
              currency: 'CHF',
              regularPriceAmount: 69.9,
              discountPercent: 28,
              isFree: false,
              url: 'https://psprices.com/region-ch/game/1234/monster-train-2'
            }
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=332273&platformIgdbId=167'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(pool.getSyncEventInsertCount(), 0);

  await app.close();
});

void test('PSPrices route preserves existing unified price data when lookup is unavailable', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('332273', 167, {
    title: 'Monster Train 2',
    priceSource: 'psprices',
    priceAmount: 49.9,
    priceCurrency: 'CHF',
    priceRegularAmount: 69.9,
    priceDiscountPercent: 28,
    priceIsFree: false,
    priceUrl: 'https://psprices.com/region-ch/game/1234/monster-train-2',
    psPricesPriceAmount: 49.9,
    psPricesPriceCurrency: 'CHF',
    psPricesRegularPriceAmount: 69.9,
    psPricesDiscountPercent: 28,
    psPricesIsFree: false,
    psPricesUrl: 'https://psprices.com/region-ch/game/1234/monster-train-2'
  });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: {
              title: 'Different Game Name',
              priceAmount: 19.9,
              currency: 'CHF'
            },
            candidates: []
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=332273&platformIgdbId=167'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'unavailable');
  assert.equal(body['bestPrice'], null);

  const persisted = pool.getPayload('332273', 167);
  assert.ok(persisted);
  assert.equal(persisted['priceSource'], 'psprices');
  assert.equal(persisted['priceAmount'], 49.9);
  assert.equal(persisted['priceCurrency'], 'CHF');
  assert.equal(persisted['priceRegularAmount'], 69.9);
  assert.equal(persisted['priceFetchedAt'], undefined);
  assert.equal(typeof persisted['psPricesFetchedAt'], 'string');

  await app.close();
});

void test('PSPrices route reaches wishlist sale notification checks during discount transition', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('332273', 167, {
    title: 'Monster Train 2',
    listType: 'wishlist',
    priceAmount: 69.9,
    priceRegularAmount: 69.9,
    priceDiscountPercent: 0,
    priceIsFree: false
  });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: {
              title: 'Monster Train 2',
              priceAmount: 49.9,
              currency: 'CHF',
              regularPriceAmount: 69.9,
              discountPercent: 28,
              isFree: false,
              url: 'https://psprices.com/region-ch/game/1234/monster-train-2'
            }
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=332273&platformIgdbId=167'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(pool.getNotificationSettingsReadCount(), 1);
  assert.equal(pool.getNotificationTokenReadCount(), 1);

  await app.close();
});

void test('PSPrices route returns fresh cached result without scraper fetch', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('5263323', 130, {
    title: 'Pokemon Violet',
    psPricesFetchedAt: '2026-03-10T10:00:00.000Z',
    psPricesRegionPath: 'region-ch',
    psPricesShow: 'games',
    psPricesPlatform: 'Switch',
    psPricesTitle: 'Pokemon Violet',
    psPricesPriceAmount: 59.9,
    psPricesPriceCurrency: 'CHF',
    psPricesRegularPriceAmount: null,
    psPricesDiscountPercent: null,
    psPricesIsFree: false,
    psPricesUrl: 'https://psprices.com/region-ch/game/5263323/pokemon-violet'
  });
  let fetchCalls = 0;

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    nowProvider: () => Date.parse('2026-03-10T12:00:00.000Z'),
    fetchImpl: () => {
      fetchCalls += 1;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=5263323&platformIgdbId=130'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-psprices-cache'], 'HIT_FRESH');
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');
  assert.equal(body['cached'], true);
  assert.equal(fetchCalls, 0);

  await app.close();
});

void test('PSPrices fresh cache falls back currency from region when cached currency is missing', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('5263323', 130, {
    title: 'Pokemon Violet',
    psPricesFetchedAt: '2026-03-10T10:00:00.000Z',
    psPricesRegionPath: 'region-ch',
    psPricesShow: 'games',
    psPricesPlatform: 'Switch',
    psPricesTitle: 'Pokemon Violet',
    psPricesPriceAmount: 59.9,
    psPricesPriceCurrency: null,
    psPricesRegularPriceAmount: null,
    psPricesDiscountPercent: null,
    psPricesIsFree: false,
    psPricesUrl: 'https://psprices.com/region-ch/game/5263323/pokemon-violet'
  });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    nowProvider: () => Date.parse('2026-03-10T12:00:00.000Z')
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=5263323&platformIgdbId=130'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-psprices-cache'], 'HIT_FRESH');
  const body = parseJsonRecord(response.body);
  const bestPrice = body['bestPrice'] as Record<string, unknown>;
  assert.equal(bestPrice['currency'], 'CHF');

  await app.close();
});

void test('PSPrices route bypasses fresh cache when title override is provided', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('5263323', 130, {
    title: 'Pokemon Violet',
    psPricesFetchedAt: '2026-03-10T10:00:00.000Z',
    psPricesRegionPath: 'region-ch',
    psPricesShow: 'games',
    psPricesPlatform: 'Switch',
    psPricesTitle: 'Pokemon Violet',
    psPricesPriceAmount: 59.9,
    psPricesPriceCurrency: 'CHF',
    psPricesRegularPriceAmount: null,
    psPricesDiscountPercent: null,
    psPricesIsFree: false,
    psPricesUrl: 'https://psprices.com/region-ch/game/5263323/pokemon-violet'
  });
  let fetchCalls = 0;

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    nowProvider: () => Date.parse('2026-03-10T12:00:00.000Z'),
    fetchImpl: (input) => {
      fetchCalls += 1;
      const url =
        input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
      assert.equal(url.searchParams.get('q'), 'Monster Train 2');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            item: {
              title: 'Monster Train 2',
              priceAmount: 49.9,
              currency: 'CHF',
              regularPriceAmount: 69.9,
              discountPercent: 28,
              isFree: false,
              url: 'https://psprices.com/region-ch/game/1234/monster-train-2'
            }
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      );
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=5263323&platformIgdbId=130&title=Monster%20Train%202'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-psprices-cache'], 'MISS');
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');
  assert.equal(body['cached'], false);
  assert.equal(fetchCalls, 1);

  await app.close();
});

void test('PSPrices fresh cache keeps match and candidates for includeCandidates requests', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('5263323', 130, {
    title: 'Pokemon Violet',
    psPricesFetchedAt: '2026-03-10T10:00:00.000Z',
    psPricesRegionPath: 'region-ch',
    psPricesShow: 'games',
    psPricesPlatform: 'Switch',
    psPricesTitle: 'Pokemon Violet',
    psPricesPriceAmount: 59.9,
    psPricesPriceCurrency: 'CHF',
    psPricesRegularPriceAmount: null,
    psPricesDiscountPercent: null,
    psPricesIsFree: false,
    psPricesUrl: 'https://psprices.com/region-ch/game/5263323/pokemon-violet',
    psPricesMatchQueryTitle: 'Pokemon Violet',
    psPricesMatchTitle: 'Pokemon Violet',
    psPricesMatchScore: 100,
    psPricesMatchConfidence: 'high',
    psPricesCandidates: [
      {
        title: 'Pokemon Violet',
        amount: 59.9,
        currency: 'CHF',
        regularAmount: null,
        discountPercent: null,
        isFree: false,
        url: 'https://psprices.com/region-ch/game/5263323/pokemon-violet',
        score: 100
      }
    ]
  });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    nowProvider: () => Date.parse('2026-03-10T12:00:00.000Z')
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=5263323&platformIgdbId=130&includeCandidates=1'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-psprices-cache'], 'HIT_FRESH');
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');
  assert.equal(body['cached'], true);
  assert.deepEqual(body['match'], {
    queryTitle: 'Pokemon Violet',
    matchedTitle: 'Pokemon Violet',
    score: 100,
    confidence: 'high'
  });
  assert.ok(Array.isArray(body['candidates']));
  assert.equal((body['candidates'] as unknown[]).length, 1);

  await app.close();
});

void test('PSPrices route serves stale cache and schedules revalidation', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('5263323', 130, {
    title: 'Pokemon Violet',
    psPricesMatchQueryTitle: 'Pokemon Scarlet',
    psPricesFetchedAt: '2026-03-08T10:00:00.000Z',
    psPricesRegionPath: 'region-ch',
    psPricesShow: 'games',
    psPricesPlatform: 'Switch',
    psPricesTitle: 'Pokemon Violet',
    psPricesPriceAmount: 59.9,
    psPricesPriceCurrency: 'CHF',
    psPricesRegularPriceAmount: null,
    psPricesDiscountPercent: null,
    psPricesIsFree: false,
    psPricesUrl: 'https://psprices.com/region-ch/game/5263323/pokemon-violet'
  });
  let fetchCalls = 0;
  const queuedPayloads: Record<string, unknown>[] = [];

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    nowProvider: () => Date.parse('2026-03-10T12:00:00.000Z'),
    enqueueRevalidationJob: (payload) => {
      queuedPayloads.push(payload as unknown as Record<string, unknown>);
    },
    fetchImpl: () => {
      fetchCalls += 1;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=5263323&platformIgdbId=130'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-psprices-cache'], 'HIT_STALE');
  assert.equal(response.headers['x-gameshelf-psprices-revalidate'], 'scheduled');
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');
  assert.equal(body['cached'], true);
  assert.equal(fetchCalls, 0);
  assert.equal(queuedPayloads.length, 1);
  assert.equal(queuedPayloads[0]?.['title'], 'Pokemon Scarlet');
  assert.equal(
    queuedPayloads[0]?.['psPricesUrl'],
    'https://psprices.com/region-ch/game/5263323/pokemon-violet'
  );

  await app.close();
});

void test('PSPrices route skips stale revalidation when psPrices match is locked', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  const skippedBefore = getCacheMetrics().pspricesPrice.revalidateSkipped;
  pool.seed('5263323', 130, {
    title: 'Pokemon Violet',
    psPricesMatchLocked: true,
    psPricesFetchedAt: '2026-03-08T10:00:00.000Z',
    psPricesRegionPath: 'region-ch',
    psPricesShow: 'games',
    psPricesPlatform: 'Switch',
    psPricesTitle: 'Pokemon Violet',
    psPricesPriceAmount: 59.9,
    psPricesPriceCurrency: 'CHF',
    psPricesRegularPriceAmount: null,
    psPricesDiscountPercent: null,
    psPricesIsFree: false,
    psPricesUrl: 'https://psprices.com/region-ch/game/5263323/pokemon-violet'
  });
  const queuedPayloads: Record<string, unknown>[] = [];

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    nowProvider: () => Date.parse('2026-03-10T12:00:00.000Z'),
    enqueueRevalidationJob: (payload) => {
      queuedPayloads.push(payload as unknown as Record<string, unknown>);
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=5263323&platformIgdbId=130'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-psprices-cache'], 'HIT_STALE');
  assert.equal(response.headers['x-gameshelf-psprices-revalidate'], 'skipped');
  assert.equal(queuedPayloads.length, 0);
  const skippedAfter = getCacheMetrics().pspricesPrice.revalidateSkipped;
  assert.equal(skippedAfter, skippedBefore + 1);

  await app.close();
});

void test('PSPrices route sets psPricesMatchLocked when title override is used', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('332273', 167, {
    title: 'Monster Train 2'
  });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: {
              title: 'Monster Train 2',
              amount: 49.9,
              currency: 'CHF',
              regularAmount: 69.9,
              discountPercent: 28,
              isFree: false,
              url: 'https://psprices.com/region-ch/game/1234/monster-train-2'
            },
            candidates: []
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=332273&platformIgdbId=167&title=Monster%20Train%202'
  });

  assert.equal(response.statusCode, 200);
  const persisted = pool.getPayload('332273', 167);
  assert.equal(persisted?.['psPricesMatchLocked'], true);

  await app.close();
});

void test('PSPrices route prefers persisted psPricesUrl candidate over fuzzy title ranking', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('217550', 130, {
    title: 'Fire Emblem Engage',
    psPricesUrl: 'https://psprices.com/region-ch/game/7114397/fire-emblem-engage-expansion-pass'
  });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: 'Fire Emblem Engage Standard Edition',
                amount: 59.9,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/5581873/fire-emblem-engage-standard-edition'
              },
              {
                title: 'Fire Emblem Engage Expansion Pass',
                amount: 30,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7114397/fire-emblem-engage-expansion-pass'
              }
            ]
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=217550&platformIgdbId=130'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');
  const bestPrice = body['bestPrice'] as Record<string, unknown>;
  assert.equal(
    bestPrice['url'],
    'https://psprices.com/region-ch/game/7114397/fire-emblem-engage-expansion-pass'
  );
  const match = body['match'] as Record<string, unknown>;
  assert.equal(match['matchedTitle'], 'Fire Emblem Engage Expansion Pass');
  assert.equal(match['confidence'], 'high');

  await app.close();
});

void test('PSPrices route can return ranked candidates for manual picker workflows', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('332273', 167, {
    title: 'Monster Train 2'
  });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: {
              title: 'Monster Train 2',
              priceAmount: 49.9,
              currency: 'CHF',
              regularPriceAmount: 69.9,
              discountPercent: 28,
              isFree: false,
              url: 'https://psprices.com/region-ch/game/1234/monster-train-2'
            },
            candidates: [
              {
                title: 'Monster Train 2',
                priceAmount: 49.9,
                currency: 'CHF',
                regularPriceAmount: 69.9,
                discountPercent: 28,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/1234/monster-train-2'
              },
              {
                title: 'Monster Train',
                priceAmount: 19.9,
                currency: 'CHF',
                regularPriceAmount: 39.9,
                discountPercent: 50,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/1233/monster-train'
              }
            ]
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=332273&platformIgdbId=167&includeCandidates=1'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');
  assert.ok(Array.isArray(body['candidates']));
  assert.equal((body['candidates'] as unknown[]).length >= 1, true);

  await app.close();
});

void test('PSPrices scoring treats standard edition as neutral for title confidence', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('217550', 130, {
    title: 'Fire Emblem Engage'
  });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: 'Fire Emblem Engage Fire Emblem Engage + Expansion Pass',
                amount: 89.9,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/5817110/fire-emblem-engage-fire-emblem-engage-expansion-pass'
              },
              {
                title: 'Fire Emblem Engage Standard Edition',
                amount: 59.9,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/5581873/fire-emblem-engage-standard-edition'
              },
              {
                title: 'Fire Emblem Engage Expansion Pass',
                amount: 30,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7114397/fire-emblem-engage-expansion-pass'
              }
            ]
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=217550&platformIgdbId=130&title=Fire%20Emblem%20Engage&includeCandidates=1'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');

  const match = body['match'] as Record<string, unknown>;
  assert.equal(match['matchedTitle'], 'Fire Emblem Engage Standard Edition');
  assert.equal(match['score'], 100);
  assert.equal(match['confidence'], 'high');

  const bestPrice = body['bestPrice'] as Record<string, unknown>;
  assert.equal(bestPrice['title'], 'Fire Emblem Engage Standard Edition');
  assert.equal(bestPrice['amount'], 59.9);

  const candidates = body['candidates'] as Array<Record<string, unknown>>;
  assert.equal(candidates[0]?.['title'], 'Fire Emblem Engage Standard Edition');
  assert.equal(candidates[0]?.['score'], 100);

  await app.close();
});

void test('PSPrices scoring treats complete edition as neutral for title confidence', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('777777', 167, {
    title: 'Nioh 2'
  });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: 'Nioh 2 Complete Edition',
                amount: 59.9,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7777777/nioh-2-complete-edition'
              },
              {
                title: 'Nioh 2 Season Pass',
                amount: 24.9,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7777778/nioh-2-season-pass'
              }
            ]
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=777777&platformIgdbId=167&title=Nioh%202&includeCandidates=1'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');

  const match = body['match'] as Record<string, unknown>;
  assert.equal(match['matchedTitle'], 'Nioh 2 Complete Edition');
  assert.equal(match['score'], 98);
  assert.equal(match['confidence'], 'high');

  const bestPrice = body['bestPrice'] as Record<string, unknown>;
  assert.equal(bestPrice['title'], 'Nioh 2 Complete Edition');
  assert.equal(bestPrice['amount'], 59.9);

  await app.close();
});

void test('PSPrices scoring treats roman and arabic sequel numerals as equivalent', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('119171', 167, {
    title: "Baldur's Gate III"
  });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: "Baldur's Gate 3",
                amount: 69.9,
                currency: 'CHF',
                isFree: false,
                url: 'https://psprices.com/region-ch/game/9999999/baldurs-gate-3'
              },
              {
                title: "Baldur's Gate II",
                amount: 39.9,
                currency: 'CHF',
                isFree: false,
                url: 'https://psprices.com/region-ch/game/9999998/baldurs-gate-2'
              }
            ]
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=119171&platformIgdbId=167&title=Baldur%27s%20Gate%20III&includeCandidates=1'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');

  const match = body['match'] as Record<string, unknown>;
  assert.equal(match['matchedTitle'], "Baldur's Gate 3");
  assert.equal(match['score'], 100);
  assert.equal(match['confidence'], 'high');

  const bestPrice = body['bestPrice'] as Record<string, unknown>;
  assert.equal(bestPrice['title'], "Baldur's Gate 3");

  await app.close();
});

void test('PSPrices scoring treats roman and arabic numerals equivalently for sequel tokens', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('111111', 167, {
    title: 'Resident Evil VII'
  });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: 'Resident Evil 7',
                amount: 19.9,
                currency: 'CHF',
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7777001/resident-evil-7'
              },
              {
                title: 'Resident Evil 6',
                amount: 15.9,
                currency: 'CHF',
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7777002/resident-evil-6'
              }
            ]
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=111111&platformIgdbId=167&title=Resident%20Evil%20VII&includeCandidates=1'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');

  const match = body['match'] as Record<string, unknown>;
  assert.equal(match['matchedTitle'], 'Resident Evil 7');
  assert.equal(match['score'], 100);
  assert.equal(match['confidence'], 'high');

  await app.close();
});

void test('PSPrices scoring treats ampersand and and as equivalent', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('999991', 167, {
    title: 'Ratchet & Clank: Rift Apart'
  });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: 'Ratchet and Clank Rift Apart',
                amount: 49.9,
                currency: 'CHF',
                isFree: false,
                url: 'https://psprices.com/region-ch/game/9999911/ratchet-and-clank-rift-apart'
              },
              {
                title: 'Ratchet and Clank Collection',
                amount: 19.9,
                currency: 'CHF',
                isFree: false,
                url: 'https://psprices.com/region-ch/game/9999912/ratchet-and-clank-collection'
              }
            ]
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=999991&platformIgdbId=167&title=Ratchet%20%26%20Clank%3A%20Rift%20Apart&includeCandidates=1'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');

  const match = body['match'] as Record<string, unknown>;
  assert.equal(match['matchedTitle'], 'Ratchet and Clank Rift Apart');
  assert.equal(match['score'], 100);
  assert.equal(match['confidence'], 'high');

  await app.close();
});

void test('PSPrices scoring resolves duplicate title ties using metadata quality signals', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('36952', 48, {
    title: 'Wolfenstein II: The New Colossus'
  });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: 'Wolfenstein II: The New Colossus',
                amount: 50.18,
                currency: 'CHF',
                isFree: false,
                gameId: '2632691',
                collectionTagCount: 2,
                hasMostEngagingTag: true,
                metacriticScore: 87,
                openCriticScore: 86,
                url: 'https://psprices.com/region-ch/game/2632691/wolfenstein-ii-the-new-colossus'
              },
              {
                title: 'Wolfenstein II: The New Colossus',
                amount: 50.18,
                currency: 'CHF',
                isFree: false,
                gameId: '2634364',
                collectionTagCount: 1,
                hasMostEngagingTag: false,
                openCriticScore: 86,
                url: 'https://psprices.com/region-ch/game/2634364/wolfenstein-ii-the-new-colossus'
              }
            ]
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=36952&platformIgdbId=48&title=Wolfenstein%20II%3A%20The%20New%20Colossus&includeCandidates=1'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');

  const match = body['match'] as Record<string, unknown>;
  assert.equal(match['matchedTitle'], 'Wolfenstein II: The New Colossus');
  assert.equal(match['score'], 100);
  assert.equal(match['confidence'], 'high');

  const bestPrice = body['bestPrice'] as Record<string, unknown>;
  assert.equal(
    bestPrice['url'],
    'https://psprices.com/region-ch/game/2632691/wolfenstein-ii-the-new-colossus'
  );

  await app.close();
});

void test('PSPrices suffix taxonomy enforces baseline variant ordering for Diablo IV', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('125165', 167, { title: 'Diablo IV' });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: 'Diablo IV — Erweiterungspaket',
                amount: 79.9,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7193028/diablo-iv-erweiterungspaket'
              },
              {
                title: 'Diablo IV - Deluxe Edition',
                amount: 69.9,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7193021/diablo-iv-deluxe-edition'
              },
              {
                title: 'Diablo IV - Deluxe',
                amount: 69.9,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7193022/diablo-iv-deluxe'
              },
              {
                title: 'Diablo IV - Ultimate Edition',
                amount: 74.9,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7193023/diablo-iv-ultimate-edition'
              },
              {
                title: 'Diablo IV - Complete Edition',
                amount: 64.9,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7193024/diablo-iv-complete-edition'
              },
              {
                title: 'Diablo IV - Complete',
                amount: 64.9,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7193025/diablo-iv-complete'
              },
              {
                title: 'Diablo IV - Standard Edition',
                amount: 59.9,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7193020/diablo-iv-standard-edition'
              },
              {
                title: 'Diablo IV - Standard',
                amount: 59.9,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7193026/diablo-iv-standard'
              },
              {
                title: 'Diablo IV',
                amount: 59.9,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7193027/diablo-iv'
              },
              {
                title: 'Diablo IV Collection',
                amount: 89.9,
                isFree: false,
                url: 'https://psprices.com/region-ch/game/7193029/diablo-iv-collection'
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=125165&platformIgdbId=167&title=Diablo%20IV&includeCandidates=1'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  const titles = readCandidateTitles(body);
  assert.equal(titles[0], 'Diablo IV');
  assert.equal(titles[1], 'Diablo IV - Standard Edition');
  assert.equal(titles[2], 'Diablo IV - Standard');
  assert.equal(titles[3], 'Diablo IV - Complete Edition');
  assert.equal(titles[4], 'Diablo IV - Complete');
  assert.equal(titles[5], 'Diablo IV - Ultimate Edition');
  assert.equal(titles[6], 'Diablo IV - Deluxe Edition');
  assert.equal(titles[7], 'Diablo IV - Deluxe');
  assert.equal(titles[8], 'Diablo IV Collection');
  assert.equal(titles[9], 'Diablo IV — Erweiterungspaket');

  await app.close();
});

void test('PSPrices treats missing Edition labels as same suffix class behavior', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('125165', 167, { title: 'Diablo IV' });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              { title: 'Diablo IV - Ultimate Edition', amount: 74.9, isFree: false, url: 'u-1' },
              { title: 'Diablo IV - Ultimate', amount: 74.9, isFree: false, url: 'u-2' },
              { title: 'Diablo IV - Complete Edition', amount: 64.9, isFree: false, url: 'c-1' },
              { title: 'Diablo IV - Complete', amount: 64.9, isFree: false, url: 'c-2' },
              { title: 'Diablo IV - Standard Edition', amount: 59.9, isFree: false, url: 's-1' },
              { title: 'Diablo IV - Standard', amount: 59.9, isFree: false, url: 's-2' },
              { title: 'Diablo IV - Deluxe Edition', amount: 69.9, isFree: false, url: 'd-1' },
              { title: 'Diablo IV - Deluxe', amount: 69.9, isFree: false, url: 'd-2' }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=125165&platformIgdbId=167&title=Diablo%20IV&includeCandidates=1'
  });
  assert.equal(response.statusCode, 200);
  const titles = readCandidateTitles(parseJsonRecord(response.body));

  assert.equal(
    titles.indexOf('Diablo IV - Standard Edition') < titles.indexOf('Diablo IV - Complete Edition'),
    true
  );
  assert.equal(
    titles.indexOf('Diablo IV - Standard') < titles.indexOf('Diablo IV - Complete'),
    true
  );
  assert.equal(
    titles.indexOf('Diablo IV - Complete Edition') < titles.indexOf('Diablo IV - Deluxe Edition'),
    true
  );
  assert.equal(titles.indexOf('Diablo IV - Complete') < titles.indexOf('Diablo IV - Deluxe'), true);
  assert.equal(
    titles.indexOf('Diablo IV - Ultimate Edition') < titles.indexOf('Diablo IV - Deluxe Edition'),
    true
  );
  assert.equal(titles.indexOf('Diablo IV - Ultimate') < titles.indexOf('Diablo IV - Deluxe'), true);

  await app.close();
});

void test('PSPrices ranks ultimate or gold above deluxe for strong core title matches', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('217550', 130, { title: "Assassin's Creed Odyssey" });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: "Assassin's Creed Odyssey Deluxe Edition",
                amount: 69.9,
                isFree: false,
                url: 'd'
              },
              {
                title: "Assassin's Creed Odyssey Ultimate Edition",
                amount: 79.9,
                isFree: false,
                url: 'u'
              },
              {
                title: "Assassin's Creed Odyssey Gold Edition",
                amount: 74.9,
                isFree: false,
                url: 'g'
              },
              { title: "Assassin's Creed Odyssey", amount: 59.9, isFree: false, url: 'b' }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=217550&platformIgdbId=130&title=Assassin%27s%20Creed%20Odyssey&includeCandidates=1'
  });
  assert.equal(response.statusCode, 200);
  const titles = readCandidateTitles(parseJsonRecord(response.body));
  assert.equal(titles[0], "Assassin's Creed Odyssey");
  assert.equal(
    titles.indexOf("Assassin's Creed Odyssey Gold Edition") <
      titles.indexOf("Assassin's Creed Odyssey Deluxe Edition"),
    true
  );
  assert.equal(
    titles.indexOf("Assassin's Creed Odyssey Ultimate Edition") <
      titles.indexOf("Assassin's Creed Odyssey Deluxe Edition"),
    true
  );

  await app.close();
});

void test('PSPrices suppresses expansion style variants below deluxe for same core title', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('1930', 167, { title: 'Cyberpunk 2077' });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              { title: 'Cyberpunk 2077 Expansion Pack', amount: 29.9, isFree: false, url: 'e' },
              { title: 'Cyberpunk 2077 Phantom Liberty', amount: 29.9, isFree: false, url: 'p' },
              { title: 'Cyberpunk 2077 Deluxe Edition', amount: 69.9, isFree: false, url: 'd' },
              { title: 'Cyberpunk 2077', amount: 59.9, isFree: false, url: 'b' }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=1930&platformIgdbId=167&title=Cyberpunk%202077&includeCandidates=1'
  });
  assert.equal(response.statusCode, 200);
  const titles = readCandidateTitles(parseJsonRecord(response.body));
  assert.equal(titles[0], 'Cyberpunk 2077');
  assert.equal(
    titles.indexOf('Cyberpunk 2077 Deluxe Edition') <
      titles.indexOf('Cyberpunk 2077 Expansion Pack'),
    true
  );
  assert.equal(
    titles.indexOf('Cyberpunk 2077 Deluxe Edition') <
      titles.indexOf('Cyberpunk 2077 Phantom Liberty'),
    true
  );

  await app.close();
});

void test('PSPrices keeps collection variants below closest single-game title', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('91011', 167, { title: 'BioShock' });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              { title: 'BioShock Collection', amount: 19.9, isFree: false, url: 'c' },
              { title: 'BioShock Remastered', amount: 14.9, isFree: false, url: 'r' },
              { title: 'BioShock', amount: 9.9, isFree: false, url: 'b' }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=91011&platformIgdbId=167&title=BioShock&includeCandidates=1'
  });
  assert.equal(response.statusCode, 200);
  const titles = readCandidateTitles(parseJsonRecord(response.body));
  assert.equal(titles.indexOf('BioShock Collection') > titles.indexOf('BioShock'), true);
  assert.equal(titles.indexOf('BioShock Collection') > titles.indexOf('BioShock Remastered'), true);

  await app.close();
});

void test('PSPrices classifier treats deluxe separators and parentheses consistently', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('1200', 167, { title: 'Resident Evil 4' });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              { title: 'Resident Evil 4: Deluxe Edition', amount: 59.9, isFree: false, url: 'd1' },
              { title: 'Resident Evil 4 - Deluxe Edition', amount: 59.9, isFree: false, url: 'd2' },
              { title: 'Resident Evil 4 (Deluxe Edition)', amount: 59.9, isFree: false, url: 'd3' },
              { title: 'Resident Evil 4', amount: 49.9, isFree: false, url: 'b' }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=1200&platformIgdbId=167&title=Resident%20Evil%204&includeCandidates=1'
  });
  assert.equal(response.statusCode, 200);
  const titles = readCandidateTitles(parseJsonRecord(response.body));
  assert.equal(titles[0], 'Resident Evil 4');
  assert.equal(titles.indexOf('Resident Evil 4: Deluxe Edition') > 0, true);
  assert.equal(titles.indexOf('Resident Evil 4 - Deluxe Edition') > 0, true);
  assert.equal(titles.indexOf('Resident Evil 4 (Deluxe Edition)') > 0, true);

  await app.close();
});

void test('PSPrices keeps metadata tie-break behavior within same suffix class', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('125165', 167, { title: 'Diablo IV' });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: 'Diablo IV',
                amount: 59.9,
                isFree: false,
                gameId: '7002',
                openCriticScore: 80,
                url: 'b2'
              },
              {
                title: 'Diablo IV',
                amount: 59.9,
                isFree: false,
                gameId: '7001',
                metacriticScore: 90,
                openCriticScore: 86,
                collectionTagCount: 2,
                hasMostEngagingTag: true,
                url: 'b1'
              },
              { title: 'Diablo IV Standard Edition', amount: 59.9, isFree: false, url: 's' }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=125165&platformIgdbId=167&title=Diablo%20IV&includeCandidates=1'
  });
  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  const bestPrice = body['bestPrice'] as Record<string, unknown>;
  assert.equal(bestPrice['url'], 'b1');

  await app.close();
});

void test('PSPrices prefers parseable gameId when other tie-break signals are equal', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('991007', 167, { title: 'Diablo IV' });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              { title: 'Diablo IV', amount: 59.9, isFree: false, gameId: 'abc', url: null },
              { title: 'Diablo IV', amount: 58.9, isFree: false, gameId: '7001', url: null }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=991007&platformIgdbId=167&title=Diablo%20IV&includeCandidates=1'
  });
  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  const candidates = body['candidates'] as Array<Record<string, unknown>>;
  assert.equal(candidates[0]?.['gameId'], '7001');

  await app.close();
});

void test('PSPrices strong-core guardrail keeps stronger core match above weak standard variant', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('125165', 167, { title: 'Diablo IV' });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: 'Diablo III Standard Edition',
                amount: 39.9,
                isFree: false,
                url: 'iii-standard'
              },
              {
                title: 'Diablo IV Expansion Pack',
                amount: 29.9,
                isFree: false,
                url: 'iv-expansion'
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=125165&platformIgdbId=167&title=Diablo%20IV&includeCandidates=1'
  });
  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  const bestPrice = body['bestPrice'] as Record<string, unknown>;
  assert.equal(bestPrice['url'], 'iv-expansion');

  await app.close();
});

void test('PSPrices keeps high confidence for strong base vs standard ties', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('991006', 167, { title: 'Diablo IV' });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: 'Diablo IV - Standard Edition',
                amount: 69.9,
                isFree: false,
                url: 'standard'
              },
              { title: 'Diablo IV', amount: 59.9, isFree: false, url: 'base' }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=991006&platformIgdbId=167&title=Diablo%20IV&includeCandidates=1'
  });
  assert.equal(response.statusCode, 200);

  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');
  const bestPrice = body['bestPrice'] as Record<string, unknown> | null;
  assert.notEqual(bestPrice, null);
  assert.equal(bestPrice?.['title'], 'Diablo IV');

  const match = body['match'] as Record<string, unknown>;
  assert.equal(match['confidence'], 'high');

  await app.close();
});

void test('PSPrices keeps platform markers neutral relative to edition ranking', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('991001', 167, { title: 'Hogwarts Legacy' });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              { title: 'Hogwarts Legacy Deluxe Edition', amount: 79.9, isFree: false, url: 'd' },
              {
                title: 'Hogwarts Legacy Nintendo Switch 2 Edition',
                amount: 59.9,
                isFree: false,
                url: 's2'
              },
              { title: 'Hogwarts Legacy PS5', amount: 59.9, isFree: false, url: 'ps5' },
              { title: 'Hogwarts Legacy', amount: 49.9, isFree: false, url: 'base' }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=991001&platformIgdbId=167&title=Hogwarts%20Legacy&includeCandidates=1'
  });
  assert.equal(response.statusCode, 200);
  const titles = readCandidateTitles(parseJsonRecord(response.body));
  assert.equal(titles[0], 'Hogwarts Legacy');
  assert.equal(titles[1], 'Hogwarts Legacy PS5');
  assert.equal(titles[2], 'Hogwarts Legacy Nintendo Switch 2 Edition');
  assert.equal(titles[3], 'Hogwarts Legacy Deluxe Edition');

  await app.close();
});

void test('PSPrices applies platform neutrality alongside edition ordering', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('991002', 167, { title: 'Cyberpunk 2077' });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: 'Cyberpunk 2077 PS5 Deluxe Edition',
                amount: 74.9,
                isFree: false,
                url: 'ps5-deluxe'
              },
              {
                title: 'Cyberpunk 2077 Deluxe Edition',
                amount: 69.9,
                isFree: false,
                url: 'deluxe'
              },
              { title: 'Cyberpunk 2077 PS5', amount: 59.9, isFree: false, url: 'ps5' },
              { title: 'Cyberpunk 2077', amount: 49.9, isFree: false, url: 'base' }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=991002&platformIgdbId=167&title=Cyberpunk%202077&includeCandidates=1'
  });
  assert.equal(response.statusCode, 200);
  const titles = readCandidateTitles(parseJsonRecord(response.body));
  assert.equal(titles[0], 'Cyberpunk 2077');
  assert.equal(titles[1], 'Cyberpunk 2077 PS5');
  assert.equal(titles[2], 'Cyberpunk 2077 Deluxe Edition');
  assert.equal(titles[3], 'Cyberpunk 2077 PS5 Deluxe Edition');

  await app.close();
});

void test('PSPrices keeps strong confidence when platform marker precedes edition suffix', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('991020', 167, { title: 'Diablo IV' });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: 'Diablo IV PS5 Deluxe Edition',
                amount: 69.9,
                isFree: false,
                url: 'ps5-deluxe'
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=991020&platformIgdbId=167&title=Diablo%20IV&includeCandidates=1'
  });
  assert.equal(response.statusCode, 200);

  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');
  const match = body['match'] as Record<string, unknown>;
  assert.equal(match['confidence'], 'high');
  const bestPrice = body['bestPrice'] as Record<string, unknown> | null;
  assert.notEqual(bestPrice, null);
  assert.equal(bestPrice?.['title'], 'Diablo IV PS5 Deluxe Edition');

  await app.close();
});

void test('PSPrices classifies platform upgrade variants as expansion-style content', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('991003', 167, { title: "No Man's Sky" });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              { title: "No Man's Sky PS5 Upgrade", amount: 9.9, isFree: false, url: 'upgrade' },
              { title: "No Man's Sky PS5", amount: 39.9, isFree: false, url: 'ps5' },
              { title: "No Man's Sky", amount: 29.9, isFree: false, url: 'base' }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=991003&platformIgdbId=167&title=No%20Man%27s%20Sky&includeCandidates=1'
  });
  assert.equal(response.statusCode, 200);
  const titles = readCandidateTitles(parseJsonRecord(response.body));
  assert.equal(titles[0], "No Man's Sky");
  assert.equal(titles[1], "No Man's Sky PS5");
  assert.equal(titles[2], "No Man's Sky PS5 Upgrade");

  await app.close();
});

void test('PSPrices does not strip platform words when they are part of canonical title', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('991004', 130, { title: 'Nintendo Switch Sports' });

  await registerPsPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: 'Nintendo Switch Sports Deluxe Edition',
                amount: 59.9,
                isFree: false,
                url: 'deluxe'
              },
              { title: 'Nintendo Switch Sports', amount: 49.9, isFree: false, url: 'base' }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/psprices/prices?igdbGameId=991004&platformIgdbId=130&title=Nintendo%20Switch%20Sports&includeCandidates=1'
  });
  assert.equal(response.statusCode, 200);
  const titles = readCandidateTitles(parseJsonRecord(response.body));
  assert.equal(titles[0], 'Nintendo Switch Sports');
  assert.equal(titles[1], 'Nintendo Switch Sports Deluxe Edition');

  await app.close();
});
