import assert from 'node:assert/strict';
import test from 'node:test';
import fastifyFactory from 'fastify';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { runMigrations } from '../db.js';
import { registerPopularityRoutes } from './routes.js';

class PoolMock {
  readonly queries: Array<{ text: string; params: unknown[] }> = [];

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  query<T extends QueryResultRow = QueryResultRow>(
    text = '',
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    this.queries.push({ text, params });
    return Promise.resolve({
      rows: this.rows as T[],
      rowCount: this.rows.length,
    } as QueryResult<T>);
  }
}

const popularityFeedDatabaseUrl =
  typeof process.env.POPULARITY_FEED_TEST_DATABASE_URL === 'string'
    ? process.env.POPULARITY_FEED_TEST_DATABASE_URL.trim()
    : '';

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function buildPopularityPayload(
  title: string,
  platformIgdbId: number,
  platformName: string,
  listType = 'discovery'
): Record<string, unknown> {
  return {
    title,
    first_release_date: 1_700_000_000,
    totalRatingCount: 40,
    platformOptions: [{ id: platformIgdbId, name: platformName }],
    listType,
  };
}

async function insertGame(
  client: PoolClient,
  row: {
    igdbGameId: string;
    platformIgdbId: number;
    popularityScore: number;
    payload: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `
    INSERT INTO games (igdb_game_id, platform_igdb_id, popularity_score, payload)
    VALUES ($1, $2, $3, $4::jsonb)
    `,
    [row.igdbGameId, row.platformIgdbId, row.popularityScore, JSON.stringify(row.payload)]
  );
}

void test('GET /v1/games/trending returns mapped popularity feed items', async () => {
  const threshold = 37;
  const rowLimit = 75;
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock([
    {
      igdb_game_id: '100',
      platform_igdb_id: 6,
      popularity_score: '121.2',
      payload: {
        title: 'Test Game',
        coverUrl: 'https://example.com/cover.jpg',
        rating: 85,
        first_release_date: 1_700_000_000,
        platformOptions: [{ id: 6, name: 'PC' }],
      },
    },
  ]);
  await registerPopularityRoutes(app, pool as unknown as Pool, { rowLimit, threshold });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending',
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    items: Array<{
      id: string;
      name: string;
      popularityScore: number;
      platforms: Array<{ id: number; name: string }>;
      firstReleaseDate: number | null;
    }>;
  };
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]?.id, '100');
  assert.equal(body.items[0]?.name, 'Test Game');
  assert.equal(body.items[0]?.popularityScore, 121.2);
  assert.equal(body.items[0]?.platforms[0]?.id, 6);
  assert.equal(body.items[0]?.firstReleaseDate, 1_700_000_000);
  assert.equal(pool.queries.length, 1);
  const query = pool.queries[0];
  assert.ok(query.text.includes('AND TRUE'));
  assert.ok(query.text.includes('SELECT DISTINCT ON (igdb_game_id)'));
  assert.ok(
    query.text.includes('ORDER BY igdb_game_id, popularity_score DESC, platform_igdb_id ASC')
  );
  assert.ok(query.text.includes('AND NOT EXISTS'));
  assert.ok(query.text.includes("(owned.payload->>'listType') IN ('collection', 'wishlist')"));
  assert.ok(query.text.includes('LIMIT $2'));
  assert.equal(query.params[0], threshold);
  assert.equal(query.params[1], 11);

  await app.close();
});

void test('GET /v1/games/upcoming applies release window in SQL predicate', async () => {
  const nowSec = Math.trunc(Date.now() / 1000);
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock([
    {
      igdb_game_id: '200',
      platform_igdb_id: 6,
      popularity_score: '88.4',
      payload: {
        title: 'Future Game',
        first_release_date: nowSec + 10_000,
        platformOptions: [{ id: 6, name: 'PC' }],
      },
    },
  ]);
  await registerPopularityRoutes(app, pool as unknown as Pool, { rowLimit: 50, threshold: 50 });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/upcoming',
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as { items: Array<{ id: string }> };
  assert.deepEqual(
    body.items.map((item) => item.id),
    ['200']
  );
  assert.equal(pool.queries.length, 1);
  const query = pool.queries[0];
  assert.ok(query.text.includes('IS NOT NULL AND'));
  assert.ok(query.text.includes('> $2'));
  assert.ok(query.text.includes('LIMIT $3'));
  assert.equal(query.params[0], 50);
  assert.equal(query.params[2], 11);
  assert.equal(typeof query.params[1], 'number');

  await app.close();
});

