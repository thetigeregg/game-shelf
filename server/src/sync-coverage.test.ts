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
  games = new Map<string, Record<string, unknown>>();
  tags: { id: number; payload: Record<string, unknown> }[] = [];
  views: { id: number; payload: Record<string, unknown> }[] = [];
  settings: { setting_key: string; setting_value: string }[] = [];
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

type SyncSnapshotResponseBody = {
  games: Record<string, unknown>[];
  gamesNextAfter: string | null;
  tags: Record<string, unknown>[];
  views: Record<string, unknown>[];
  settings: { key: string; value: string }[];
  latestEventId: string;
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
        server_timestamp: new Date().toISOString(),
      });
      return Promise.resolve({ rows: [] });
    }

    if (
      normalized.startsWith(
        'select payload from games where igdb_game_id = $1 and platform_igdb_id = $2 limit 1'
      )
    ) {
      const igdbGameId = toPrimitiveString(params[0]);
      const platformIgdbId = toPrimitiveString(params[1]);
      const payload = this.store.games.get(this.gameKey(igdbGameId, platformIgdbId));
      return Promise.resolve({ rows: payload ? [{ payload }] : [] });
    }

    if (normalized.startsWith('select coalesce(max(event_id), 0) as event_id from sync_events')) {
      const maxEventId = this.store.syncEvents.reduce(
        (max, row) => (row.event_id > max ? row.event_id : max),
        0
      );
      return Promise.resolve({ rows: [{ event_id: String(maxEventId) }] });
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
      normalized.startsWith('delete from games') ||
      normalized.startsWith('delete from tags') ||
      normalized.startsWith('delete from views') ||
      normalized.startsWith('insert into settings') ||
      normalized.startsWith('delete from settings')
    ) {
      return Promise.resolve({ rows: [] });
    }

    if (normalized.startsWith('insert into games')) {
      const payload = JSON.parse(toPrimitiveString(params[2]) || '{}') as Record<string, unknown>;
      this.store.games.set(
        this.gameKey(toPrimitiveString(params[0]), toPrimitiveString(params[1])),
        payload
      );
      return Promise.resolve({ rows: [{ payload }] });
    }

    throw new Error(`Unexpected SQL: ${sql}`);
  }

  release(): void {
    // No-op for tests.
  }

  private gameKey(igdbGameId: string, platformIgdbId: string): string {
    return `${igdbGameId}::${platformIgdbId}`;
  }
}

class CoverageSyncPool {
  readonly store = new InMemorySyncStore();
  readonly client = new CoverageSyncClient(this.store);
  maxEventIdOverride: unknown = undefined;
  maxEventIdQueryCount = 0;

  connect(): Promise<CoverageSyncClient> {
    return Promise.resolve(this.client);
  }

