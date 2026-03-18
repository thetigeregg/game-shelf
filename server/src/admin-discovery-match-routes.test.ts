import assert from 'node:assert/strict';
import test from 'node:test';
import fastifyFactory from 'fastify';
import type { Pool } from 'pg';
import { registerAdminDiscoveryMatchRoutes } from './admin-discovery-match-routes.js';
import { config } from './config.js';

interface SeedRow {
  igdbGameId: string;
  platformIgdbId: number;
  payload: Record<string, unknown>;
}

class PoolMock {
  private readonly rows = new Map<string, SeedRow>();
  private readonly backgroundJobs = new Map<string, number>();
  private nextBackgroundJobId = 1000;

  seed(row: SeedRow): void {
    this.rows.set(this.key(row.igdbGameId, row.platformIgdbId), structuredClone(row));
  }

  readPayload(igdbGameId: string, platformIgdbId: number): Record<string, unknown> | null {
    return this.rows.get(this.key(igdbGameId, platformIgdbId))?.payload ?? null;
  }

  query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (
      normalized.startsWith(
        "select igdb_game_id, platform_igdb_id, payload from games where coalesce(payload->>'listtype', '') = 'discovery'"
      )
    ) {
      const search = typeof params[0] === 'string' ? params[0] : null;
      const limit = typeof params[1] === 'number' ? params[1] : 50;
      const rows = [...this.rows.values()]
        .filter((row) => row.payload['listType'] === 'discovery')
        .filter((row) => {
          if (!search) {
            return true;
          }
          const title = typeof row.payload['title'] === 'string' ? row.payload['title'] : '';
          return title.toLowerCase().includes(search);
        })
        .slice(0, limit)
        .map((row) => ({
          igdb_game_id: row.igdbGameId,
          platform_igdb_id: row.platformIgdbId,
          payload: structuredClone(row.payload),
        }));
      return Promise.resolve({ rows, rowCount: rows.length });
    }

