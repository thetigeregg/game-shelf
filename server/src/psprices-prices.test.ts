import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerPsPricesRoute } from './psprices-prices.js';

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
  assert.equal(match['score'], 80);
  assert.equal(match['confidence'], 'high');

  const bestPrice = body['bestPrice'] as Record<string, unknown>;
  assert.equal(bestPrice['title'], 'Fire Emblem Engage Standard Edition');
  assert.equal(bestPrice['amount'], 59.9);

  const candidates = body['candidates'] as Array<Record<string, unknown>>;
  assert.equal(candidates[0]?.['title'], 'Fire Emblem Engage Standard Edition');
  assert.equal(candidates[0]?.['score'], 80);

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
  assert.equal(match['score'], 73.33);
  assert.equal(match['confidence'], 'high');

  const bestPrice = body['bestPrice'] as Record<string, unknown>;
  assert.equal(bestPrice['title'], 'Nioh 2 Complete Edition');
  assert.equal(bestPrice['amount'], 59.9);

  await app.close();
});