  query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('select coalesce(max(event_id), 0) as event_id from sync_events')) {
      this.maxEventIdQueryCount += 1;
      if (this.maxEventIdOverride !== undefined) {
        return Promise.resolve({ rows: [{ event_id: this.maxEventIdOverride }] });
      }
      const maxEventId = this.store.syncEvents.reduce(
        (max, row) => (row.event_id > max ? row.event_id : max),
        0
      );
      return Promise.resolve({ rows: [{ event_id: String(maxEventId) }] });
    }

    if (
      normalized.startsWith(
        'select event_id, entity_type, operation, payload, server_timestamp from sync_events'
      )
    ) {
      const cursor = Number(params[0] ?? 0);
      const rows = this.store.syncEvents.filter((row) => row.event_id > cursor).slice(0, 1000);
      return Promise.resolve({ rows });
    }

    if (normalized.startsWith('select igdb_game_id, platform_igdb_id, payload from games')) {
      return Promise.resolve({ rows: this.listSnapshotGames(params) });
    }

    if (normalized.startsWith('select id, payload from tags order by id asc')) {
      return Promise.resolve({ rows: this.store.tags });
    }

    if (normalized.startsWith('select id, payload from views order by id asc')) {
      return Promise.resolve({ rows: this.store.views });
    }

    if (
      normalized.startsWith(
        'select setting_key, setting_value from settings order by setting_key asc'
      )
    ) {
      return Promise.resolve({ rows: this.store.settings });
    }

    return Promise.resolve({ rows: [] });
  }

  private listSnapshotGames(params: unknown[]): {
    igdb_game_id: string;
    platform_igdb_id: number;
    payload: Record<string, unknown>;
  }[] {
    const fetchLimit = Number(params[0] ?? 501);
    const gamesAfter =
      params.length >= 3
        ? {
            igdbGameId: toPrimitiveString(params[1]),
            platformIgdbId: Number(params[2]),
          }
        : null;

    const rows = [...this.store.games.entries()]
      .map(([key, payload]) => {
        const [igdbGameId, platformIgdbIdRaw] = key.split('::');
        return {
          igdb_game_id: igdbGameId,
          platform_igdb_id: Number(platformIgdbIdRaw),
          payload,
        };
      })
      .filter((row) => row.payload['listType'] !== 'discovery')
      .sort((left, right) => {
        const igdbCompare = left.igdb_game_id.localeCompare(right.igdb_game_id);
        if (igdbCompare !== 0) {
          return igdbCompare;
        }
        return left.platform_igdb_id - right.platform_igdb_id;
      })
      .filter((row) => {
        if (gamesAfter === null) {
          return true;
        }

        const igdbCompare = row.igdb_game_id.localeCompare(gamesAfter.igdbGameId);
        if (igdbCompare !== 0) {
          return igdbCompare > 0;
        }

        return row.platform_igdb_id > gamesAfter.platformIgdbId;
      });

    return rows.slice(0, fetchLimit);
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
    payload: { operations: 'invalid' },
  });
  assert.equal(notArray.statusCode, 400);

  const invalidEntry = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: { operations: [{ opId: '', entityType: 'game', operation: 'upsert' }] },
  });
  assert.equal(invalidEntry.statusCode, 400);

  await app.close();
});

void test('sync push covers applied, duplicate, and failed operation statuses', async () => {
  const pool = new CoverageSyncPool();
  pool.store.idempotency.set('dup-1', {
    opId: 'dup-1',
    status: 'applied',
    normalizedPayload: { reused: true },
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
          clientTimestamp: '2026-01-01T00:00:00.000Z',
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
            notes: 'Line 1\r\nLine 2',
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          opId: 'bad-1',
          entityType: 'game',
          operation: 'delete',
          payload: { igdbGameId: 'missing-platform' },
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  });

  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPushResponseBody;
  assert.equal(body.results.length, 3);
  assert.equal(body.results[0]?.status, 'duplicate');
  assert.equal(body.results[1]?.status, 'applied');
  assert.equal(body.results[2]?.status, 'failed');
  assert.equal(body.cursor, '1');
  assert.equal(pool.store.idempotency.has('bad-1'), true);
  const storedGame = pool.store.games.get('2::130');
  assert.equal(storedGame.igdbGameId, '2');
  assert.equal(storedGame.platformIgdbId, 130);
  assert.equal(storedGame.title, 'Game');
  assert.equal(storedGame.platform, 'Switch');
  assert.equal(storedGame.notes, 'Line 1\nLine 2');

  await app.close();
});

