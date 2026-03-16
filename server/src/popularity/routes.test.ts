import assert from 'node:assert/strict';
import test from 'node:test';
import fastifyFactory from 'fastify';
import type { Pool, QueryResult, QueryResultRow } from 'pg';
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
      rowCount: this.rows.length
    } as QueryResult<T>);
  }
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
        platformOptions: [{ id: 6, name: 'PC' }]
      }
    }
  ]);
  await registerPopularityRoutes(app, pool as unknown as Pool, { rowLimit, threshold });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending'
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
  assert.ok(query.text.includes('LIMIT $2'));
  assert.equal(query.params[0], threshold);
  assert.equal(query.params[1], rowLimit);

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
        platformOptions: [{ id: 6, name: 'PC' }]
      }
    }
  ]);
  await registerPopularityRoutes(app, pool as unknown as Pool, { rowLimit: 50, threshold: 50 });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/upcoming'
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
  assert.equal(query.params[2], 50);
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
          title: 'Legacy Platform Game'
        }
      }
    ]) as unknown as Pool,
    { rowLimit: 50, threshold: 50 }
  );

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending'
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
        platformOptions: [{ id: 6, name: 'PC' }]
      }
    }
  ]);
  await registerPopularityRoutes(app, pool as unknown as Pool, { rowLimit: 50, threshold: 50 });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/recent'
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
  assert.equal(query.params[3], 50);
  assert.equal(typeof query.params[1], 'number');
  assert.equal(typeof query.params[2], 'number');
  assert.equal(Number(query.params[1]) - Number(query.params[2]), ninetyDaysSec);

  await app.close();
});

void test('GET /v1/games/trending dedupes by igdb id across multiple platforms and keeps highest score', async () => {
  const app = fastifyFactory({ logger: false });
  await registerPopularityRoutes(
    app,
    new PoolMock([
      {
        igdb_game_id: '400',
        platform_igdb_id: 6,
        popularity_score: '200.1',
        payload: {
          title: 'Cross Platform Game',
          first_release_date: 1_700_000_000,
          platformOptions: [{ id: 6, name: 'PC' }]
        }
      },
      {
        igdb_game_id: '400',
        platform_igdb_id: 167,
        popularity_score: '199.9',
        payload: {
          title: 'Cross Platform Game',
          first_release_date: 1_700_000_000,
          platformOptions: [{ id: 167, name: 'PlayStation 5' }]
        }
      }
    ]) as unknown as Pool,
    { rowLimit: 50, threshold: 50 }
  );

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending'
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
  assert.equal(body.items[0]?.id, '400');
  assert.equal(body.items[0]?.platformIgdbId, 6);
  assert.equal(body.items[0]?.popularityScore, 200.1);

  await app.close();
});

void test('GET /v1/games/trending dedupes duplicate rows by game id and keeps highest score', async () => {
  const app = fastifyFactory({ logger: false });
  await registerPopularityRoutes(
    app,
    new PoolMock([
      {
        igdb_game_id: '900',
        platform_igdb_id: 6,
        popularity_score: '210.2',
        payload: {
          title: 'Duplicate Game Entry',
          first_release_date: 1_700_000_000,
          platformOptions: [{ id: 6, name: 'PC' }]
        }
      },
      {
        igdb_game_id: '900',
        platform_igdb_id: 6,
        popularity_score: '209.1',
        payload: {
          title: 'Duplicate Game Entry',
          first_release_date: 1_700_000_000,
          platformOptions: [{ id: 6, name: 'PC' }]
        }
      }
    ]) as unknown as Pool,
    { rowLimit: 50, threshold: 50 }
  );

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending'
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
          platformIgdbId: 6
        }
      },
      {
        igdb_game_id: '501',
        platform_igdb_id: 6,
        popularity_score: '99.2',
        payload: []
      },
      {
        igdb_game_id: '502',
        platform_igdb_id: 6,
        popularity_score: 'NaN',
        payload: {
          title: 'Invalid score'
        }
      }
    ]) as unknown as Pool,
    { rowLimit: 50, threshold: 50 }
  );

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/trending'
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
    url: '/v1/games/trending'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(pool.queries.length, 1);
  assert.equal(pool.queries[0]?.params[1], 200);

  await app.close();
});
