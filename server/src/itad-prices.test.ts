import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { __itadPriceTestables, registerItadPricesRoute } from './itad-prices.js';

interface GameRow {
  payload: Record<string, unknown>;
}

class GamePoolMock {
  private readonly rowsByIdentity = new Map<string, GameRow>();

  seed(igdbGameId: string, platformIgdbId: number, payload: Record<string, unknown>): void {
    this.rowsByIdentity.set(`${igdbGameId}::${String(platformIgdbId)}`, { payload });
  }

  getPayload(igdbGameId: string, platformIgdbId: number): Record<string, unknown> | null {
    return this.rowsByIdentity.get(`${igdbGameId}::${String(platformIgdbId)}`)?.payload ?? null;
  }

  query(sql: string, params: unknown[]): Promise<{ rows: GameRow[] }> {
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
      return Promise.resolve({ rows: [] });
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

void test('ITAD route returns unsupported_platform for non-Windows IGDB platform', async () => {
  const app = Fastify();
  let fetchCalls = 0;
  const pool = new GamePoolMock();

  await registerItadPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: () => {
      fetchCalls += 1;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/itad/prices?igdbGameId=1&platformIgdbId=48'
  });
  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'unsupported_platform');
  assert.equal(Array.isArray(body['deals']), true);
  assert.equal((body['deals'] as unknown[]).length, 0);
  assert.equal(fetchCalls, 0);

  await app.close();
});

