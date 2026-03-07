import assert from 'node:assert/strict';
import test from 'node:test';
import fastifyFactory from 'fastify';
import { registerBackgroundJobRoutes } from './background-jobs-routes.js';

class PoolMock {
  private queryCount = 0;

  query(): Promise<{ rows: unknown[]; rowCount: number }> {
    this.queryCount += 1;

    if (this.queryCount === 1) {
      return Promise.resolve({
        rows: [
          {
            job_type: 'recommendations_rebuild',
            pending_count: '2',
            running_count: '1',
            failed_count: '0',
            succeeded_count: '5',
            oldest_pending_seconds: '100.2'
          }
        ],
        rowCount: 1
      });
    }

    if (this.queryCount === 2) {
      return Promise.resolve({
        rows: [
          {
            id: 4,
            job_type: 'release_monitor_game',
            attempts: 5,
            max_attempts: 5,
            available_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
            finished_at: '2026-01-01T00:01:00.000Z',
            last_error: 'failed',
            payload: { igdb_game_id: '100' }
          }
        ],
        rowCount: 1
      });
    }

    return Promise.resolve({
      rows: [{ id: 4 }, { id: 5 }],
      rowCount: 2
    });
  }
}

void test('background jobs routes expose stats, failed list, and replay', async () => {
  const app = fastifyFactory({ logger: false });
  registerBackgroundJobRoutes(app, new PoolMock() as never);

  const statsResponse = await app.inject({
    method: 'GET',
    url: '/v1/background-jobs/stats'
  });
  assert.equal(statsResponse.statusCode, 200);
  const statsBody = JSON.parse(statsResponse.body) as {
    totals: { pending: number };
    byType: Array<{ jobType: string }>;
  };
  assert.equal(statsBody.totals.pending, 2);
  assert.equal(statsBody.byType[0]?.jobType, 'recommendations_rebuild');

  const failedResponse = await app.inject({
    method: 'GET',
    url: '/v1/background-jobs/failed?jobType=release_monitor_game&limit=10'
  });
  assert.equal(failedResponse.statusCode, 200);
  const failedBody = JSON.parse(failedResponse.body) as { count: number };
  assert.equal(failedBody.count, 1);

  const replayResponse = await app.inject({
    method: 'POST',
    url: '/v1/background-jobs/replay',
    payload: { jobType: 'release_monitor_game', limit: 10 }
  });
  assert.equal(replayResponse.statusCode, 200);
  const replayBody = JSON.parse(replayResponse.body) as { requeuedCount: number };
  assert.equal(replayBody.requeuedCount, 2);

  await app.close();
});