void test('sync push accepts http/https custom cover urls in normalized payloads', async () => {
  const pool = new CoverageSyncPool();
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'cover-url-1',
          entityType: 'game',
          operation: 'upsert',
          payload: {
            igdbGameId: '5',
            platformIgdbId: 130,
            title: 'Cover Game',
            platform: 'Switch',
            customCoverUrl: ' https://images.example.com/custom-cover.jpg ',
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(
    pool.store.games.get('5::130').customCoverUrl,
    'https://images.example.com/custom-cover.jpg'
  );

  await app.close();
});

void test('sync push rejects credentialed http/https custom cover urls', async () => {
  const pool = new CoverageSyncPool();
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    payload: {
      operations: [
        {
          opId: 'cover-url-credentials-1',
          entityType: 'game',
          operation: 'upsert',
          payload: {
            igdbGameId: '6',
            platformIgdbId: 130,
            title: 'Credentialed Cover Game',
            platform: 'Switch',
            customCoverUrl: 'https://user:pass@images.example.com/custom-cover.jpg',
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(pool.store.games.get('6::130').customCoverUrl, null);

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
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          opId: 'tag-auto',
          entityType: 'tag',
          operation: 'upsert',
          payload: { name: 'Auto Tag' },
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          opId: 'tag-delete',
          entityType: 'tag',
          operation: 'delete',
          payload: { id: 7 },
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          opId: 'view-explicit',
          entityType: 'view',
          operation: 'upsert',
          payload: { id: 9, name: 'Saved' },
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          opId: 'view-auto',
          entityType: 'view',
          operation: 'upsert',
          payload: { name: 'Auto View' },
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          opId: 'view-delete',
          entityType: 'view',
          operation: 'delete',
          payload: { id: 9 },
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          opId: 'setting-upsert',
          entityType: 'setting',
          operation: 'upsert',
          payload: { key: 'k', value: 123 },
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          opId: 'setting-delete',
          entityType: 'setting',
          operation: 'delete',
          payload: { key: 'k' },
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
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
      server_timestamp: '2026-01-01T00:00:00.000Z',
    },
    {
      event_id: 2,
      entity_type: 'view',
      operation: 'delete',
      payload: { id: 2 },
      server_timestamp: '2026-01-01T00:01:00.000Z',
    }
  );
  const app = await createSyncApp(pool);

  const invalidCursor = await app.inject({
    method: 'POST',
    url: '/v1/sync/pull',
    payload: { cursor: 'invalid' },
  });
  assert.equal(invalidCursor.statusCode, 200);
  const invalidBody = parseJson(invalidCursor.body) as SyncPullResponseBody;
  assert.equal(invalidBody.cursor, '2');
  assert.equal(invalidBody.changes.length, 2);

  const unsafeLargeCursor = await app.inject({
    method: 'POST',
    url: '/v1/sync/pull',
    payload: { cursor: '9007199254740993' },
  });
  assert.equal(unsafeLargeCursor.statusCode, 200);
  const unsafeLargeBody = parseJson(unsafeLargeCursor.body) as SyncPullResponseBody;
  assert.equal(unsafeLargeBody.cursor, '2');
  assert.equal(unsafeLargeBody.changes.length, 0);

  const withCursor = await app.inject({
    method: 'POST',
    url: '/v1/sync/pull',
    payload: { cursor: '2' },
  });
  const withCursorBody = parseJson(withCursor.body) as SyncPullResponseBody;
  assert.equal(withCursorBody.cursor, '2');
  assert.equal(withCursorBody.changes.length, 0);

  await app.close();
});

void test('sync pull clamps cursor above latest event id', async () => {
  const pool = new CoverageSyncPool();
  pool.store.syncEvents.push({
    event_id: 1,
    entity_type: 'setting',
    operation: 'upsert',
    payload: { key: 'k', value: 'v' },
    server_timestamp: '2026-01-01T00:00:00.000Z',
  });
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/pull',
    payload: { cursor: '999999' },
  });
  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPullResponseBody;
  assert.equal(body.cursor, '1');
  assert.equal(body.changes.length, 0);
  assert.equal(pool.maxEventIdQueryCount, 1);

  await app.close();
});

void test('sync pull does not query max(event_id) on steady-state caught-up cursor', async () => {
  const pool = new CoverageSyncPool();
  pool.store.syncEvents.push({
    event_id: 1,
    entity_type: 'setting',
    operation: 'upsert',
    payload: { key: 'k-1', value: 'v1' },
    server_timestamp: '2026-01-01T00:00:00.000Z',
  });
  const app = await createSyncApp(pool);

  const first = await app.inject({
    method: 'POST',
    url: '/v1/sync/pull',
    payload: { cursor: '0' },
  });
  assert.equal(first.statusCode, 200);
  const firstBody = parseJson(first.body) as SyncPullResponseBody;
  assert.equal(firstBody.cursor, '1');
  assert.equal(firstBody.changes.length, 1);

  const second = await app.inject({
    method: 'POST',
    url: '/v1/sync/pull',
    payload: { cursor: '1' },
  });
  assert.equal(second.statusCode, 200);
  const secondBody = parseJson(second.body) as SyncPullResponseBody;
  assert.equal(secondBody.cursor, '1');
  assert.equal(secondBody.changes.length, 0);
  assert.equal(pool.maxEventIdQueryCount, 0);

  await app.close();
});

void test('sync pull supports numeric cursor payloads', async () => {
  const pool = new CoverageSyncPool();
  pool.store.syncEvents.push({
    event_id: 1,
    entity_type: 'tag',
    operation: 'upsert',
    payload: { id: 1 },
    server_timestamp: '2026-01-01T00:00:00.000Z',
  });
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/pull',
    payload: { cursor: 0 },
  });
  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPullResponseBody;
  assert.equal(body.cursor, '1');
  assert.equal(body.changes.length, 1);

  await app.close();
});

