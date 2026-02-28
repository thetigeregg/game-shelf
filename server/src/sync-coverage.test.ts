import assert from 'node:assert/strict';
import test from 'node:test';
import fastifyFactory, { FastifyInstance } from 'fastify';
import { registerSyncRoutes } from './sync.js';
import type { SyncPushResult } from './types.js';

type SyncEventRow = {
  event_id: number;
  entity_type: 'game' | 'tag' | 'view' | 'setting';
  operation: 'upsert' | 'delete';
  payload: unknown;
  server_timestamp: string;
};

class InMemorySyncStore {
  idempotency = new Map<string, SyncPushResult>();
  syncEvents: SyncEventRow[] = [];
  tagIdSeq = 100;
  viewIdSeq = 200;
}

type SyncPushResponseBody = {
  cursor: string;
  results: Array<{ status?: string; message?: string }>;
};

type SyncPullResponseBody = {
  cursor: string;
  changes: unknown[];
};

function parseJson(body: string): unknown {
  return JSON.parse(body) as unknown;
}

function toPrimitiveString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

class CoverageSyncClient {
  constructor(private readonly store: InMemorySyncStore) {}

  query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
      return Promise.resolve({ rows: [] });
    }

    if (normalized.startsWith('select result from idempotency_keys')) {
      const opId = toPrimitiveString(params[0]);
      const result = this.store.idempotency.get(opId);
      return Promise.resolve({ rows: result ? [{ result }] : [] });
    }

    if (normalized.startsWith('insert into idempotency_keys')) {
      const opId = toPrimitiveString(params[0]);
      const result = JSON.parse(toPrimitiveString(params[1]) || '{}') as SyncPushResult;
      this.store.idempotency.set(opId, result);
      return Promise.resolve({ rows: [] });
    }

    if (normalized.startsWith('insert into sync_events')) {
      const eventId = this.store.syncEvents.length + 1;
      this.store.syncEvents.push({
        event_id: eventId,
        entity_type: params[0] as SyncEventRow['entity_type'],
        operation: params[2] as SyncEventRow['operation'],
        payload: JSON.parse(toPrimitiveString(params[3]) || '{}'),
        server_timestamp: new Date().toISOString()
      });
      return Promise.resolve({ rows: [] });
    }

    if (normalized.startsWith('select coalesce(max(event_id), 0) as event_id from sync_events')) {
      return Promise.resolve({ rows: [{ event_id: this.store.syncEvents.length }] });
    }

    if (normalized.startsWith('insert into tags (id, payload')) {
      return Promise.resolve({ rows: [{ id: Number(params[0]) }] });
    }

    if (normalized.startsWith('insert into tags (payload')) {
      this.store.tagIdSeq += 1;
      return Promise.resolve({ rows: [{ id: this.store.tagIdSeq }] });
    }

    if (normalized.startsWith('insert into views (id, payload')) {
      return Promise.resolve({ rows: [{ id: Number(params[0]) }] });
    }

    if (normalized.startsWith('insert into views (payload')) {
      this.store.viewIdSeq += 1;
      return Promise.resolve({ rows: [{ id: this.store.viewIdSeq }] });
    }

    if (
      normalized.startsWith('update tags set payload') ||
      normalized.startsWith('update views set payload') ||
      normalized.startsWith('insert into games') ||
      normalized.startsWith('delete from games') ||
      normalized.startsWith('delete from tags') ||
      normalized.startsWith('delete from views') ||
      normalized.startsWith('insert into settings') ||
      normalized.startsWith('delete from settings')
    ) {
      return Promise.resolve({ rows: [] });
    }

    throw new Error(`Unexpected SQL: ${sql}`);
  }

  release(): void {
    // No-op for tests.
  }
}

class CoverageSyncPool {
  readonly store = new InMemorySyncStore();
  readonly client = new CoverageSyncClient(this.store);

  connect(): Promise<CoverageSyncClient> {
    return Promise.resolve(this.client);
  }

  query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (
      normalized.startsWith(
        'select event_id, entity_type, operation, payload, server_timestamp from sync_events'
      )
    ) {
      const cursor = Number(params[0] ?? 0);
      const rows = this.store.syncEvents.filter((row) => row.event_id > cursor).slice(0, 1000);
      return Promise.resolve({ rows });
    }

    return Promise.resolve({ rows: [] });
  }
}

async function createSyncApp(pool: CoverageSyncPool): Promise<FastifyInstance> {
  const app = fastifyFactory({ logger: false });
  await registerSyncRoutes(app, pool as never);
  return app;
}

void test('sync push returns 400 for invalid operations payloads', async () => {
  const pool = new CoverageSyncPool();
  const app = await createSyncApp(pool);

  const notArray = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: { operations: 'invalid' }
  });
  assert.equal(notArray.statusCode, 400);

  const invalidEntry = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: { operations: [{ opId: '', entityType: 'game', operation: 'upsert' }] }
  });
  assert.equal(invalidEntry.statusCode, 400);

  await app.close();
});

