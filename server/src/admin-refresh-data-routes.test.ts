import assert from 'node:assert/strict';
import test from 'node:test';
import fastifyFactory from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { registerAdminRefreshDataRoutes } from './admin-refresh-data-routes.js';
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
  enqueuedJobs: Array<{ jobType: string; dedupeKey: string | null; payload: unknown }> = [];

  seed(row: SeedRow): void {
    this.rows.set(this.key(row.igdbGameId, row.platformIgdbId), structuredClone(row));
  }

  query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('select g.igdb_game_id, g.platform_igdb_id, g.payload,')) {
      const limit = typeof params[0] === 'number' ? params[0] : Number.POSITIVE_INFINITY;
      const rows = [...this.rows.values()]
        .filter((row) => ['collection', 'wishlist'].includes(String(row.payload['listType'])))
        .sort((a, b) => a.igdbGameId.localeCompare(b.igdbGameId))
        .slice(0, limit)
        .map((row) => ({
          igdb_game_id: row.igdbGameId,
          platform_igdb_id: row.platformIgdbId,
          payload: structuredClone(row.payload),
          watch_exists: false,
          last_known_release_marker: null,
          last_known_release_precision: null,
          last_known_release_date: null,
          last_known_release_year: null,
          last_seen_state: null,
          last_hltb_refresh_at: null,
          last_metacritic_refresh_at: null,
          last_notified_release_day: null,
        }));
      return Promise.resolve({ rows, rowCount: rows.length });
    }

    if (
      normalized.startsWith(
        "select igdb_game_id, platform_igdb_id, payload from games where payload->>'listtype' = 'wishlist'"
      )
    ) {
      const steamPlatformId = typeof params[0] === 'number' ? params[0] : null;
      const pspricesPlatformIds = Array.isArray(params[1]) ? (params[1] as number[]) : [];
      const limit = typeof params[2] === 'number' ? params[2] : Number.POSITIVE_INFINITY;
      const rows = [...this.rows.values()]
        .filter((row) => row.payload['listType'] === 'wishlist')
        .filter(
          (row) =>
            row.platformIgdbId === steamPlatformId ||
            pspricesPlatformIds.includes(row.platformIgdbId)
        )
        .sort((a, b) => a.igdbGameId.localeCompare(b.igdbGameId))
        .slice(0, limit)
        .map((row) => ({
          igdb_game_id: row.igdbGameId,
          platform_igdb_id: row.platformIgdbId,
          payload: structuredClone(row.payload),
        }));
      return Promise.resolve({ rows, rowCount: rows.length });
    }

    if (normalized.startsWith('with latest_run as')) {
      const limit = typeof params[3] === 'number' ? params[3] : Number.POSITIVE_INFINITY;
      const rows = [...this.rows.values()]
        .filter((row) => row.payload['listType'] === 'discovery')
        .sort((a, b) => a.igdbGameId.localeCompare(b.igdbGameId))
        .slice(0, limit)
        .map((row) => ({
          igdb_game_id: row.igdbGameId,
          platform_igdb_id: row.platformIgdbId,
          payload: structuredClone(row.payload),
        }));
      return Promise.resolve({ rows, rowCount: rows.length });
    }

    if (normalized.startsWith('insert into background_jobs')) {
      const jobType = typeof params[0] === 'string' ? params[0] : '';
      const dedupeKey =
        typeof params[1] === 'string' && params[1].trim().length > 0 ? params[1] : null;
      const payloadJson = typeof params[2] === 'string' ? params[2] : '{}';
      if (dedupeKey !== null) {
        const existingId = this.backgroundJobs.get(dedupeKey);
        if (typeof existingId === 'number') {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        const id = this.nextBackgroundJobId;
        this.nextBackgroundJobId += 1;
        this.backgroundJobs.set(dedupeKey, id);
        this.enqueuedJobs.push({ jobType, dedupeKey, payload: JSON.parse(payloadJson) });
        return Promise.resolve({ rows: [{ id }], rowCount: 1 });
      }

      const id = this.nextBackgroundJobId;
      this.nextBackgroundJobId += 1;
      this.enqueuedJobs.push({ jobType, dedupeKey: null, payload: JSON.parse(payloadJson) });
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

  connect(): Promise<PoolClient> {
    return Promise.resolve({
      query: this.query.bind(this),
      release: () => {},
    } as unknown as PoolClient);
  }

  private key(igdbGameId: string, platformIgdbId: number): string {
    return `${igdbGameId}::${String(platformIgdbId)}`;
  }
}

function withAdminAuth<T>(run: () => Promise<T>): Promise<T> {
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  config.requireAuth = true;
  config.apiToken = 'test-admin-token';
  config.clientWriteTokens = ['device-token-1'];

  return run().finally(() => {
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
  });
}

void test('admin refresh-data route rejects unauthorized requests', async () => {
  await withAdminAuth(async () => {
    const app = fastifyFactory({ logger: false });
    try {
      registerAdminRefreshDataRoutes(app, new PoolMock() as unknown as Pool);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/admin/refresh-data',
        payload: { dataTypes: ['hltb'] },
      });

      assert.equal(response.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});

void test('admin refresh-data route rejects missing, empty, or invalid dataTypes', async () => {
  await withAdminAuth(async () => {
    const app = fastifyFactory({ logger: false });
    try {
      registerAdminRefreshDataRoutes(app, new PoolMock() as unknown as Pool);

      for (const payload of [
        {},
        { dataTypes: [] },
        { dataTypes: ['bogus'] },
        { dataTypes: 'hltb' },
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/admin/refresh-data',
          headers: { 'x-game-shelf-client-token': 'device-token-1' },
          payload,
        });
        assert.equal(
          response.statusCode,
          400,
          `expected 400 for payload ${JSON.stringify(payload)}`
        );
      }
    } finally {
      await app.close();
    }
  });
});

void test('admin refresh-data route scopes hltb/reviews to collection+wishlist and shares one enqueue pass', async () => {
  await withAdminAuth(async () => {
    const app = fastifyFactory({ logger: false });
    const pool = new PoolMock();
    pool.seed({
      igdbGameId: '1',
      platformIgdbId: 6,
      payload: { listType: 'wishlist', title: 'Wishlist Game' },
    });
    pool.seed({
      igdbGameId: '2',
      platformIgdbId: 6,
      payload: { listType: 'collection', title: 'Collection Game' },
    });
    pool.seed({
      igdbGameId: '3',
      platformIgdbId: 6,
      payload: { listType: 'discovery', title: 'Discovery Game' },
    });

    try {
      registerAdminRefreshDataRoutes(app, pool as unknown as Pool);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/admin/refresh-data',
        headers: { 'x-game-shelf-client-token': 'device-token-1' },
        payload: { dataTypes: ['hltb', 'reviews'] },
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as {
        results: {
          hltb: { scanned: number; enqueued: number; deduped: number };
          reviews: { scanned: number; enqueued: number; deduped: number };
        };
      };
      assert.equal(body.results.hltb.scanned, 2);
      assert.deepEqual(body.results.hltb, body.results.reviews);
      assert.equal(body.respectRecency, true);
      assert.equal(body.respectStaleness, false);

      const releaseMonitorJobs = pool.enqueuedJobs.filter(
        (job) => job.jobType === 'release_monitor_game'
      );
      assert.equal(releaseMonitorJobs.length, 2);
      for (const job of releaseMonitorJobs) {
        const payload = job.payload as {
          force_hltb: boolean;
          force_review: boolean;
          respect_recency: boolean;
          respect_staleness: boolean;
        };
        assert.equal(payload.force_hltb, true);
        assert.equal(payload.force_review, true);
        assert.equal(payload.respect_recency, true);
        assert.equal(payload.respect_staleness, false);
      }
    } finally {
      await app.close();
    }
  });
});

void test('admin refresh-data route rejects non-boolean respectRecency/respectStaleness', async () => {
  await withAdminAuth(async () => {
    const app = fastifyFactory({ logger: false });
    const pool = new PoolMock();

    try {
      registerAdminRefreshDataRoutes(app, pool as unknown as Pool);

      for (const payload of [
        { dataTypes: ['hltb'], respectRecency: 'yes' },
        { dataTypes: ['hltb'], respectStaleness: 1 },
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/admin/refresh-data',
          headers: { 'x-game-shelf-client-token': 'device-token-1' },
          payload,
        });
        assert.equal(
          response.statusCode,
          400,
          `expected 400 for payload ${JSON.stringify(payload)}`
        );
      }
    } finally {
      await app.close();
    }
  });
});

void test('admin refresh-data route threads respectRecency/respectStaleness overrides onto release-monitor job payloads', async () => {
  await withAdminAuth(async () => {
    const app = fastifyFactory({ logger: false });
    const pool = new PoolMock();
    pool.seed({
      igdbGameId: '1',
      platformIgdbId: 6,
      payload: { listType: 'wishlist', title: 'Wishlist Game' },
    });

    try {
      registerAdminRefreshDataRoutes(app, pool as unknown as Pool);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/admin/refresh-data',
        headers: { 'x-game-shelf-client-token': 'device-token-1' },
        payload: { dataTypes: ['hltb'], respectRecency: false, respectStaleness: true },
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as {
        respectRecency: boolean;
        respectStaleness: boolean;
      };
      assert.equal(body.respectRecency, false);
      assert.equal(body.respectStaleness, true);

      const releaseMonitorJobs = pool.enqueuedJobs.filter(
        (job) => job.jobType === 'release_monitor_game'
      );
      assert.equal(releaseMonitorJobs.length, 1);
      const payload = releaseMonitorJobs[0]?.payload as {
        respect_recency: boolean;
        respect_staleness: boolean;
      };
      assert.equal(payload.respect_recency, false);
      assert.equal(payload.respect_staleness, true);
    } finally {
      await app.close();
    }
  });
});

void test('admin refresh-data route enqueues a single forced igdb metadata job and dedupes a repeat call', async () => {
  await withAdminAuth(async () => {
    const app = fastifyFactory({ logger: false });
    const pool = new PoolMock();

    try {
      registerAdminRefreshDataRoutes(app, pool as unknown as Pool);

      const first = await app.inject({
        method: 'POST',
        url: '/v1/admin/refresh-data',
        headers: { 'x-game-shelf-client-token': 'device-token-1' },
        payload: { dataTypes: ['igdb'] },
      });
      assert.equal(first.statusCode, 200);
      const firstBody = JSON.parse(first.body) as {
        results: { igdb: { enqueued: number; deduped: number } };
      };
      assert.deepEqual(firstBody.results.igdb, { enqueued: 1, deduped: 0 });

      const second = await app.inject({
        method: 'POST',
        url: '/v1/admin/refresh-data',
        headers: { 'x-game-shelf-client-token': 'device-token-1' },
        payload: { dataTypes: ['igdb'] },
      });
      const secondBody = JSON.parse(second.body) as {
        results: { igdb: { enqueued: number; deduped: number } };
      };
      assert.deepEqual(secondBody.results.igdb, { enqueued: 0, deduped: 1 });

      const metadataJobs = pool.enqueuedJobs.filter(
        (job) => job.jobType === 'metadata_enrichment_run'
      );
      assert.equal(metadataJobs.length, 1);
      const metadataPayload = metadataJobs[0]?.payload as {
        force: boolean;
        respectRecency: boolean;
        respectStaleness: boolean;
      };
      assert.equal(metadataPayload.force, true);
      assert.equal(metadataPayload.respectRecency, true);
      assert.equal(metadataPayload.respectStaleness, false);

      // A repeat call with different respect flags is a distinct forced-refresh request
      // and must not dedupe against the first.
      const third = await app.inject({
        method: 'POST',
        url: '/v1/admin/refresh-data',
        headers: { 'x-game-shelf-client-token': 'device-token-1' },
        payload: { dataTypes: ['igdb'], respectRecency: false, respectStaleness: true },
      });
      const thirdBody = JSON.parse(third.body) as {
        results: { igdb: { enqueued: number; deduped: number } };
      };
      assert.deepEqual(thirdBody.results.igdb, { enqueued: 1, deduped: 0 });
    } finally {
      await app.close();
    }
  });
});

void test('admin refresh-data route enqueues pricing jobs for wishlist rows with required fields, skips others', async () => {
  await withAdminAuth(async () => {
    const app = fastifyFactory({ logger: false });
    const pool = new PoolMock();
    pool.seed({
      igdbGameId: '1',
      platformIgdbId: 6,
      payload: { listType: 'wishlist', title: 'Steam Game', steamAppId: 123 },
    });
    pool.seed({
      igdbGameId: '2',
      platformIgdbId: 48,
      payload: { listType: 'wishlist', title: 'PSPrices Game' },
    });
    pool.seed({
      igdbGameId: '3',
      platformIgdbId: 6,
      payload: { listType: 'wishlist', title: 'Missing Steam App Id' },
    });
    pool.seed({
      igdbGameId: '4',
      platformIgdbId: 9999,
      payload: { listType: 'wishlist', title: 'Unsupported Platform' },
    });

    try {
      registerAdminRefreshDataRoutes(app, pool as unknown as Pool);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/admin/refresh-data',
        headers: { 'x-game-shelf-client-token': 'device-token-1' },
        payload: { dataTypes: ['pricing'] },
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as {
        results: { pricing: { scanned: number; enqueued: number; deduped: number } };
      };
      assert.equal(body.results.pricing.enqueued, 2);

      const steamJobs = pool.enqueuedJobs.filter((job) => job.jobType === 'steam_price_revalidate');
      const pspricesJobs = pool.enqueuedJobs.filter(
        (job) => job.jobType === 'psprices_price_revalidate'
      );
      assert.equal(steamJobs.length, 1);
      assert.equal(pspricesJobs.length, 1);
    } finally {
      await app.close();
    }
  });
});

void test('admin refresh-data route also enqueues pricing jobs for discovery rows and combines totals with wishlist', async () => {
  await withAdminAuth(async () => {
    const app = fastifyFactory({ logger: false });
    const pool = new PoolMock();
    pool.seed({
      igdbGameId: '1',
      platformIgdbId: 6,
      payload: { listType: 'wishlist', title: 'Wishlist Steam Game', steamAppId: 111 },
    });
    pool.seed({
      igdbGameId: '2',
      platformIgdbId: 6,
      payload: { listType: 'discovery', title: 'Discovery Steam Game', steamAppId: 222 },
    });
    pool.seed({
      igdbGameId: '3',
      platformIgdbId: 48,
      payload: { listType: 'discovery', title: 'Discovery PSPrices Game' },
    });
    pool.seed({
      igdbGameId: '4',
      platformIgdbId: 9999,
      payload: { listType: 'discovery', title: 'Discovery Unsupported Platform' },
    });

    try {
      registerAdminRefreshDataRoutes(app, pool as unknown as Pool);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/admin/refresh-data',
        headers: { 'x-game-shelf-client-token': 'device-token-1' },
        payload: { dataTypes: ['pricing'] },
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as {
        results: { pricing: { scanned: number; enqueued: number; deduped: number } };
      };
      assert.equal(body.results.pricing.scanned, 4);
      assert.equal(body.results.pricing.enqueued, 3);

      const discoverySteamJobs = pool.enqueuedJobs.filter(
        (job) =>
          job.jobType === 'steam_price_revalidate' && (job.dedupeKey ?? '').includes(':discovery:')
      );
      const discoveryPspricesJobs = pool.enqueuedJobs.filter(
        (job) =>
          job.jobType === 'psprices_price_revalidate' &&
          (job.dedupeKey ?? '').includes(':discovery:')
      );
      assert.equal(discoverySteamJobs.length, 1);
      assert.equal(discoveryPspricesJobs.length, 1);
    } finally {
      await app.close();
    }
  });
});

void test('admin refresh-data route pricing skips fresh prices only when respectStaleness is true', async () => {
  await withAdminAuth(async () => {
    const app = fastifyFactory({ logger: false });
    const pool = new PoolMock();
    pool.seed({
      igdbGameId: '1',
      platformIgdbId: 6,
      payload: {
        listType: 'wishlist',
        title: 'Freshly Priced Steam Game',
        steamAppId: 123,
        priceIsFree: false,
        priceAmount: 19.99,
        priceFetchedAt: new Date().toISOString(),
      },
    });

    try {
      registerAdminRefreshDataRoutes(app, pool as unknown as Pool);

      const defaultResponse = await app.inject({
        method: 'POST',
        url: '/v1/admin/refresh-data',
        headers: { 'x-game-shelf-client-token': 'device-token-1' },
        payload: { dataTypes: ['pricing'] },
      });
      const defaultBody = JSON.parse(defaultResponse.body) as {
        results: { pricing: { enqueued: number } };
      };
      assert.equal(defaultBody.results.pricing.enqueued, 1);

      const respectStalenessResponse = await app.inject({
        method: 'POST',
        url: '/v1/admin/refresh-data',
        headers: { 'x-game-shelf-client-token': 'device-token-1' },
        payload: { dataTypes: ['pricing'], respectStaleness: true },
      });
      const respectStalenessBody = JSON.parse(respectStalenessResponse.body) as {
        results: { pricing: { enqueued: number } };
      };
      assert.equal(respectStalenessBody.results.pricing.enqueued, 0);
    } finally {
      await app.close();
    }
  });
});
