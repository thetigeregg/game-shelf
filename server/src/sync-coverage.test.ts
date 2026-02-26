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

class CoverageSyncClient {
  constructor(private readonly store: InMemorySyncStore) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
      return { rows: [] };
    }

    if (normalized.startsWith('select result from idempotency_keys')) {
      const opId = String(params[0] ?? '');
      const result = this.store.idempotency.get(opId);
      return { rows: result ? ([{ result }] as T[]) : [] };
    }

    if (normalized.startsWith('insert into idempotency_keys')) {
      const opId = String(params[0] ?? '');
      const result = JSON.parse(String(params[1] ?? '{}')) as SyncPushResult;
      this.store.idempotency.set(opId, result);
      return { rows: [] };
    }

    if (normalized.startsWith('insert into sync_events')) {
      const eventId = this.store.syncEvents.length + 1;
      this.store.syncEvents.push({
        event_id: eventId,
        entity_type: params[0] as SyncEventRow['entity_type'],
        operation: params[2] as SyncEventRow['operation'],
        payload: JSON.parse(String(params[3] ?? '{}')),
        server_timestamp: new Date().toISOString()
      });
      return { rows: [] };
    }

    if (normalized.startsWith('select coalesce(max(event_id), 0) as event_id from sync_events')) {
      return { rows: [{ event_id: this.store.syncEvents.length }] as T[] };
    }

    if (normalized.startsWith('insert into tags (id, payload')) {
      return { rows: [{ id: Number(params[0]) }] as T[] };
    }

    if (normalized.startsWith('insert into tags (payload')) {
      this.store.tagIdSeq += 1;
      return { rows: [{ id: this.store.tagIdSeq }] as T[] };
    }

    if (normalized.startsWith('insert into views (id, payload')) {
      return { rows: [{ id: Number(params[0]) }] as T[] };
    }

    if (normalized.startsWith('insert into views (payload')) {
      this.store.viewIdSeq += 1;
      return { rows: [{ id: this.store.viewIdSeq }] as T[] };
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
      return { rows: [] };
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

  async connect(): Promise<CoverageSyncClient> {
    return this.client;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (
      normalized.startsWith(
        'select event_id, entity_type, operation, payload, server_timestamp from sync_events'
      )
    ) {
      const cursor = Number(params[0] ?? 0);
      const rows = this.store.syncEvents.filter((row) => row.event_id > cursor).slice(0, 1000);
      return { rows: rows as T[] };
    }

    return { rows: [] };
  }
}

async function createSyncApp(pool: CoverageSyncPool): Promise<FastifyInstance> {
  const app = fastifyFactory({ logger: false });
  await registerSyncRoutes(app, pool as never);
  return app;
}

test('sync push returns 400 for invalid operations payloads', async () => {
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

test('sync push covers applied, duplicate, and failed operation statuses', async () => {
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
  const body = response.json() as { results: SyncPushResult[]; cursor: string };
  assert.equal(body.results.length, 3);
  assert.equal(body.results[0]?.status, 'duplicate');
  assert.equal(body.results[1]?.status, 'applied');
  assert.equal(body.results[2]?.status, 'failed');
  assert.equal(body.cursor, '1');
  assert.equal(pool.store.idempotency.has('bad-1'), true);

  await app.close();
});

test('sync push covers tag/view/setting upsert and delete branches', async () => {
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
  const body = response.json() as { results: SyncPushResult[] };
  assert.equal(
    body.results.every((result) => result.status === 'applied'),
    true
  );
  assert.equal(pool.store.syncEvents.length, 8);

  await app.close();
});

test('sync pull normalizes cursor and returns changes with last event id cursor', async () => {
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
  const invalidBody = invalidCursor.json() as { cursor: string; changes: unknown[] };
  assert.equal(invalidBody.cursor, '2');
  assert.equal(invalidBody.changes.length, 2);

  const withCursor = await app.inject({
    method: 'POST',
    url: '/v1/sync/pull',
    payload: { cursor: '2' }
  });
  const withCursorBody = withCursor.json() as { cursor: string; changes: unknown[] };
  assert.equal(withCursorBody.cursor, '2');
  assert.equal(withCursorBody.changes.length, 0);

  await app.close();
});

test('sync push returns cursor 0 when only duplicate operations are processed', async () => {
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
  const body = response.json() as { cursor: string; results: SyncPushResult[] };
  assert.equal(body.cursor, '0');
  assert.equal(body.results[0]?.status, 'duplicate');

  await app.close();
});

test('sync push handles non-Error failures with default failed message', async () => {
  const pool = new CoverageSyncPool();
  const originalQuery = pool.client.query.bind(pool.client);
  pool.client.query = async <T>(sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.startsWith('insert into games')) {
      throw 'non-error-failure';
    }
    return originalQuery<T>(sql, params);
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
  const body = response.json() as { results: SyncPushResult[] };
  assert.equal(body.results[0]?.status, 'failed');
  assert.equal(body.results[0]?.message, 'Failed to apply operation.');

  await app.close();
});

test('sync push rollback path returns 500 when transaction-level query fails', async () => {
  const pool = new CoverageSyncPool();
  const originalQuery = pool.client.query.bind(pool.client);
  pool.client.query = async <T>(sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized === 'commit') {
      throw new Error('commit failed');
    }
    return originalQuery<T>(sql, params);
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
  assert.equal(response.json().error, 'Unable to process sync push.');

  await app.close();
});

test('sync push rejects invalid entity type and operation type entries', async () => {
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