void test('sync push covers applied, duplicate, and failed operation statuses', async () => {
  const pool = new CoverageSyncPool();
  pool.store.idempotency.set('dup-1', {
    opId: 'dup-1',
    status: 'applied',
    normalizedPayload: { reused: true }
  });
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'dup-1',
          entityType: 'game',
          operation: 'upsert',
          payload: { igdbGameId: '1', platformIgdbId: 130 },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        },
        {
          opId: 'ok-1',
          entityType: 'game',
          operation: 'upsert',
          payload: {
            igdbGameId: '2',
            platformIgdbId: 130,
            title: 'Game',
            platform: 'Switch',
            notes: 'Line 1\r\nLine 2'
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        },
        {
          opId: 'bad-1',
          entityType: 'game',
          operation: 'delete',
          payload: { igdbGameId: 'missing-platform' },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPushResponseBody;
  assert.equal(body.results.length, 3);
  assert.equal(body.results[0]?.status, 'duplicate');
  assert.equal(body.results[1]?.status, 'applied');
  assert.equal(body.results[2]?.status, 'failed');
  assert.equal(body.cursor, '1');
  assert.equal(pool.store.idempotency.has('bad-1'), true);

  await app.close();
});

void test('sync push covers tag/view/setting upsert and delete branches', async () => {
  const pool = new CoverageSyncPool();
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'tag-explicit',
          entityType: 'tag',
          operation: 'upsert',
          payload: { id: 7, name: 'Tagged' },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        },
        {
          opId: 'tag-auto',
          entityType: 'tag',
          operation: 'upsert',
          payload: { name: 'Auto Tag' },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        },
        {
          opId: 'tag-delete',
          entityType: 'tag',
          operation: 'delete',
          payload: { id: 7 },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        },
        {
          opId: 'view-explicit',
          entityType: 'view',
          operation: 'upsert',
          payload: { id: 9, name: 'Saved' },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        },
        {
          opId: 'view-auto',
          entityType: 'view',
          operation: 'upsert',
          payload: { name: 'Auto View' },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        },
        {
          opId: 'view-delete',
          entityType: 'view',
          operation: 'delete',
          payload: { id: 9 },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        },
        {
          opId: 'setting-upsert',
          entityType: 'setting',
          operation: 'upsert',
          payload: { key: 'k', value: 123 },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        },
        {
          opId: 'setting-delete',
          entityType: 'setting',
          operation: 'delete',
          payload: { key: 'k' },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPushResponseBody;
  assert.equal(
    body.results.every((result) => result.status === 'applied'),
    true
  );
  assert.equal(pool.store.syncEvents.length, 8);

  await app.close();
});

void test('sync pull normalizes cursor and returns changes with last event id cursor', async () => {
  const pool = new CoverageSyncPool();
  pool.store.syncEvents.push(
    {
      event_id: 1,
      entity_type: 'tag',
      operation: 'upsert',
      payload: { id: 1 },
      server_timestamp: '2026-01-01T00:00:00.000Z'
    },
    {
      event_id: 2,
      entity_type: 'view',
      operation: 'delete',
      payload: { id: 2 },
      server_timestamp: '2026-01-01T00:01:00.000Z'
    }
  );
  const app = await createSyncApp(pool);

  const invalidCursor = await app.inject({
    method: 'POST',
    url: '/v1/sync/pull',
    payload: { cursor: 'invalid' }
  });
  assert.equal(invalidCursor.statusCode, 200);
  const invalidBody = parseJson(invalidCursor.body) as SyncPullResponseBody;
  assert.equal(invalidBody.cursor, '2');
  assert.equal(invalidBody.changes.length, 2);

  const withCursor = await app.inject({
    method: 'POST',
    url: '/v1/sync/pull',
    payload: { cursor: '2' }
  });
  const withCursorBody = parseJson(withCursor.body) as SyncPullResponseBody;
  assert.equal(withCursorBody.cursor, '2');
  assert.equal(withCursorBody.changes.length, 0);

  await app.close();
});

void test('sync push returns cursor 0 when only duplicate operations are processed', async () => {
  const pool = new CoverageSyncPool();
  pool.store.idempotency.set('dup-only', {
    opId: 'dup-only',
    status: 'applied',
    normalizedPayload: { preseeded: true }
  });
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'dup-only',
          entityType: 'game',
          operation: 'upsert',
          payload: { igdbGameId: '1', platformIgdbId: 130 },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPushResponseBody;
  assert.equal(body.cursor, '0');
  assert.equal(body.results[0]?.status, 'duplicate');

  await app.close();
});

void test('sync push handles non-Error failures with default failed message', async () => {
  const pool = new CoverageSyncPool();
  const originalQuery = pool.client.query.bind(pool.client);
  pool.client.query = (sql: string, params?: unknown[]) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.startsWith('insert into games')) {
      const nonErrorFailure = 'non-error-failure' as unknown as Error;
      return Promise.reject(nonErrorFailure);
    }
    return originalQuery(sql, params ?? []);
  };
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'non-error-op',
          entityType: 'game',
          operation: 'upsert',
          payload: { igdbGameId: '1', platformIgdbId: 130, title: 'G', platform: 'P' },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPushResponseBody;
  assert.equal(body.results[0]?.status, 'failed');
  assert.equal(body.results[0]?.message, 'Failed to apply operation.');

  await app.close();
});