void test('ITAD route resolves by Steam app ID and converts Steam EUR prices to CHF', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  __itadPriceTestables.clearExchangeRateDailyCache();
  pool.seed('1520', 6, {
    title: 'Example Game',
    steamAppId: 570
  });

  const calls: string[] = [];
  await registerItadPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: (input, init) => {
      const url =
        input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
      calls.push(url.href);

      if (url.pathname === '/lookup/id/shop/61/v1') {
        assert.equal(url.searchParams.has('key'), true);
        assert.equal(typeof init?.body, 'string');
        assert.equal((init?.body as string).includes('app/570'), true);
        return Promise.resolve(
          new Response(JSON.stringify({ 'app/570': '018d937e-e9ab-70f4-bd05-1db7a138eb39' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }

      if (url.pathname === '/games/prices/v3') {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: '018d937e-e9ab-70f4-bd05-1db7a138eb39',
                historyLow: { all: null, y1: null, m3: null },
                deals: [
                  {
                    shop: { id: 61, name: 'Steam' },
                    platforms: [{ id: 1, name: 'Windows' }],
                    price: { amount: 9.99, currency: 'CHF' },
                    regular: { amount: 19.99, currency: 'CHF' }
                  },
                  {
                    shop: { id: 35, name: 'GOG' },
                    platforms: [{ id: 2, name: 'Mac' }],
                    price: { amount: 8.99, currency: 'CHF' }
                  },
                  {
                    shop: { id: 61, name: 'Steam' },
                    platforms: [{ id: 1, name: 'Windows' }],
                    price: { amount: 8.49, currency: 'EUR' }
                  }
                ]
              }
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        );
      }

      if (url.pathname === '/v6/latest/EUR') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              conversion_rates: {
                CHF: 0.95
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
    url: '/v1/itad/prices?igdbGameId=1520&platformIgdbId=6'
  });
  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');
  assert.equal(body['matchStrategy'], 'steam');
  assert.equal(body['steamAppId'], 570);
  assert.equal(Array.isArray(body['deals']), true);
  assert.equal((body['deals'] as unknown[]).length, 1);
  assert.equal(typeof body['bestPrice'], 'object');
  assert.equal((body['bestPrice'] as Record<string, unknown>)['amount'], 8.07);
  assert.equal((body['bestPrice'] as Record<string, unknown>)['regularAmount'], null);
  assert.equal((body['bestPrice'] as Record<string, unknown>)['currency'], 'CHF');
  assert.equal(
    calls.some((url) => url.includes('/lookup/id/title/v1')),
    false
  );
  assert.equal(
    calls.some((url) => url.includes('/games/prices/v3') && url.includes('shops=61')),
    true
  );
  const persisted = pool.getPayload('1520', 6);
  assert.ok(persisted);
  assert.equal(persisted['itadGameId'], '018d937e-e9ab-70f4-bd05-1db7a138eb39');
  assert.equal(persisted['itadBestPriceAmount'], 8.07);
  assert.equal(persisted['itadBestPriceRegularAmount'], null);
  assert.equal(persisted['itadBestPriceCurrency'], 'CHF');
  assert.equal(persisted['itadPriceShopId'], 61);

  await app.close();
});

void test('ITAD route falls back to title lookup when steam lookup misses', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  __itadPriceTestables.clearExchangeRateDailyCache();
  pool.seed('999', 6, {
    title: 'Doom',
    steamAppId: 999999
  });

  await registerItadPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: (input, init) => {
      const url =
        input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);

      if (url.pathname === '/lookup/id/shop/61/v1') {
        return Promise.resolve(
          new Response(JSON.stringify({ 'app/999999': null }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }

      if (url.pathname === '/lookup/id/title/v1') {
        assert.equal(typeof init?.body, 'string');
        assert.equal((init?.body as string).includes('Doom'), true);
        return Promise.resolve(
          new Response(JSON.stringify({ Doom: '018d937e-e9ce-718b-9715-111f50820ed4' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }

      if (url.pathname === '/games/prices/v3') {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: '018d937e-e9ce-718b-9715-111f50820ed4',
                historyLow: { all: null, y1: null, m3: null },
                deals: [
                  {
                    shop: { id: 61, name: 'Steam' },
                    platforms: [{ id: 1, name: 'Windows' }],
                    price: { amount: 5.49, currency: 'EUR' },
                    regular: { amountInt: 1999, currency: 'EUR' }
                  }
                ]
              }
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        );
      }

      if (url.pathname === '/v6/latest/EUR') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              conversion_rates: {
                CHF: 0.95
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
    url: '/v1/itad/prices?igdbGameId=999&platformIgdbId=6'
  });
  assert.equal(response.statusCode, 200);
  const body = parseJsonRecord(response.body);
  assert.equal(body['status'], 'ok');
  assert.equal(body['matchStrategy'], 'title');
  assert.equal(body['itadGameId'], '018d937e-e9ce-718b-9715-111f50820ed4');
  assert.equal((body['bestPrice'] as Record<string, unknown>)['amount'], 5.22);
  assert.equal((body['bestPrice'] as Record<string, unknown>)['regularAmount'], 18.99);
  assert.equal((body['bestPrice'] as Record<string, unknown>)['currency'], 'CHF');
  const persisted = pool.getPayload('999', 6);
  assert.ok(persisted);
  assert.equal(persisted['itadGameId'], '018d937e-e9ce-718b-9715-111f50820ed4');
  assert.equal(persisted['itadBestPriceAmount'], 5.22);
  assert.equal(persisted['itadBestPriceRegularAmount'], 18.99);
  assert.equal(persisted['itadBestPriceCurrency'], 'CHF');

  await app.close();
});

void test('ITAD route caches FX conversion rate once per UTC day', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  __itadPriceTestables.clearExchangeRateDailyCache();
  pool.seed('120', 6, {
    title: 'Cache Test',
    steamAppId: 120
  });

  let fxCalls = 0;
  await registerItadPricesRoute(app, pool as unknown as Pool, {
    nowProvider: () => Date.parse('2026-03-10T12:00:00.000Z'),
    fetchImpl: (input) => {
      const url =
        input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);

      if (url.pathname === '/lookup/id/shop/61/v1') {
        return Promise.resolve(
          new Response(JSON.stringify({ 'app/120': '018d937e-e9ab-70f4-bd05-1db7a138eb39' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }

      if (url.pathname === '/games/prices/v3') {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: '018d937e-e9ab-70f4-bd05-1db7a138eb39',
                historyLow: null,
                deals: [
                  {
                    shop: { id: 61, name: 'Steam' },
                    platforms: [{ id: 1, name: 'Windows' }],
                    price: { amount: 10, currency: 'EUR' }
                  }
                ]
              }
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        );
      }

      if (url.pathname === '/v6/latest/EUR') {
        fxCalls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              conversion_rates: {
                CHF: 1
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

  const first = await app.inject({
    method: 'GET',
    url: '/v1/itad/prices?igdbGameId=120&platformIgdbId=6'
  });
  assert.equal(first.statusCode, 200);

  const second = await app.inject({
    method: 'GET',
    url: '/v1/itad/prices?igdbGameId=120&platformIgdbId=6'
  });
  assert.equal(second.statusCode, 200);
  assert.equal(fxCalls, 1);

  await app.close();
});

void test('ITAD route returns 502 on upstream failure', async () => {
  const app = Fastify();
  const pool = new GamePoolMock();
  pool.seed('77', 6, {
    title: 'Failure Test',
    steamAppId: 570
  });

  await registerItadPricesRoute(app, pool as unknown as Pool, {
    fetchImpl: (input) => {
      const url =
        input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/lookup/id/shop/61/v1') {
        return Promise.resolve(new Response('bad gateway', { status: 502 }));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/itad/prices?igdbGameId=77&platformIgdbId=6'
  });
  assert.equal(response.statusCode, 502);
  const body = parseJsonRecord(response.body);
  assert.equal(body['error'], 'Unable to fetch ITAD prices.');

  await app.close();
});
