import assert from 'node:assert/strict';
import test from 'node:test';
import fastifyFactory, { FastifyInstance } from 'fastify';
import { registerSyncRoutes } from './sync.js';

class FakeSyncClient {
  private latestEventId = 0;

  query(sql: string): Promise<{ rows: unknown[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('select result from idempotency_keys')) {
      return Promise.resolve({ rows: [] });
    }

    if (normalized.startsWith('insert into games')) {
      return Promise.resolve({ rows: [] });
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