void test('sync push rollback path returns 500 when transaction-level query fails', async () => {
  const pool = new CoverageSyncPool();
  const originalQuery = pool.client.query.bind(pool.client);
  pool.client.query = (sql: string, params?: unknown[]) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized === 'commit') {
      throw new Error('commit failed');
    }
    return originalQuery(sql, params ?? []);
  };
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'rollback-op',
          entityType: 'game',
          operation: 'upsert',
          payload: { igdbGameId: '55', platformIgdbId: 130, title: 'T', platform: 'P' },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 500);
  assert.equal(
    (parseJson(response.body) as { error?: string }).error,
    'Unable to process sync push.'
  );

  await app.close();
});

void test('sync push rejects invalid entity type and operation type entries', async () => {
  const pool = new CoverageSyncPool();
  const app = await createSyncApp(pool);

  const badEntityType = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'bad-entity',
          entityType: 'unknown',
          operation: 'upsert',
          payload: {},
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });
  assert.equal(badEntityType.statusCode, 400);

  const badOperationType = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'bad-op',
          entityType: 'game',
          operation: 'patch',
          payload: {},
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });
  assert.equal(badOperationType.statusCode, 400);

  await app.close();
});

void test('sync push handles null and array payloads as failed operations', async () => {
  const pool = new CoverageSyncPool();
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'null-payload',
          entityType: 'game',
          operation: 'upsert',
          payload: null,
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        },
        {
          opId: 'array-payload',
          entityType: 'game',
          operation: 'upsert',
          payload: [1, 2, 3],
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPushResponseBody;
  assert.equal(body.results[0]?.status, 'failed');
  assert.equal(body.results[1]?.status, 'failed');
  assert.match(body.results[0]?.message ?? '', /invalid operation payload/i);

  await app.close();
});

void test('sync push handles string platformIgdbId in game payload', async () => {
  const pool = new CoverageSyncPool();
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'str-platform',
          entityType: 'game',
          operation: 'upsert',
          payload: {
            igdbGameId: '42',
            platformIgdbId: '130',
            title: 'StrPlatform',
            platform: 'PC'
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPushResponseBody;
  assert.equal(body.results[0]?.status, 'applied');

  await app.close();
});

void test('sync push handles mobyScore and mobygamesGameId edge cases', async () => {
  const pool = new CoverageSyncPool();
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'moby-score-string',
          entityType: 'game',
          operation: 'upsert',
          payload: {
            igdbGameId: '50',
            platformIgdbId: 130,
            title: 'ScoreGame',
            platform: 'PC',
            mobyScore: '7.5',
            mobygamesGameId: '999'
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        },
        {
          opId: 'moby-score-out-of-range',
          entityType: 'game',
          operation: 'upsert',
          payload: {
            igdbGameId: '51',
            platformIgdbId: 130,
            title: 'OutOfRange',
            platform: 'PC',
            mobyScore: 11,
            mobygamesGameId: 0
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        },
        {
          opId: 'moby-score-null',
          entityType: 'game',
          operation: 'upsert',
          payload: {
            igdbGameId: '52',
            platformIgdbId: 130,
            title: 'NullScore',
            platform: 'PC',
            mobyScore: null,
            mobygamesGameId: null
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPushResponseBody;
  assert.equal(body.results[0]?.status, 'applied');
  assert.equal(body.results[1]?.status, 'applied');
  assert.equal(body.results[2]?.status, 'applied');

  await app.close();
});

void test('sync push handles operation without clientTimestamp', async () => {
  const pool = new CoverageSyncPool();
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'no-timestamp',
          entityType: 'game',
          operation: 'upsert',
          payload: { igdbGameId: '60', platformIgdbId: 130, title: 'NoTs', platform: 'PC' }
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPushResponseBody;
  assert.equal(body.results[0]?.status, 'applied');

  await app.close();
});

void test('sync push handles empty operations array', async () => {
  const pool = new CoverageSyncPool();
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: { operations: [] }
  });

  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPushResponseBody;
  assert.equal(body.results.length, 0);
  assert.equal(body.cursor, '0');

  await app.close();
});

void test('sync push handles invalid float platformIgdbId', async () => {
  const pool = new CoverageSyncPool();
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'float-platform',
          entityType: 'game',
          operation: 'upsert',
          payload: { igdbGameId: '70', platformIgdbId: 1.5 },
          clientTimestamp: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPushResponseBody;
  assert.equal(body.results[0]?.status, 'failed');

  await app.close();
});