void test('sync pull clamps with valid bigint latest cursor', async () => {
  const pool = new CoverageSyncPool();
  pool.maxEventIdOverride = 5n;
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/pull',
    payload: { cursor: '999999' },
  });
  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPullResponseBody;
  assert.equal(body.cursor, '5');
  assert.equal(body.changes.length, 0);

  await app.close();
});

void test('sync pull treats out-of-range bigint latest cursor as zero', async () => {
  const pool = new CoverageSyncPool();
  pool.maxEventIdOverride = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/pull',
    payload: { cursor: '999999' },
  });
  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPullResponseBody;
  assert.equal(body.cursor, '0');
  assert.equal(body.changes.length, 0);

  await app.close();
});

void test('sync push returns cursor 0 when only duplicate operations are processed', async () => {
  const pool = new CoverageSyncPool();
  pool.store.idempotency.set('dup-only', {
    opId: 'dup-only',
    status: 'applied',
    normalizedPayload: { preseeded: true },
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
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
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
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
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
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
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
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
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
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
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
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          opId: 'array-payload',
          entityType: 'game',
          operation: 'upsert',
          payload: [1, 2, 3],
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
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
            platform: 'PC',
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
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
            mobygamesGameId: '999',
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z',
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
            mobygamesGameId: 0,
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z',
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
            mobygamesGameId: null,
          },
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
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
          payload: { igdbGameId: '60', platformIgdbId: 130, title: 'NoTs', platform: 'PC' },
        },
      ],
    },
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
    payload: { operations: [] },
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
          clientTimestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  });

  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncPushResponseBody;
  assert.equal(body.results[0]?.status, 'failed');

  await app.close();
});

void test('sync snapshot returns empty library with latest event cursor', async () => {
  const pool = new CoverageSyncPool();
  pool.store.syncEvents.push({
    event_id: 42,
    entity_type: 'setting',
    operation: 'upsert',
    payload: { key: 'theme', value: 'dark' },
    server_timestamp: '2026-01-01T00:00:00.000Z',
  });
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/snapshot',
    payload: {},
  });

  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncSnapshotResponseBody;
  assert.equal(body.games.length, 0);
  assert.equal(body.gamesNextAfter, null);
  assert.equal(body.latestEventId, '42');

  await app.close();
});

void test('sync snapshot excludes discovery games and paginates by identity cursor', async () => {
  const pool = new CoverageSyncPool();
  pool.store.games.set('1::10', {
    igdbGameId: '1',
    platformIgdbId: 10,
    title: 'Alpha',
    listType: 'collection',
  });
  pool.store.games.set('2::20', {
    igdbGameId: '2',
    platformIgdbId: 20,
    title: 'Beta',
    listType: 'wishlist',
  });
  pool.store.games.set('3::30', {
    igdbGameId: '3',
    platformIgdbId: 30,
    title: 'Discovery',
    listType: 'discovery',
  });
  pool.store.tags.push({ id: 5, payload: { name: 'RPG', color: '#fff' } });
  pool.store.views.push({ id: 9, payload: { name: 'All', listType: 'collection' } });
  pool.store.settings.push({ setting_key: 'theme', setting_value: 'dark' });
  pool.store.syncEvents.push({
    event_id: 7,
    entity_type: 'game',
    operation: 'upsert',
    payload: {},
    server_timestamp: '2026-01-01T00:00:00.000Z',
  });
  const app = await createSyncApp(pool);

  const first = await app.inject({
    method: 'POST',
    url: '/v1/sync/snapshot',
    payload: { gamesLimit: 1 },
  });
  assert.equal(first.statusCode, 200);
  const firstBody = parseJson(first.body) as SyncSnapshotResponseBody;
  assert.equal(firstBody.games.length, 1);
  assert.equal(firstBody.games[0]?.title, 'Alpha');
  assert.equal(firstBody.gamesNextAfter, '1::10');
  assert.equal(firstBody.tags.length, 1);
  assert.equal(firstBody.views.length, 1);
  assert.equal(firstBody.settings.length, 1);
  assert.equal(firstBody.latestEventId, '7');

  const second = await app.inject({
    method: 'POST',
    url: '/v1/sync/snapshot',
    payload: { gamesAfter: '1::10', gamesLimit: 1 },
  });
  assert.equal(second.statusCode, 200);
  const secondBody = parseJson(second.body) as SyncSnapshotResponseBody;
  assert.equal(secondBody.games.length, 1);
  assert.equal(secondBody.games[0]?.title, 'Beta');
  assert.equal(secondBody.gamesNextAfter, null);
  assert.equal(secondBody.tags.length, 0);
  assert.equal(secondBody.views.length, 0);
  assert.equal(secondBody.settings.length, 0);

  await app.close();
});