    if (
      normalized.startsWith(
        'select igdb_game_id, platform_igdb_id, payload from games where igdb_game_id = $1'
      )
    ) {
      const igdbGameId = typeof params[0] === 'string' ? params[0] : '';
      const hasPlatformFilter = typeof params[1] === 'number';

      if (!hasPlatformFilter) {
        const rows = [...this.rows.values()]
          .filter((row) => row.igdbGameId === igdbGameId)
          .filter((row) => row.payload['listType'] === 'discovery')
          .sort((left, right) => left.platformIgdbId - right.platformIgdbId)
          .map((row) => ({
            igdb_game_id: row.igdbGameId,
            platform_igdb_id: row.platformIgdbId,
            payload: structuredClone(row.payload),
          }));

        return Promise.resolve({ rows, rowCount: rows.length });
      }

      const platformIgdbId = params[1] as number;
      const row = this.rows.get(this.key(igdbGameId, platformIgdbId));
      if (!row || row.payload['listType'] !== 'discovery') {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({
        rows: [
          {
            igdb_game_id: row.igdbGameId,
            platform_igdb_id: row.platformIgdbId,
            payload: structuredClone(row.payload),
          },
        ],
        rowCount: 1,
      });
    }

    if (
      normalized.startsWith(
        'with current_row as ( select payload from games where igdb_game_id = $1'
      )
    ) {
      const igdbGameId = typeof params[0] === 'string' ? params[0] : '';
      const platformIgdbId = typeof params[1] === 'number' ? params[1] : 0;
      const nextPayload = JSON.parse(typeof params[2] === 'string' ? params[2] : '{}') as Record<
        string,
        unknown
      >;
      const key = this.key(igdbGameId, platformIgdbId);
      const existing = this.rows.get(key);
      if (!existing || existing.payload['listType'] !== 'discovery') {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (JSON.stringify(existing.payload) === JSON.stringify(nextPayload)) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      this.rows.set(key, {
        igdbGameId,
        platformIgdbId,
        payload: nextPayload,
      });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (normalized.startsWith('insert into background_jobs')) {
      const dedupeKey =
        typeof params[1] === 'string' && params[1].trim().length > 0 ? params[1] : null;
      if (dedupeKey !== null) {
        const existingId = this.backgroundJobs.get(dedupeKey);
        if (typeof existingId === 'number') {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        const id = this.nextBackgroundJobId;
        this.nextBackgroundJobId += 1;
        this.backgroundJobs.set(dedupeKey, id);
        return Promise.resolve({ rows: [{ id }], rowCount: 1 });
      }

      const id = this.nextBackgroundJobId;
      this.nextBackgroundJobId += 1;
      return Promise.resolve({ rows: [{ id }], rowCount: 1 });
    }

    if (normalized.startsWith('select id from background_jobs where dedupe_key = $1')) {
      const dedupeKey = typeof params[0] === 'string' ? params[0] : '';
      const existingId = this.backgroundJobs.get(dedupeKey);
      if (typeof existingId !== 'number') {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [{ id: existingId }], rowCount: 1 });
    }

    throw new Error(`Unsupported SQL in PoolMock: ${sql}`);
  }

  private key(igdbGameId: string, platformIgdbId: number): string {
    return `${igdbGameId}::${String(platformIgdbId)}`;
  }
}

void test('admin discovery routes reject unauthorized requests', async () => {
  const app = fastifyFactory({ logger: false });
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  try {
    registerAdminDiscoveryMatchRoutes(app, new PoolMock() as unknown as Pool);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/discovery/matches/unmatched',
    });

    assert.equal(response.statusCode, 401);
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery unmatched route lists only unmatched discovery rows for the selected provider', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '1',
    platformIgdbId: 6,
    payload: {
      listType: 'discovery',
      title: 'Matched Game',
      platform: 'PC',
      releaseYear: 2024,
      hltbMainHours: 10,
    },
  });
  pool.seed({
    igdbGameId: '2',
    platformIgdbId: 6,
    payload: {
      listType: 'discovery',
      title: 'Missing Game',
      platform: 'PC',
      releaseYear: 2025,
    },
  });
  pool.seed({
    igdbGameId: '3',
    platformIgdbId: 48,
    payload: {
      listType: 'discovery',
      title: 'Permanent Miss Game',
      platform: 'PlayStation 4',
      releaseYear: 2025,
      enrichmentRetry: {
        hltb: {
          attempts: 6,
          lastTriedAt: '2026-03-01T00:00:00.000Z',
          nextTryAt: null,
          permanentMiss: true,
        },
      },
    },
  });
  pool.seed({
    igdbGameId: '4',
    platformIgdbId: 6,
    payload: {
      listType: 'wishlist',
      title: 'Not Discovery',
      platform: 'PC',
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/discovery/matches/unmatched?provider=hltb&limit=10',
      headers: {
        'x-game-shelf-client-token': 'device-token-1',
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      count: number;
      items: Array<{
        igdbGameId: string;
        title: string;
        matchState: { hltb: { status: string } };
      }>;
    };
    assert.equal(body.count, 2);
    assert.deepEqual(
      body.items.map((item) => item.igdbGameId),
      ['2', '3']
    );
    assert.equal(body.items[0]?.matchState.hltb.status, 'missing');
    assert.equal(body.items[1]?.matchState.hltb.status, 'permanentMiss');
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery list requeue route enqueues a targeted discovery job and dedupes repeated requests', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/requeue-enrichment',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
      payload: {
        gameKeys: ['30::6', '31::48'],
      },
    });

    assert.equal(firstResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(firstResponse.body), {
      ok: true,
      queued: true,
      deduped: false,
      jobId: 1000,
      queuedCount: 1,
      dedupedCount: 0,
    });

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/requeue-enrichment',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
    });

    assert.equal(secondResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(secondResponse.body), {
      ok: true,
      queued: false,
      deduped: true,
      jobId: 1000,
      queuedCount: 0,
      dedupedCount: 1,
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery pricing requeue route enqueues targeted pricing refresh jobs', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '44',
    platformIgdbId: 48,
    payload: {
      listType: 'discovery',
      title: 'PS Game',
      platform: 'PlayStation 4',
      psPricesTitle: 'PS Game',
      psPricesUrl: 'https://psprices.com/us/game/ps-game',
      psPricesMatchLocked: true,
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/games/44/48/requeue-enrichment',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
      payload: {
        provider: 'pricing',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      ok: true,
      queued: true,
      deduped: false,
      jobId: 1000,
      queuedCount: 1,
      dedupedCount: 0,
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery patch route persists HLTB match locks and clears retry state', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '9',
    platformIgdbId: 6,
    payload: {
      listType: 'discovery',
      title: 'Fix Me',
      platform: 'PC',
      enrichmentRetry: {
        hltb: {
          attempts: 3,
          lastTriedAt: '2026-03-10T00:00:00.000Z',
          nextTryAt: '2026-03-11T00:00:00.000Z',
          permanentMiss: false,
        },
      },
    },
  });
  pool.seed({
    igdbGameId: '9',
    platformIgdbId: 48,
    payload: {
      listType: 'discovery',
      title: 'Fix Me',
      platform: 'PlayStation 4',
      enrichmentRetry: {
        hltb: {
          attempts: 2,
          lastTriedAt: '2026-03-09T00:00:00.000Z',
          nextTryAt: '2026-03-10T00:00:00.000Z',
          permanentMiss: false,
        },
      },
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/discovery/games/9/6/match',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
      payload: {
        provider: 'hltb',
        hltbGameId: 7002,
        hltbUrl: 'https://howlongtobeat.com/game/7002',
        hltbMainHours: 8.5,
        queryTitle: 'Night in the Woods',
      },
    });

    assert.equal(response.statusCode, 200);
    const stored = pool.readPayload('9', 6);
    assert.ok(stored);
    assert.equal(stored['hltbMatchLocked'], true);
    assert.equal(stored['hltbMatchGameId'], 7002);
    assert.equal(stored['hltbMainHours'], 8.5);
    assert.equal(stored['hltbMatchQueryTitle'], 'Night in the Woods');
    assert.deepEqual(stored['enrichmentRetry'], {
      hltb: {
        attempts: 0,
        lastTriedAt: null,
        nextTryAt: null,
        permanentMiss: false,
      },
    });
    const secondaryStored = pool.readPayload('9', 48);
    assert.ok(secondaryStored);
    assert.equal(secondaryStored['hltbMatchLocked'], true);
    assert.equal(secondaryStored['hltbMatchGameId'], 7002);
    assert.equal(secondaryStored['hltbMainHours'], 8.5);
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery clear permanent miss route resets selected review retry state', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '21',
    platformIgdbId: 167,
    payload: {
      listType: 'discovery',
      title: 'Needs Review Reset',
      platform: 'PlayStation 5',
      enrichmentRetry: {
        metacritic: {
          attempts: 6,
          lastTriedAt: '2026-03-01T00:00:00.000Z',
          nextTryAt: null,
          permanentMiss: true,
        },
      },
    },
  });
  pool.seed({
    igdbGameId: '22',
    platformIgdbId: 167,
    payload: {
      listType: 'discovery',
      title: 'Leave Alone',
      platform: 'PlayStation 5',
      enrichmentRetry: {
        metacritic: {
          attempts: 6,
          lastTriedAt: '2026-03-01T00:00:00.000Z',
          nextTryAt: null,
          permanentMiss: true,
        },
      },
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/matches/clear-permanent-miss',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
      payload: {
        provider: 'review',
        gameKeys: ['21::167'],
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as { cleared: number };
    assert.equal(body.cleared, 1);
    assert.deepEqual(pool.readPayload('21', 167)?.['enrichmentRetry'], {
      metacritic: {
        attempts: 0,
        lastTriedAt: null,
        nextTryAt: null,
        permanentMiss: false,
      },
    });
    assert.deepEqual(pool.readPayload('22', 167)?.['enrichmentRetry'], {
      metacritic: {
        attempts: 6,
        lastTriedAt: '2026-03-01T00:00:00.000Z',
        nextTryAt: null,
        permanentMiss: true,
      },
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery requeue enrichment route enqueues the discovery job and dedupes repeated requests', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '30',
    platformIgdbId: 6,
    payload: {
      listType: 'discovery',
      title: 'Queue Me',
      platform: 'PC',
      releaseYear: 2025,
    },
  });
  pool.seed({
    igdbGameId: '30',
    platformIgdbId: 48,
    payload: {
      listType: 'discovery',
      title: 'Queue Me',
      platform: 'PlayStation 4',
      releaseYear: 2025,
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/games/30/6/requeue-enrichment',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
    });

    assert.equal(firstResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(firstResponse.body), {
      ok: true,
      queued: true,
      deduped: false,
      jobId: 1000,
      queuedCount: 1,
      dedupedCount: 0,
    });

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/games/30/6/requeue-enrichment',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
    });

    assert.equal(secondResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(secondResponse.body), {
      ok: true,
      queued: false,
      deduped: true,
      jobId: 1000,
      queuedCount: 0,
      dedupedCount: 1,
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});