void test('GET /v1/games/trending falls back to row platform id when payload platform fields are missing', async () => {
  const app = fastifyFactory({ logger: false });
  await registerPopularityRoutes(
    app,
    new PoolMock([
      {
        igdb_game_id: '101',
        platform_igdb_id: 167,
        popularity_score: '142.6',
        payload: {
          title: 'Legacy Platform Game',
        },
      },
    ]) as unknown as Pool,
    { rowLimit: 50, threshold: 50 }
  );

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending',
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    items: Array<{
      id: string;
      platforms: Array<{ id: number; name: string }>;
    }>;
  };

  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]?.id, '101');
  assert.deepEqual(body.items[0]?.platforms, [{ id: 167, name: 'Unknown platform' }]);

  await app.close();
});

void test('GET /v1/games/recent returns only last 90 days', async () => {
  const nowSec = Math.trunc(Date.now() / 1000);
  const ninetyDaysSec = 90 * 24 * 60 * 60;
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock([
    {
      igdb_game_id: '300',
      platform_igdb_id: 6,
      popularity_score: 99,
      payload: {
        title: 'Recent Game',
        releaseDate: new Date((nowSec - 10_000) * 1000).toISOString(),
        platformOptions: [{ id: 6, name: 'PC' }],
      },
    },
  ]);
  await registerPopularityRoutes(app, pool as unknown as Pool, { rowLimit: 50, threshold: 50 });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/recent',
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as { items: Array<{ id: string }> };
  assert.deepEqual(
    body.items.map((item) => item.id),
    ['300']
  );
  assert.equal(pool.queries.length, 1);
  const query = pool.queries[0];
  assert.ok(query.text.includes('> $3'));
  assert.ok(query.text.includes('<= $2'));
  assert.ok(query.text.includes('LIMIT $4'));
  assert.equal(query.params[0], 50);
  assert.equal(query.params[3], 11);
  assert.equal(typeof query.params[1], 'number');
  assert.equal(typeof query.params[2], 'number');
  assert.equal(Number(query.params[1]) - Number(query.params[2]), ninetyDaysSec);

  await app.close();
});

void test('GET /v1/games/trending dedupes by igdb id in SQL before applying the limit', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock([]);
  await registerPopularityRoutes(app, pool as unknown as Pool, { rowLimit: 50, threshold: 50 });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(pool.queries.length, 1);
  const query = pool.queries[0];
  assert.ok(query.text.includes('WITH candidate_games AS'));
  assert.ok(query.text.includes('SELECT DISTINCT ON (igdb_game_id)'));
  assert.ok(query.text.includes('FROM candidate_games'));
  assert.ok(
    query.text.includes('ORDER BY igdb_game_id, popularity_score DESC, platform_igdb_id ASC')
  );
  assert.ok(
    query.text.includes('ORDER BY popularity_score DESC, igdb_game_id ASC, platform_igdb_id ASC')
  );
  assert.ok(query.text.includes('LIMIT $2'));

  await app.close();
});

void test('GET /v1/games/trending excludes collection and wishlist games in SQL before applying the limit', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock([]);
  await registerPopularityRoutes(app, pool as unknown as Pool, { rowLimit: 50, threshold: 50 });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(pool.queries.length, 1);
  const query = pool.queries[0];
  assert.ok(query.text.includes('FROM games owned'));
  assert.ok(query.text.includes('owned.igdb_game_id = g.igdb_game_id'));
  assert.ok(query.text.includes("(owned.payload->>'listType') IN ('collection', 'wishlist')"));
  assert.ok(query.text.includes('AND NOT EXISTS'));

  await app.close();
});