void test('sync snapshot returns empty library with latest event cursor', async () => {
  const pool = new CoverageSyncPool();
  pool.store.syncEvents.push({
    event_id: 42,
    entity_type: 'setting',
    operation: 'upsert',
    payload: { key: 'theme', value: 'dark' },
    server_timestamp: '2026-01-01T00:00:00.000Z',
  });
  const app = await createSyncApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/sync/snapshot',
    payload: {},
  });

  assert.equal(response.statusCode, 200);
  const body = parseJson(response.body) as SyncSnapshotResponseBody;
  assert.equal(body.games.length, 0);
  assert.equal(body.gamesNextAfter, null);
  assert.equal(body.latestEventId, '42');

  await app.close();
});

void test('sync snapshot excludes discovery games and paginates by identity cursor', async () => {
  const pool = new CoverageSyncPool();
  pool.store.games.set('1::10', {
    igdbGameId: '1',
    platformIgdbId: 10,
    title: 'Alpha',
    listType: 'collection',
  });
  pool.store.games.set('2::20', {
    igdbGameId: '2',
    platformIgdbId: 20,
    title: 'Beta',
    listType: 'wishlist',
  });
  pool.store.games.set('3::30', {
    igdbGameId: '3',
    platformIgdbId: 30,
    title: 'Discovery',
    listType: 'discovery',
  });
  pool.store.tags.push({ id: 5, payload: { name: 'RPG', color: '#fff' } });
  pool.store.views.push({ id: 9, payload: { name: 'All', listType: 'collection' } });
  pool.store.settings.push({ setting_key: 'theme', setting_value: 'dark' });
  pool.store.syncEvents.push({
    event_id: 7,
    entity_type: 'game',
    operation: 'upsert',
    payload: {},
    server_timestamp: '2026-01-01T00:00:00.000Z',
  });
  const app = await createSyncApp(pool);

  const first = await app.inject({
    method: 'POST',
    url: '/v1/sync/snapshot',
    payload: { gamesLimit: 1 },
  });
  assert.equal(first.statusCode, 200);
  const firstBody = parseJson(first.body) as SyncSnapshotResponseBody;
  assert.equal(firstBody.games.length, 1);
  assert.equal(firstBody.games[0]?.title, 'Alpha');
  assert.equal(firstBody.gamesNextAfter, '1::10');
  assert.equal(firstBody.tags.length, 1);
  assert.equal(firstBody.views.length, 1);
  assert.equal(firstBody.settings.length, 1);
  assert.equal(firstBody.latestEventId, '7');

  const second = await app.inject({
    method: 'POST',
    url: '/v1/sync/snapshot',
    payload: { gamesAfter: '1::10', gamesLimit: 1 },
  });
  assert.equal(second.statusCode, 200);
  const secondBody = parseJson(second.body) as SyncSnapshotResponseBody;
  assert.equal(secondBody.games.length, 1);
  assert.equal(secondBody.games[0]?.title, 'Beta');
  assert.equal(secondBody.gamesNextAfter, null);
  assert.equal(secondBody.tags.length, 0);
  assert.equal(secondBody.views.length, 0);
  assert.equal(secondBody.settings.length, 0);

  await app.close();
});
