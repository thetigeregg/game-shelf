import assert from 'node:assert/strict';
import test from 'node:test';
import fastifyFactory, { FastifyInstance } from 'fastify';
import { registerSyncRoutes } from './sync.js';

class FakeSyncClient {
  private latestEventId = 0;

  query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('select result from idempotency_keys')) {
      return Promise.resolve({ rows: [] });
    }

    if (normalized.startsWith('insert into games')) {
      const payload = parsePayload(params[2]);
      return Promise.resolve({ rows: [{ payload }] });
    }

    if (normalized.startsWith('insert into sync_events')) {
      this.latestEventId += 1;
      return Promise.resolve({ rows: [] });
    }

    if (normalized.startsWith('insert into idempotency_keys')) {
      return Promise.resolve({ rows: [] });
    }

    if (normalized.startsWith('select coalesce(max(event_id), 0) as event_id from sync_events')) {
      return Promise.resolve({ rows: [{ event_id: this.latestEventId }] });
    }

    if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
      return Promise.resolve({ rows: [] });
    }

    throw new Error(`Unexpected SQL: ${sql}`);
  }

  release(): void {
    // No-op for test client.
  }
}

class FakePool {
  private readonly client = new FakeSyncClient();

  connect(): Promise<FakeSyncClient> {
    return Promise.resolve(this.client);
  }

  query(): Promise<{ rows: unknown[] }> {
    return Promise.resolve({ rows: [] });
  }
}

async function createSyncApp(): Promise<FastifyInstance> {
  const app = fastifyFactory({ logger: false });
  await registerSyncRoutes(app, new FakePool() as never);
  return app;
}

void test('sync push normalizes game notes line endings', async () => {
  const app = await createSyncApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'op-1',
          entityType: 'game',
          operation: 'upsert',
          payload: {
            igdbGameId: '123',
            platformIgdbId: 130,
            title: 'Game',
            platform: 'Switch',
            listType: 'collection',
            notes: 'Line 1\r\nLine 2'
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    results: Array<{ normalizedPayload?: { notes?: string } }>;
  };
  assert.equal(body.results[0]?.normalizedPayload?.notes, 'Line 1\nLine 2');

  await app.close();
});

void test('sync push normalizes unified pricing fields in game payload', async () => {
  const app = await createSyncApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'op-pricing-normalize-1',
          entityType: 'game',
          operation: 'upsert',
          payload: {
            igdbGameId: '124',
            platformIgdbId: 130,
            title: 'Game',
            platform: 'Switch',
            listType: 'wishlist',
            priceSource: 'invalid-source',
            priceFetchedAt: '   ',
            priceAmount: '19.995',
            priceCurrency: ' chf ',
            priceRegularAmount: -1,
            priceDiscountPercent: '120',
            priceIsFree: 'true',
            priceUrl: '//store.example.com/game/124'
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    results: Array<{ normalizedPayload?: Record<string, unknown> }>;
  };
  const normalizedPayload = body.results[0]?.normalizedPayload ?? {};
  assert.equal(normalizedPayload['priceSource'], null);
  assert.equal(normalizedPayload['priceFetchedAt'], null);
  assert.equal(normalizedPayload['priceAmount'], 20);
  assert.equal(normalizedPayload['priceCurrency'], 'CHF');
  assert.equal(normalizedPayload['priceRegularAmount'], null);
  assert.equal(normalizedPayload['priceDiscountPercent'], null);
  assert.equal(normalizedPayload['priceIsFree'], true);
  assert.equal(normalizedPayload['priceUrl'], 'https://store.example.com/game/124');
  assert.equal(Object.prototype.hasOwnProperty.call(normalizedPayload, 'steamAppId'), false);

  await app.close();
});

