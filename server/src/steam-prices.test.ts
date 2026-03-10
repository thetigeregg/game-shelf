import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerSteamPricesRoute } from './steam-prices.js';

interface GameRow {
  payload: Record<string, unknown>;
}

class GamePoolMock {
  private readonly rowsByIdentity = new Map<string, GameRow>();
  private syncEventInsertCount = 0;

  seed(igdbGameId: string, platformIgdbId: number, payload: Record<string, unknown>): void {
    this.rowsByIdentity.set(`${igdbGameId}::${String(platformIgdbId)}`, { payload });
  }

  getPayload(igdbGameId: string, platformIgdbId: number): Record<string, unknown> | null {
    return this.rowsByIdentity.get(`${igdbGameId}::${String(platformIgdbId)}`)?.payload ?? null;
  }

  getSyncEventInsertCount(): number {
    return this.syncEventInsertCount;
  }

  query(sql: string, params: unknown[]): Promise<{ rows: GameRow[]; rowCount?: number }> {
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

    if (normalized.startsWith('update games set payload = $3::jsonb, updated_at = now()')) {
      const igdbGameId = typeof params[0] === 'string' ? params[0] : '';
      const platformIgdbId =
        typeof params[1] === 'number' && Number.isInteger(params[1]) ? params[1] : 0;
      const payloadRaw = typeof params[2] === 'string' ? params[2] : '{}';
      const parsed = JSON.parse(payloadRaw) as Record<string, unknown>;
      this.rowsByIdentity.set(`${igdbGameId}::${String(platformIgdbId)}`, { payload: parsed });
      return Promise.resolve({ rows: [{ payload: parsed }], rowCount: 1 });
    }

    if (
      normalized.startsWith(
        'insert into sync_events (entity_type, entity_key, operation, payload, server_timestamp)'
      )
    ) {
      this.syncEventInsertCount += 1;
      return Promise.resolve({ rows: [], rowCount: 1 });
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

void test('Steam route returns unsupported_platform for non-Windows IGDB platform', async () => {
  const app = Fastify();
  let fetchCalls = 0;
  const pool = new GamePoolMock();

  await registerSteamPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () => {
      fetchCalls += 1;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/steam/prices?igdbGameId=1&platformIgdbId=48'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'unsupported_platform');
  assert.equal(fetchCalls, 0);

  await app.close();
});

void test('Steam route returns missing_steam_app_id when payload is not enriched', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('960', 6, { title: 'GTA IV' });

  await registerSteamPricesRoute(app, pool as unknown as Pool);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/steam/prices?igdbGameId=960&platformIgdbId=6'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'missing_steam_app_id');
  assert.equal(body['steamAppId'], null);

  await app.close();
});

void test('Steam route accepts query steamAppId when game row is not present', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  let fetchCalls = 0;

  await registerSteamPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            '570': {
              success: true,
              data: {
                is_free: false,
                price_overview: {
                  currency: 'CHF',
                  initial: 2999,
                  final: 1999,
                  discount_percent: 33
                }
              }
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
    url: '/v1/steam/prices?igdbGameId=960&platformIgdbId=6&steamAppId=570&cc=CH'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');
  assert.equal(body['steamAppId'], 570);
  assert.equal(body['cached'], false);
  assert.equal(fetchCalls, 1);
  assert.equal(pool.getPayload('960', 6), null);

  await app.close();
});

void test('Steam route fetches appdetails with cc and persists normalized price fields', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('960', 6, {
    title: 'Grand Theft Auto IV',
    steamAppId: 204100
  });

  const requests: string[] = [];

  await registerSteamPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: (input) => {
      const url =
        input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
      requests.push(url.href);

      if (url.pathname === '/api/appdetails') {
        assert.equal(url.searchParams.get('appids'), '204100');
        assert.equal(url.searchParams.get('cc'), 'ch');
        return Promise.resolve(
          new Response(
            JSON.stringify({
              '204100': {
                success: true,
                data: {
                  is_free: false,
                  price_overview: {
                    currency: 'CHF',
                    initial: 6999,
                    final: 4999,
                    discount_percent: 29
                  }
                }
              }
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        );
      }

      return Promise.resolve(new Response('{}', { status: 404 }));
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/steam/prices?igdbGameId=960&platformIgdbId=6&cc=CH'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-steam-price-cache'], 'MISS');
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');
  assert.equal(body['steamAppId'], 204100);
  assert.equal(body['cached'], false);

  const bestPrice = body['bestPrice'] as Record<string, unknown>;
  assert.equal(bestPrice['amount'], 49.99);
  assert.equal(bestPrice['initialAmount'], 69.99);
  assert.equal(bestPrice['discountPercent'], 29);
  assert.equal(bestPrice['currency'], 'CHF');

  const persisted = pool.getPayload('960', 6);
  assert.ok(persisted);
  assert.equal(persisted['steamPriceCountry'], 'CH');
  assert.equal(persisted['steamPriceAmount'], 49.99);
  assert.equal(persisted['steamPriceInitialAmount'], 69.99);
  assert.equal(persisted['steamPriceCurrency'], 'CHF');
  assert.equal(persisted['steamPriceDiscountPercent'], 29);
  assert.equal(persisted['steamPriceSource'], 'steam_store');
  assert.equal(persisted['priceSource'], 'steam_store');
  assert.equal(persisted['priceAmount'], 49.99);
  assert.equal(persisted['priceRegularAmount'], 69.99);
  assert.equal(persisted['priceCurrency'], 'CHF');
  assert.equal(persisted['priceDiscountPercent'], 29);
  assert.equal(persisted['priceIsFree'], false);
  assert.equal(persisted['priceUrl'], 'https://store.steampowered.com/app/204100');
  assert.equal(pool.getSyncEventInsertCount(), 1);
  assert.equal(Array.isArray(requests), true);
  assert.equal(requests.length, 1);

  await app.close();
});

void test('Steam route suppresses sync event writes for discovery rows', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('960', 6, {
    listType: 'discovery',
    title: 'Grand Theft Auto IV',
    steamAppId: 204100
  });

  await registerSteamPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            '204100': {
              success: true,
              data: {
                is_free: false,
                price_overview: {
                  currency: 'CHF',
                  initial: 6999,
                  final: 4999,
                  discount_percent: 29
                }
              }
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
    url: '/v1/steam/prices?igdbGameId=960&platformIgdbId=6&cc=CH'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(pool.getSyncEventInsertCount(), 0);

  await app.close();
});

void test('Steam route uses cached value when fresh for matching cc', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('1520', 6, {
    steamAppId: 570,
    steamPriceCountry: 'CH',
    steamPriceFetchedAt: '2026-03-10T08:00:00.000Z',
    steamPriceAmount: 19.99,
    steamPriceInitialAmount: 39.99,
    steamPriceCurrency: 'CHF',
    steamPriceDiscountPercent: 50,
    steamPriceIsFree: false,
    steamPriceUrl: 'https://store.steampowered.com/app/570'
  });

  let fetchCalls = 0;
  await registerSteamPricesRoute(app, pool as unknown as Pool, {
    nowProvider: () => Date.parse('2026-03-10T12:00:00.000Z'),
    fetchImpl: () => {
      fetchCalls += 1;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/steam/prices?igdbGameId=1520&platformIgdbId=6&cc=ch'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-steam-price-cache'], 'HIT_FRESH');
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');
  assert.equal(body['cached'], true);
  assert.equal(fetchCalls, 0);

  await app.close();
});

void test('Steam route serves stale cache and schedules revalidation', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('77', 6, {
    steamAppId: 730,
    steamPriceCountry: 'DE',
    steamPriceFetchedAt: '2026-03-08T08:00:00.000Z',
    steamPriceAmount: 9.99,
    steamPriceCurrency: 'EUR'
  });

  const queuedPayloads: Record<string, unknown>[] = [];
  let fetchCalls = 0;
  await registerSteamPricesRoute(app, pool as unknown as Pool, {
    nowProvider: () => Date.parse('2026-03-10T12:00:00.000Z'),
    enqueueRevalidationJob: (payload) => {
      queuedPayloads.push(payload as unknown as Record<string, unknown>);
    },
    fetchImpl: (input) => {
      fetchCalls += 1;
      const url =
        input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
      assert.equal(url.searchParams.get('cc'), 'de');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            '730': {
              success: true,
              data: {
                is_free: false,
                price_overview: {
                  currency: 'EUR',
                  initial: 1299,
                  final: 999,
                  discount_percent: 23
                }
              }
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
    url: '/v1/steam/prices?igdbGameId=77&platformIgdbId=6&cc=de'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-steam-price-cache'], 'HIT_STALE');
  assert.equal(response.headers['x-gameshelf-steam-price-revalidate'], 'scheduled');
  const body = parseJsonRecord(response.body);
  assert.equal(body['cached'], true);
  assert.equal(fetchCalls, 0);
  assert.equal(queuedPayloads.length, 1);

  await app.close();
});

void test('Steam route refetches when cache country differs', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('77', 6, {
    steamAppId: 730,
    steamPriceCountry: 'CH',
    steamPriceFetchedAt: '2026-03-10T11:00:00.000Z',
    steamPriceAmount: 5,
    steamPriceCurrency: 'CHF'
  });

  let fetchCalls = 0;
  await registerSteamPricesRoute(app, pool as unknown as Pool, {
    nowProvider: () => Date.parse('2026-03-10T12:00:00.000Z'),
    fetchImpl: (input) => {
      fetchCalls += 1;
      const url =
        input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
      assert.equal(url.searchParams.get('cc'), 'de');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            '730': {
              success: true,
              data: {
                is_free: false,
                price_overview: {
                  currency: 'EUR',
                  initial: 1299,
                  final: 999,
                  discount_percent: 23
                }
              }
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
    url: '/v1/steam/prices?igdbGameId=77&platformIgdbId=6&cc=de'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-steam-price-cache'], 'MISS');
  const body = parseJsonRecord(response.body);
  assert.equal(body['cached'], false);
  assert.equal(fetchCalls, 1);
  await app.close();
});

void test('Steam route returns cached unavailable snapshot without upstream fetch', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('100', 6, {
    steamAppId: 1000,
    steamPriceCountry: 'CH',
    steamPriceFetchedAt: '2026-03-10T09:00:00.000Z',
    steamPriceAmount: null,
    steamPriceCurrency: null,
    steamPriceIsFree: null
  });

  let fetchCalls = 0;
  await registerSteamPricesRoute(app, pool as unknown as Pool, {
    nowProvider: () => Date.parse('2026-03-10T12:00:00.000Z'),
    fetchImpl: () => {
      fetchCalls += 1;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/steam/prices?igdbGameId=100&platformIgdbId=6&cc=ch'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'unavailable');
  assert.equal(body['cached'], true);
  assert.equal(fetchCalls, 0);

  await app.close();
});

void test('Steam route preserves existing unified fields when upstream is unavailable', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('77', 6, {
    steamAppId: 730,
    priceSource: 'steam_store',
    priceAmount: 9.99,
    priceCurrency: 'EUR',
    priceRegularAmount: 12.99,
    priceDiscountPercent: 23,
    priceIsFree: false,
    priceUrl: 'https://store.steampowered.com/app/730',
    steamPriceAmount: 9.99,
    steamPriceCurrency: 'EUR'
  });

  await registerSteamPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            '730': {
              success: false
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
    url: '/v1/steam/prices?igdbGameId=77&platformIgdbId=6'
  });

  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'unavailable');

  const persisted = pool.getPayload('77', 6);
  assert.ok(persisted);
  assert.equal(persisted['priceSource'], 'steam_store');
  assert.equal(persisted['priceAmount'], 9.99);
  assert.equal(persisted['priceCurrency'], 'EUR');
  assert.equal(persisted['priceRegularAmount'], 12.99);

  await app.close();
});

void test('Steam route returns 502 on Steam upstream failure', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('960', 6, { steamAppId: 204100 });

  await registerSteamPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () => Promise.resolve(new Response('bad gateway', { status: 502 }))
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/steam/prices?igdbGameId=960&platformIgdbId=6'
  });

  assert.equal(response.statusCode, 502);
  const body = parseJsonRecord(response.body);
  assert.equal(body['error'], 'Unable to fetch Steam prices.');

  await app.close();
});
