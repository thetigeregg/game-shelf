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
  keyLookupQueryCount = 0;

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
        "select igdb_game_id, platform_igdb_id, payload from games where coalesce(payload->>'listtype', '') = 'discovery' and (igdb_game_id || '::' || platform_igdb_id::text) = any($1::text[])"
      )
    ) {
      this.keyLookupQueryCount += 1;
      const requestedKeys = Array.isArray(params[0])
        ? new Set(
            params[0]
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim())
              .filter((item) => item.length > 0)
          )
        : new Set<string>();
      const rows = [...this.rows.values()]
        .filter((row) => row.payload['listType'] === 'discovery')
        .filter((row) => requestedKeys.has(this.key(row.igdbGameId, row.platformIgdbId)))
        .map((row) => ({
          igdb_game_id: row.igdbGameId,
          platform_igdb_id: row.platformIgdbId,
          payload: structuredClone(row.payload),
        }));
      return Promise.resolve({ rows, rowCount: rows.length });
    }

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

void test('admin discovery pricing filter excludes unsupported platforms from missing pricing results', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '10',
    platformIgdbId: 6,
    payload: {
      listType: 'discovery',
      title: 'Steam Missing Price',
      platform: 'PC',
      releaseYear: 2025,
    },
  });
  pool.seed({
    igdbGameId: '11',
    platformIgdbId: 48,
    payload: {
      listType: 'discovery',
      title: 'PS Missing Price',
      platform: 'PlayStation 4',
      releaseYear: 2025,
    },
  });
  pool.seed({
    igdbGameId: '12',
    platformIgdbId: 49,
    payload: {
      listType: 'discovery',
      title: 'Unsupported Platform Price',
      platform: 'Xbox One',
      releaseYear: 2025,
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/discovery/matches/unmatched?provider=pricing&limit=10',
      headers: {
        'x-game-shelf-client-token': 'device-token-1',
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      count: number;
      items: Array<{
        igdbGameId: string;
        matchState: { pricing: { status: string } };
      }>;
    };

    assert.equal(body.count, 2);
    assert.deepEqual(
      body.items.map((item) => item.igdbGameId),
      ['10', '11']
    );
    assert.ok(body.items.every((item) => item.matchState.pricing.status === 'missing'));
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery pricing filter treats negative prices as unmatched', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '13',
    platformIgdbId: 48,
    payload: {
      listType: 'discovery',
      title: 'Negative Price Game',
      platform: 'PlayStation 4',
      priceAmount: -1,
    },
  });
  pool.seed({
    igdbGameId: '14',
    platformIgdbId: 48,
    payload: {
      listType: 'discovery',
      title: 'Free Price Game',
      platform: 'PlayStation 4',
      priceIsFree: true,
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/discovery/matches/unmatched?provider=pricing&limit=10',
      headers: {
        'x-game-shelf-client-token': 'device-token-1',
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      count: number;
      items: Array<{
        igdbGameId: string;
        matchState: { pricing: { status: string } };
      }>;
    };

    assert.equal(body.count, 1);
    assert.deepEqual(
      body.items.map((item) => item.igdbGameId),
      ['13']
    );
    assert.equal(body.items[0]?.matchState.pricing.status, 'missing');
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

void test('admin discovery pricing list requeue route respects selected game keys and skips unsupported rows', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '32',
    platformIgdbId: 6,
    payload: {
      listType: 'discovery',
      title: 'Steam Queue',
      platform: 'PC',
      steamAppId: 620,
    },
  });
  pool.seed({
    igdbGameId: '33',
    platformIgdbId: 48,
    payload: {
      listType: 'discovery',
      title: 'PS Queue',
      platform: 'PlayStation 4',
      psPricesMatchQueryTitle: 'PS Queue Search',
    },
  });
  pool.seed({
    igdbGameId: '34',
    platformIgdbId: 49,
    payload: {
      listType: 'discovery',
      title: 'Unsupported Queue',
      platform: 'Xbox One',
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/requeue-enrichment',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
      payload: {
        provider: 'pricing',
        gameKeys: ['32::6', ' 33::48 ', '32::6', '34::49'],
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      ok: true,
      queued: true,
      deduped: false,
      jobId: 1000,
      queuedCount: 2,
      dedupedCount: 0,
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery pricing list requeue route scans all rows when no game keys are supplied', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '39',
    platformIgdbId: 6,
    payload: {
      listType: 'discovery',
      title: 'Missing Steam App',
      platform: 'PC',
    },
  });
  pool.seed({
    igdbGameId: '49',
    platformIgdbId: 167,
    payload: {
      listType: 'discovery',
      title: 'Queue All PS',
      platform: 'PlayStation 5',
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/requeue-enrichment',
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

void test('admin discovery pricing list requeue route returns no jobs when pricing lookup data is missing', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '50',
    platformIgdbId: 167,
    payload: {
      listType: 'discovery',
      platform: 'PlayStation 5',
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/requeue-enrichment',
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
      queued: false,
      deduped: false,
      jobId: null,
      queuedCount: 0,
      dedupedCount: 0,
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery unmatched route supports providerless matched filtering with normalized search and limit fallback', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '35',
    platformIgdbId: 6,
    payload: {
      listType: 'discovery',
      title: 'Matched Mixed Game',
      platform: 'PC',
      hltbMainHours: 9,
    },
  });
  pool.seed({
    igdbGameId: '36',
    platformIgdbId: 6,
    payload: {
      listType: 'discovery',
      title: 'Missing Mixed Game',
      platform: 'PC',
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/discovery/matches/unmatched?state=matched&search=%20MiXeD%20&limit=0',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      count: number;
      items: Array<{ igdbGameId: string }>;
    };
    assert.equal(body.count, 1);
    assert.deepEqual(
      body.items.map((item) => item.igdbGameId),
      ['35']
    );
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery unmatched route defaults to providerless non-matched filtering', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '37',
    platformIgdbId: 48,
    payload: {
      listType: 'discovery',
      title: 'All Matched Game',
      platform: 'PlayStation 4',
      hltbMainHours: 7,
      reviewSource: 'metacritic',
      reviewScore: 82,
      priceAmount: 19.99,
    },
  });
  pool.seed({
    igdbGameId: '38',
    platformIgdbId: 48,
    payload: {
      listType: 'discovery',
      title: 'Still Missing Game',
      platform: 'PlayStation 4',
      hltbMainHours: 7,
      priceAmount: 19.99,
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/discovery/matches/unmatched',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      count: number;
      items: Array<{ igdbGameId: string }>;
    };
    assert.equal(body.count, 1);
    assert.deepEqual(
      body.items.map((item) => item.igdbGameId),
      ['38']
    );
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

void test('admin discovery patch route rejects empty HLTB updates', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '19',
    platformIgdbId: 6,
    payload: {
      listType: 'discovery',
      title: 'Needs HLTB',
      platform: 'PC',
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/discovery/games/19/6/match',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
      payload: {
        provider: 'hltb',
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'HLTB updates require at least one match or timing field.',
    });
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

void test('admin discovery pricing state shows permanent miss but clear route rejects pricing', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '23',
    platformIgdbId: 167,
    payload: {
      listType: 'discovery',
      title: 'Needs Pricing Reset',
      platform: 'PlayStation 5',
      enrichmentRetry: {
        psprices: {
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

    const listResponse = await app.inject({
      method: 'GET',
      url: '/v1/admin/discovery/matches/unmatched?provider=pricing&limit=10',
      headers: {
        'x-game-shelf-client-token': 'device-token-1',
      },
    });

    assert.equal(listResponse.statusCode, 200);
    const listBody = JSON.parse(listResponse.body) as {
      items: Array<{ matchState: { pricing: { status: string; attempts: number } } }>;
    };
    assert.equal(listBody.items[0]?.matchState.pricing.status, 'permanentMiss');
    assert.equal(listBody.items[0]?.matchState.pricing.attempts, 6);

    const clearResponse = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/matches/clear-permanent-miss',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
      payload: {
        provider: 'pricing',
        gameKeys: ['23::167'],
      },
    });

    assert.equal(clearResponse.statusCode, 400);
    const clearBody = JSON.parse(clearResponse.body) as { error: string };
    assert.equal(clearBody.error, 'Provider must be hltb or review.');
    assert.deepEqual(pool.readPayload('23', 167)?.['enrichmentRetry'], {
      psprices: {
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

void test('admin discovery patch route clears stale psprices metadata for steam pricing updates', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '24',
    platformIgdbId: 6,
    payload: {
      listType: 'discovery',
      title: 'Steam Cleanup',
      platform: 'PC',
      psPricesUrl: 'https://psprices.com/us/game/steam-cleanup',
      psPricesTitle: 'Steam Cleanup',
      psPricesPlatform: 'PS4',
      enrichmentRetry: {
        psprices: {
          attempts: 4,
          lastTriedAt: '2026-03-09T00:00:00.000Z',
          nextTryAt: null,
          permanentMiss: true,
        },
      },
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/discovery/games/24/6/match',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
      payload: {
        provider: 'pricing',
        priceSource: 'steam_store',
        priceAmount: 9.99,
        priceCurrency: 'USD',
        priceUrl: 'https://store.steampowered.com/app/620/Portal_2/',
        psPricesUrl: 'https://psprices.com/us/game/steam-cleanup',
        psPricesTitle: 'Steam Cleanup',
        psPricesPlatform: 'PS4',
      },
    });

    assert.equal(response.statusCode, 200);
    const stored = pool.readPayload('24', 6);
    assert.ok(stored);
    assert.equal(stored['priceSource'], 'steam_store');
    assert.equal(stored['priceUrl'], 'https://store.steampowered.com/app/620/Portal_2/');
    assert.equal(stored['psPricesUrl'], null);
    assert.equal(stored['psPricesTitle'], null);
    assert.equal(stored['psPricesPlatform'], null);
    assert.deepEqual(stored['enrichmentRetry'], {
      psprices: {
        attempts: 0,
        lastTriedAt: null,
        nextTryAt: null,
        permanentMiss: false,
      },
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery delete route clears pricing fields and resets pricing retry state', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '25',
    platformIgdbId: 48,
    payload: {
      listType: 'discovery',
      title: 'Price Reset',
      platform: 'PlayStation 4',
      priceSource: 'psprices',
      priceAmount: 14.99,
      priceCurrency: 'USD',
      priceUrl: 'https://psprices.com/us/game/price-reset',
      psPricesUrl: 'https://psprices.com/us/game/price-reset',
      psPricesTitle: 'Price Reset',
      psPricesPlatform: 'PS4',
      psPricesMatchLocked: true,
      enrichmentRetry: {
        psprices: {
          attempts: 3,
          lastTriedAt: '2026-03-10T00:00:00.000Z',
          nextTryAt: '2026-03-11T00:00:00.000Z',
          permanentMiss: false,
        },
      },
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/admin/discovery/games/25/48/match/pricing',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
    });

    assert.equal(response.statusCode, 200);
    const stored = pool.readPayload('25', 48);
    assert.ok(stored);
    assert.equal(stored['priceSource'], null);
    assert.equal(stored['priceAmount'], null);
    assert.equal(stored['priceUrl'], null);
    assert.equal(stored['psPricesUrl'], null);
    assert.equal(stored['psPricesMatchLocked'], false);
    assert.deepEqual(stored['enrichmentRetry'], {
      psprices: {
        attempts: 0,
        lastTriedAt: null,
        nextTryAt: null,
        permanentMiss: false,
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

void test('admin discovery match-state route returns provider detail and retrying state', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '40',
    platformIgdbId: 167,
    payload: {
      listType: 'discovery',
      title: 'Detail Game',
      platform: 'PlayStation 5',
      releaseYear: 2025,
      reviewMatchLocked: true,
      reviewMatchQueryTitle: 'Detail Query',
      reviewMatchQueryReleaseYear: 2024,
      reviewMatchQueryPlatform: 'PS5',
      reviewMatchPlatformIgdbId: 167,
      reviewMatchMobygamesGameId: 9001,
      enrichmentRetry: {
        metacritic: {
          attempts: 2,
          lastTriedAt: '2026-03-10T00:00:00.000Z',
          nextTryAt: '2026-03-11T00:00:00.000Z',
          permanentMiss: false,
        },
      },
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/discovery/games/40/167/match-state',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      igdbGameId: string;
      matchState: { review: { status: string; locked: boolean; attempts: number } };
      providers: { review: { queryTitle: string | null; queryMobygamesGameId: number | null } };
    };

    assert.equal(body.igdbGameId, '40');
    assert.equal(body.matchState.review.status, 'retrying');
    assert.equal(body.matchState.review.locked, true);
    assert.equal(body.matchState.review.attempts, 2);
    assert.equal(body.providers.review.queryTitle, 'Detail Query');
    assert.equal(body.providers.review.queryMobygamesGameId, 9001);
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery match-state route returns 404 for unknown discovery games', async () => {
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

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/discovery/games/404/6/match-state',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'Discovery game not found.',
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery patch route rejects empty review updates', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '41',
    platformIgdbId: 167,
    payload: {
      listType: 'discovery',
      title: 'Needs Review',
      platform: 'PlayStation 5',
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/discovery/games/41/167/match',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
      payload: {
        provider: 'review',
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'Review updates require at least one review field.',
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery patch route rejects invalid providers', async () => {
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

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/discovery/games/41/167/match',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
      payload: {
        provider: 'steam',
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'A valid provider is required.',
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery patch route stores mobygames-specific review fields', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '46',
    platformIgdbId: 167,
    payload: {
      listType: 'discovery',
      title: 'Moby Review',
      platform: 'PlayStation 5',
      metacriticScore: 70,
      metacriticUrl: 'https://metacritic.example/old',
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/discovery/games/46/167/match',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
      payload: {
        provider: 'review',
        reviewSource: 'mobygames',
        reviewScore: 83,
        mobygamesGameId: 555,
        queryTitle: 'Moby Review Query',
      },
    });

    assert.equal(response.statusCode, 200);
    const stored = pool.readPayload('46', 167);
    assert.ok(stored);
    assert.equal(stored['reviewSource'], 'mobygames');
    assert.equal(stored['reviewScore'], 83);
    assert.equal(stored['mobygamesGameId'], 555);
    assert.equal(stored['mobyScore'], 83);
    assert.equal(stored['metacriticScore'], null);
    assert.equal(stored['metacriticUrl'], null);
    assert.equal(stored['reviewMatchMobygamesGameId'], 555);
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery delete route clears review fields across related games', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '42',
    platformIgdbId: 6,
    payload: {
      listType: 'discovery',
      title: 'Shared Review',
      platform: 'PC',
      reviewSource: 'metacritic',
      reviewScore: 89,
      reviewUrl: 'https://www.metacritic.com/game/shared-review',
      metacriticScore: 89,
      metacriticUrl: 'https://www.metacritic.com/game/shared-review',
      reviewMatchLocked: true,
      enrichmentRetry: {
        metacritic: {
          attempts: 4,
          lastTriedAt: '2026-03-09T00:00:00.000Z',
          nextTryAt: '2026-03-10T00:00:00.000Z',
          permanentMiss: false,
        },
      },
    },
  });
  pool.seed({
    igdbGameId: '42',
    platformIgdbId: 48,
    payload: {
      listType: 'discovery',
      title: 'Shared Review',
      platform: 'PlayStation 4',
      reviewSource: 'metacritic',
      reviewScore: 89,
      reviewUrl: 'https://www.metacritic.com/game/shared-review',
      metacriticScore: 89,
      metacriticUrl: 'https://www.metacritic.com/game/shared-review',
      reviewMatchLocked: true,
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/admin/discovery/games/42/6/match/review',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      changed: boolean;
      provider: string;
      item: { providers: { review: { reviewScore: number | null } } };
    };
    assert.equal(body.changed, true);
    assert.equal(body.provider, 'review');
    assert.equal(body.item.providers.review.reviewScore, null);

    const primaryStored = pool.readPayload('42', 6);
    assert.ok(primaryStored);
    assert.equal(primaryStored['reviewSource'], null);
    assert.equal(primaryStored['reviewScore'], null);
    assert.equal(primaryStored['reviewMatchLocked'], false);
    assert.deepEqual(primaryStored['enrichmentRetry'], {
      metacritic: {
        attempts: 0,
        lastTriedAt: null,
        nextTryAt: null,
        permanentMiss: false,
      },
    });

    const secondaryStored = pool.readPayload('42', 48);
    assert.ok(secondaryStored);
    assert.equal(secondaryStored['reviewSource'], null);
    assert.equal(secondaryStored['reviewScore'], null);
    assert.equal(secondaryStored['reviewMatchLocked'], false);
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery delete route rejects invalid providers', async () => {
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

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/admin/discovery/games/42/6/match/steam',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'A valid provider is required.',
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery delete route returns 404 for unknown discovery games', async () => {
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

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/admin/discovery/games/404/6/match/review',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'Discovery game not found.',
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery delete route clears HLTB fields and retry state', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '47',
    platformIgdbId: 6,
    payload: {
      listType: 'discovery',
      title: 'HLTB Reset',
      platform: 'PC',
      hltbMatchGameId: 7002,
      hltbMatchUrl: 'https://howlongtobeat.com/game/7002',
      hltbMainHours: 12,
      hltbMainExtraHours: 18,
      hltbCompletionistHours: 25,
      hltbMatchLocked: true,
      enrichmentRetry: {
        hltb: {
          attempts: 2,
          lastTriedAt: '2026-03-10T00:00:00.000Z',
          nextTryAt: '2026-03-11T00:00:00.000Z',
          permanentMiss: false,
        },
      },
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/admin/discovery/games/47/6/match/hltb',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
    });

    assert.equal(response.statusCode, 200);
    const stored = pool.readPayload('47', 6);
    assert.ok(stored);
    assert.equal(stored['hltbMatchGameId'], null);
    assert.equal(stored['hltbMainHours'], null);
    assert.equal(stored['hltbMatchLocked'], false);
    assert.deepEqual(stored['enrichmentRetry'], {
      hltb: {
        attempts: 0,
        lastTriedAt: null,
        nextTryAt: null,
        permanentMiss: false,
      },
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery pricing patch route accepts free-only updates', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '43',
    platformIgdbId: 48,
    payload: {
      listType: 'discovery',
      title: 'Free Game',
      platform: 'PlayStation 4',
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/discovery/games/43/48/match',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
      payload: {
        provider: 'pricing',
        priceIsFree: true,
      },
    });

    assert.equal(response.statusCode, 200);
    const stored = pool.readPayload('43', 48);
    assert.ok(stored);
    assert.equal(stored['priceAmount'], null);
    assert.equal(stored['priceIsFree'], true);
    assert.equal(stored['priceSource'], 'psprices');
    assert.equal(stored['psPricesMatchLocked'], true);
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery pricing patch route rejects empty pricing updates', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '48',
    platformIgdbId: 48,
    payload: {
      listType: 'discovery',
      title: 'Needs Price',
      platform: 'PlayStation 4',
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/discovery/games/48/48/match',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
      payload: {
        provider: 'pricing',
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'Pricing updates require at least one pricing field.',
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery pricing patch route rejects priceIsFree false without amount or url', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '49',
    platformIgdbId: 48,
    payload: {
      listType: 'discovery',
      title: 'Unknown Price',
      platform: 'PlayStation 4',
    },
  });

  try {
    registerAdminDiscoveryMatchRoutes(app, pool as unknown as Pool);

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/discovery/games/49/48/match',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
      payload: {
        provider: 'pricing',
        priceIsFree: false,
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'Pricing updates require at least one pricing field.',
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery clear permanent miss route rejects invalid providers', async () => {
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

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/matches/clear-permanent-miss',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
      payload: {
        provider: 'steam',
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'Provider must be hltb or review.',
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery requeue enrichment route returns 404 for unknown discovery games', async () => {
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

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/games/999/6/requeue-enrichment',
      headers: {
        authorization: 'Bearer test-admin-token',
      },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'Discovery game not found.',
    });
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});

void test('admin discovery clear permanent miss route leaves already-clear rows unchanged', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock();
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  pool.seed({
    igdbGameId: '45',
    platformIgdbId: 167,
    payload: {
      listType: 'discovery',
      title: 'Already Clear',
      platform: 'PlayStation 5',
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
        gameKeys: ['45::167'],
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      ok: true,
      provider: 'review',
      cleared: 0,
    });
    assert.equal(pool.keyLookupQueryCount, 1);
  } finally {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    await app.close();
  }
});