void test('sync push only includes steamAppId when provided in payload', async () => {
  const app = await createSyncApp();

  const omittedResponse = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'op-steam-app-omitted-1',
          entityType: 'game',
          operation: 'upsert',
          payload: {
            igdbGameId: '125',
            platformIgdbId: 130,
            title: 'Game',
            platform: 'Switch',
            listType: 'collection'
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(omittedResponse.statusCode, 200);
  const omittedBody = JSON.parse(omittedResponse.body) as {
    results: Array<{ normalizedPayload?: Record<string, unknown> }>;
  };
  const omittedPayload = omittedBody.results[0]?.normalizedPayload ?? {};
  assert.equal(Object.prototype.hasOwnProperty.call(omittedPayload, 'steamAppId'), false);

  const explicitNullResponse = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'op-steam-app-null-1',
          entityType: 'game',
          operation: 'upsert',
          payload: {
            igdbGameId: '126',
            platformIgdbId: 130,
            title: 'Game',
            platform: 'Switch',
            listType: 'collection',
            steamAppId: null
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(explicitNullResponse.statusCode, 200);
  const explicitNullBody = JSON.parse(explicitNullResponse.body) as {
    results: Array<{ normalizedPayload?: Record<string, unknown> }>;
  };
  const explicitNullPayload = explicitNullBody.results[0]?.normalizedPayload ?? {};
  assert.equal(Object.prototype.hasOwnProperty.call(explicitNullPayload, 'steamAppId'), true);
  assert.equal(explicitNullPayload['steamAppId'], null);

  await app.close();
});

void test('sync push returns merged game payload from upsert result', async () => {
  class MergeAwareSyncClient extends FakeSyncClient {
    override query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.startsWith('insert into games')) {
        const payload = parsePayload(params[2]);
        return Promise.resolve({
          rows: [
            {
              payload: {
                ...payload,
                themes: ['Action'],
                keywords: ['aliens'],
                screenshots: [{ id: 1, imageId: 'abc' }],
                videos: [{ id: 2, videoId: 'vid' }]
              }
            }
          ]
        });
      }
      return super.query(sql, params);
    }
  }

  class MergeAwarePool extends FakePool {
    override connect(): Promise<MergeAwareSyncClient> {
      return Promise.resolve(new MergeAwareSyncClient());
    }
  }

  const app = fastifyFactory({ logger: false });
  await registerSyncRoutes(app, new MergeAwarePool() as never);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'op-merge-1',
          entityType: 'game',
          operation: 'upsert',
          payload: {
            igdbGameId: '123',
            platformIgdbId: 130,
            title: 'Game',
            platform: 'Switch',
            listType: 'collection'
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    results: Array<{ normalizedPayload?: Record<string, unknown> }>;
  };
  assert.deepEqual(body.results[0]?.normalizedPayload?.['themes'], ['Action']);
  assert.deepEqual(body.results[0]?.normalizedPayload?.['keywords'], ['aliens']);

  await app.close();
});

void test('sync game upsert SQL preserves unified pricing fields on conflict', async () => {
  let capturedInsertSql = '';

  class SqlCaptureSyncClient extends FakeSyncClient {
    override query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.startsWith('insert into games')) {
        capturedInsertSql = sql;
      }
      return super.query(sql, params);
    }
  }

  class SqlCapturePool extends FakePool {
    override connect(): Promise<SqlCaptureSyncClient> {
      return Promise.resolve(new SqlCaptureSyncClient());
    }
  }

  const app = fastifyFactory({ logger: false });
  await registerSyncRoutes(app, new SqlCapturePool() as never);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'op-sql-pricing-1',
          entityType: 'game',
          operation: 'upsert',
          payload: {
            igdbGameId: '321',
            platformIgdbId: 6,
            title: 'Pricing SQL Check',
            platform: 'PC',
            listType: 'wishlist'
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(capturedInsertSql.includes("'priceSource'"), true);
  assert.equal(capturedInsertSql.includes("'priceFetchedAt'"), true);
  assert.equal(capturedInsertSql.includes("'priceAmount'"), true);
  assert.equal(capturedInsertSql.includes("'priceCurrency'"), true);
  assert.equal(capturedInsertSql.includes("'priceRegularAmount'"), true);
  assert.equal(capturedInsertSql.includes("'priceDiscountPercent'"), true);
  assert.equal(capturedInsertSql.includes("'priceIsFree'"), true);
  assert.equal(capturedInsertSql.includes("'priceUrl'"), true);
  assert.equal(capturedInsertSql.includes("'psPricesMatchQueryTitle'"), true);
  assert.equal(capturedInsertSql.includes("'psPricesMatchTitle'"), true);
  assert.equal(capturedInsertSql.includes("'psPricesCandidates'"), true);
  assert.equal(capturedInsertSql.includes("'psPricesUrl'"), true);
  assert.equal(capturedInsertSql.includes("'psPricesPriceAmount'"), true);
  assert.equal(capturedInsertSql.includes("'psPricesDiscountPercent'"), true);

  await app.close();
});

function parsePayload(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>;
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}
