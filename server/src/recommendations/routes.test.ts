import assert from 'node:assert/strict';
import test from 'node:test';
import fastifyFactory from 'fastify';
import { registerRecommendationRoutes } from './routes.js';
import { RecommendationServiceApi } from './service.js';

function createServiceMock(
  overrides?: Partial<RecommendationServiceApi>
): RecommendationServiceApi {
  const base = {
    rebuildIfStale: () => Promise.resolve(null),
    getTopRecommendations: () =>
      Promise.resolve({
        run: {
          id: 11,
          target: 'BACKLOG' as const,
          status: 'SUCCESS' as const,
          settingsHash: 'settings',
          inputHash: 'input',
          startedAt: '2026-01-01T00:00:00.000Z',
          finishedAt: '2026-01-01T00:01:00.000Z',
          error: null
        },
        items: [
          {
            rank: 1,
            igdbGameId: '1',
            platformIgdbId: 6,
            scoreTotal: 1.23,
            scoreComponents: {
              taste: 1,
              novelty: 0,
              runtimeFit: 0,
              criticBoost: 0.1,
              recencyBoost: 0.13
            },
            explanations: {
              headline: 'Matches your tastes',
              bullets: [],
              matchedTokens: {
                genres: [],
                developers: [],
                publishers: [],
                franchises: [],
                collections: []
              }
            }
          }
        ]
      }),
    rebuild: () =>
      Promise.resolve({ target: 'BACKLOG' as const, runId: 12, status: 'SUCCESS' as const }),
    getSimilarGames: () =>
      Promise.resolve([
        {
          igdbGameId: '2',
          platformIgdbId: 6,
          similarity: 0.88,
          reasons: {
            summary: 'same series',
            sharedTokens: {
              genres: [],
              developers: [],
              publishers: [],
              franchises: [],
              collections: ['Mario']
            }
          }
        }
      ])
  };

  return { ...base, ...overrides };
}

void test('GET /v1/recommendations/top returns latest recommendations', async () => {
  const app = fastifyFactory({ logger: false });
  await registerRecommendationRoutes(app, createServiceMock());

  const response = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/top?target=BACKLOG&limit=10'
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as { target: string; items: unknown[] };
  assert.equal(body.target, 'BACKLOG');
  assert.equal(body.items.length, 1);

  await app.close();
});

void test('POST /v1/recommendations/rebuild validates target and handles locks', async () => {
  const app = fastifyFactory({ logger: false });
  await registerRecommendationRoutes(
    app,
    createServiceMock({
      rebuild: () => Promise.resolve({ target: 'BACKLOG', status: 'LOCKED' })
    })
  );

  const invalid = await app.inject({
    method: 'POST',
    url: '/v1/recommendations/rebuild',
    payload: {}
  });

  assert.equal(invalid.statusCode, 400);

  const locked = await app.inject({
    method: 'POST',
    url: '/v1/recommendations/rebuild',
    payload: { target: 'BACKLOG' }
  });

  assert.equal(locked.statusCode, 409);

  await app.close();
});

void test('GET /v1/recommendations/similar requires platformIgdbId and returns items', async () => {
  const app = fastifyFactory({ logger: false });
  await registerRecommendationRoutes(app, createServiceMock());

  const invalid = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/similar/123'
  });

  assert.equal(invalid.statusCode, 400);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/similar/123?platformIgdbId=6&limit=5'
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as { items: unknown[] };
  assert.equal(body.items.length, 1);

  await app.close();
});