void test(
  'GET /v1/games/trending real postgres dedupes, excludes owned rows, and still fills the limit',
  { skip: popularityFeedDatabaseUrl.length === 0 },
  async () => {
    const schemaName = `popularity_feed_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const schemaIdent = quoteIdentifier(schemaName);
    const pool = new Pool({ connectionString: popularityFeedDatabaseUrl, max: 1 });
    const client = await pool.connect();
    const app = fastifyFactory({ logger: false });

    try {
      await client.query(`CREATE SCHEMA ${schemaIdent}`);
      await client.query(`SET search_path TO ${schemaIdent}, public`);
      await runMigrations(client);

      await insertGame(client, {
        igdbGameId: '100',
        platformIgdbId: 20,
        popularityScore: 300,
        payload: buildPopularityPayload('Tie Break Game', 20, 'Xbox Series X|S'),
      });
      await insertGame(client, {
        igdbGameId: '100',
        platformIgdbId: 10,
        popularityScore: 300,
        payload: buildPopularityPayload('Tie Break Game', 10, 'PC'),
      });
      await insertGame(client, {
        igdbGameId: '200',
        platformIgdbId: 30,
        popularityScore: 299,
        payload: buildPopularityPayload('Owned Game Candidate', 30, 'PlayStation 5'),
      });
      await insertGame(client, {
        igdbGameId: '200',
        platformIgdbId: 99,
        popularityScore: 1,
        payload: buildPopularityPayload('Owned Game Library Copy', 99, 'Library', 'collection'),
      });
      await insertGame(client, {
        igdbGameId: '300',
        platformIgdbId: 40,
        popularityScore: 298,
        payload: buildPopularityPayload('Fallback Valid Game', 40, 'Nintendo Switch'),
      });

      const queryablePool = {
        query: client.query.bind(client),
      } as unknown as Pool;
      await registerPopularityRoutes(app, queryablePool, { rowLimit: 2, threshold: 50 });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/games/trending',
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as {
        items: Array<{
          id: string;
          platformIgdbId: number;
          popularityScore: number;
        }>;
      };

      assert.equal(body.items.length, 2);
      assert.deepEqual(
        body.items.map((item) => item.id),
        ['100', '300']
      );
      assert.deepEqual(
        body.items.map((item) => item.platformIgdbId),
        [10, 40]
      );
      assert.deepEqual(
        body.items.map((item) => item.popularityScore),
        [300, 298]
      );
    } finally {
      await app.close();
      await client.query(`DROP SCHEMA IF EXISTS ${schemaIdent} CASCADE`);
      client.release();
      await pool.end();
    }
  }
);

void test('GET /v1/games/trending keeps post-query mapping filters for invalid rows', async () => {
  const app = fastifyFactory({ logger: false });
  await registerPopularityRoutes(
    app,
    new PoolMock([
      {
        igdb_game_id: '900',
        platform_igdb_id: 6,
        popularity_score: '210.2',
        payload: {
          title: 'Valid Game Entry',
          first_release_date: 1_700_000_000,
          platformOptions: [{ id: 6, name: 'PC' }],
        },
      },
      {
        igdb_game_id: '901',
        platform_igdb_id: 6,
        popularity_score: 'NaN',
        payload: { title: 'Invalid score' },
      },
    ]) as unknown as Pool,
    { rowLimit: 50, threshold: 50 }
  );

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending',
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    items: Array<{
      id: string;
      platformIgdbId: number;
      popularityScore: number;
    }>;
  };

  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]?.id, '900');
  assert.equal(body.items[0]?.platformIgdbId, 6);
  assert.equal(body.items[0]?.popularityScore, 210.2);

  await app.close();
});

void test('GET /v1/games/trending keeps hasMore when an extra fetched row is filtered out', async () => {
  const app = fastifyFactory({ logger: false });
  await registerPopularityRoutes(
    app,
    new PoolMock([
      {
        igdb_game_id: '900',
        platform_igdb_id: 6,
        popularity_score: '210.2',
        payload: {
          title: 'Valid Game Entry',
          first_release_date: 1_700_000_000,
          platformOptions: [{ id: 6, name: 'PC' }],
        },
      },
      {
        igdb_game_id: '901',
        platform_igdb_id: 6,
        popularity_score: 'NaN',
        payload: { title: 'Invalid score' },
      },
    ]) as unknown as Pool,
    { rowLimit: 50, threshold: 50 }
  );

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending?limit=1',
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    items: Array<{ id: string }>;
    page: { offset: number; limit: number; hasMore: boolean; nextOffset: number | null };
  };

  assert.deepEqual(
    body.items.map((item) => item.id),
    ['900']
  );
  assert.deepEqual(body.page, {
    offset: 0,
    limit: 1,
    hasMore: true,
    nextOffset: 1,
  });

  await app.close();
});

void test('GET /v1/games/trending does not pull the lookahead row into the current page', async () => {
  const app = fastifyFactory({ logger: false });
  await registerPopularityRoutes(
    app,
    new PoolMock([
      {
        igdb_game_id: '910',
        platform_igdb_id: 6,
        popularity_score: 'NaN',
        payload: { title: 'Invalid score' },
      },
      {
        igdb_game_id: '911',
        platform_igdb_id: 6,
        popularity_score: '205.1',
        payload: {
          title: 'Lookahead Only',
          first_release_date: 1_700_000_100,
          platformOptions: [{ id: 6, name: 'PC' }],
        },
      },
    ]) as unknown as Pool,
    { rowLimit: 50, threshold: 50 }
  );

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending?limit=1',
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    items: Array<{ id: string }>;
    page: { offset: number; limit: number; hasMore: boolean; nextOffset: number | null };
  };

  assert.deepEqual(body.items, []);
  assert.deepEqual(body.page, {
    offset: 0,
    limit: 1,
    hasMore: true,
    nextOffset: 1,
  });

  await app.close();
});

void test('GET /v1/games/trending caps response page metadata to the configured row limit', async () => {
  const app = fastifyFactory({ logger: false });
  const rows = Array.from({ length: 3 }, (_, index) => ({
    igdb_game_id: String(700 + index),
    platform_igdb_id: 6,
    popularity_score: String(200 - index),
    payload: {
      title: `Limited Game ${String(index)}`,
      first_release_date: 1_700_000_000 + index,
      platformOptions: [{ id: 6, name: 'PC' }],
    },
  }));

  await registerPopularityRoutes(app, new PoolMock(rows) as unknown as Pool, {
    rowLimit: 2,
    threshold: 50,
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending?limit=50',
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    items: Array<{ id: string }>;
    page: { offset: number; limit: number; hasMore: boolean; nextOffset: number | null };
  };

  assert.deepEqual(
    body.items.map((item) => item.id),
    ['700', '701']
  );
  assert.deepEqual(body.page, {
    offset: 0,
    limit: 2,
    hasMore: true,
    nextOffset: 2,
  });

  await app.close();
});

void test('GET /v1/games/trending caps oversized offsets to a safe maximum', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock([]);
  await registerPopularityRoutes(app, pool as unknown as Pool, { rowLimit: 50, threshold: 50 });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending?offset=5000&limit=1',
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    page: { offset: number; limit: number; hasMore: boolean; nextOffset: number | null };
  };
  assert.deepEqual(body.page, {
    offset: 1000,
    limit: 1,
    hasMore: false,
    nextOffset: null,
  });
  assert.equal(pool.queries.length, 1);
  assert.equal(pool.queries[0]?.params[2], 1000);

  await app.close();
});

void test('GET /v1/games/trending stops advertising next pages beyond the max offset cap', async () => {
  const app = fastifyFactory({ logger: false });
  await registerPopularityRoutes(
    app,
    new PoolMock([
      {
        igdb_game_id: '920',
        platform_igdb_id: 6,
        popularity_score: '220.1',
        payload: {
          title: 'Near cap page',
          first_release_date: 1_700_000_000,
          platformOptions: [{ id: 6, name: 'PC' }],
        },
      },
      {
        igdb_game_id: '921',
        platform_igdb_id: 6,
        popularity_score: '210.1',
        payload: {
          title: 'Unreachable next page',
          first_release_date: 1_700_000_001,
          platformOptions: [{ id: 6, name: 'PC' }],
        },
      },
    ]) as unknown as Pool,
    { rowLimit: 50, threshold: 50 }
  );

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending?offset=995&limit=10',
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    page: { offset: number; limit: number; hasMore: boolean; nextOffset: number | null };
  };
  assert.deepEqual(body.page, {
    offset: 995,
    limit: 10,
    hasMore: false,
    nextOffset: null,
  });

  await app.close();
});

void test('GET /v1/games/trending skips rows with invalid payload or non-finite score', async () => {
  const app = fastifyFactory({ logger: false });
  await registerPopularityRoutes(
    app,
    new PoolMock([
      {
        igdb_game_id: '500',
        platform_igdb_id: 6,
        popularity_score: '321.5',
        payload: {
          name: 'Valid Name Fallback',
          firstReleaseDate: 1_700_000_000,
          platform: 'PC',
          platformIgdbId: 6,
        },
      },
      {
        igdb_game_id: '501',
        platform_igdb_id: 6,
        popularity_score: '99.2',
        payload: [],
      },
      {
        igdb_game_id: '502',
        platform_igdb_id: 6,
        popularity_score: 'NaN',
        payload: {
          title: 'Invalid score',
        },
      },
    ]) as unknown as Pool,
    { rowLimit: 50, threshold: 50 }
  );

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending',
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    items: Array<{
      id: string;
      name: string;
      popularityScore: number;
      platforms: Array<{ id: number; name: string }>;
    }>;
  };

  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]?.id, '500');
  assert.equal(body.items[0]?.name, 'Valid Name Fallback');
  assert.equal(body.items[0]?.popularityScore, 321.5);
  assert.deepEqual(body.items[0]?.platforms, [{ id: 6, name: 'PC' }]);

  await app.close();
});

void test('GET /v1/games/trending uses the configured row limit value passed to the route', async () => {
  const app = fastifyFactory({ logger: false });
  const pool = new PoolMock([]);
  await registerPopularityRoutes(app, pool as unknown as Pool, { rowLimit: 200, threshold: 50 });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(pool.queries.length, 1);
  assert.equal(pool.queries[0]?.params[1], 11);

  await app.close();
});
