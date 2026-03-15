import assert from 'node:assert/strict';
import test from 'node:test';
import fastifyFactory from 'fastify';
import { registerPopularityRoutes } from './routes.js';

class PoolMock {
  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  query(): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }> {
    return Promise.resolve({
      rows: this.rows,
      rowCount: this.rows.length
    });
  }
}

void test('GET /v1/games/trending returns mapped popularity feed items', async () => {
  const app = fastifyFactory({ logger: false });
  await registerPopularityRoutes(
    app,
    new PoolMock([
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
    ]) as never,
    { threshold: 50 }
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
      firstReleaseDate: number | null;
    }>;
  };
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]?.id, '100');
  assert.equal(body.items[0]?.name, 'Test Game');
  assert.equal(body.items[0]?.popularityScore, 121.2);
  assert.equal(body.items[0]?.platforms[0]?.id, 6);
  assert.equal(body.items[0]?.firstReleaseDate, 1_700_000_000);

  await app.close();
});

void test('GET /v1/games/upcoming filters out already released games', async () => {
  const nowSec = Math.trunc(Date.now() / 1000);
  const app = fastifyFactory({ logger: false });
  await registerPopularityRoutes(
    app,
    new PoolMock([
      {
        igdb_game_id: '200',
        platform_igdb_id: 6,
        popularity_score: '88.4',
        payload: {
          title: 'Future Game',
          first_release_date: nowSec + 10_000,
          platformOptions: [{ id: 6, name: 'PC' }]
        }
      },
      {
        igdb_game_id: '201',
        platform_igdb_id: 6,
        popularity_score: '77.1',
        payload: {
          title: 'Past Game',
          first_release_date: nowSec - 10_000,
          platformOptions: [{ id: 6, name: 'PC' }]
        }
      }
    ]) as never,
    { threshold: 50 }
  );

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
    ]) as never,
    { threshold: 50 }
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
  await registerPopularityRoutes(
    app,
    new PoolMock([
      {
        igdb_game_id: '300',
        platform_igdb_id: 6,
        popularity_score: 99,
        payload: {
          title: 'Recent Game',
          releaseDate: new Date((nowSec - 10_000) * 1000).toISOString(),
          platformOptions: [{ id: 6, name: 'PC' }]
        }
      },
      {
        igdb_game_id: '301',
        platform_igdb_id: 6,
        popularity_score: 99,
        payload: {
          title: 'Old Game',
          first_release_date: nowSec - ninetyDaysSec - 10,
          platformOptions: [{ id: 6, name: 'PC' }]
        }
      }
    ]) as never,
    { threshold: 50 }
  );

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

  await app.close();
});

void test('GET /v1/games/trending includes platformIgdbId when igdb id appears on multiple platforms', async () => {
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
    ]) as never,
    { threshold: 50 }
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
    }>;
  };

  assert.equal(body.items.length, 2);
  assert.deepEqual(
    body.items.map((item) => ({ id: item.id, platformIgdbId: item.platformIgdbId })),
    [
      { id: '400', platformIgdbId: 6 },
      { id: '400', platformIgdbId: 167 }
    ]
  );

  await app.close();
});
