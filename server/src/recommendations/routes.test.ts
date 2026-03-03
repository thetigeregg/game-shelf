import assert from 'node:assert/strict';
import test from 'node:test';
import fastifyFactory from 'fastify';
import { registerRecommendationRoutes } from './routes.js';
import { RecommendationServiceApi } from './service.js';
import { RecommendationRuntimeMode } from './types.js';

function createServiceMock(
  overrides?: Partial<RecommendationServiceApi>
): RecommendationServiceApi {
  const base: RecommendationServiceApi = {
    rebuildIfStale: () => Promise.resolve(null),
    resolveRuntimeMode: (runtimeMode) => Promise.resolve(runtimeMode ?? 'NEUTRAL'),
    getTopRecommendations: (_target, _limit, runtimeMode) =>
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
        runtimeMode: runtimeMode ?? 'NEUTRAL',
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
              recencyBoost: 0.13,
              semantic: 0.2,
              exploration: 0.2,
              diversityPenalty: -0.1,
              repeatPenalty: -0.2
            },
            explanations: {
              headline: 'Matches your tastes',
              bullets: [
                {
                  type: 'semantic',
                  label: 'Semantic match with games you rate highly',
                  evidence: ['semantic:embedding-cosine'],
                  delta: 0.2
                }
              ],
              matchedTokens: {
                genres: [],
                developers: [],
                publishers: [],
                franchises: [],
                collections: [],
                themes: [],
                keywords: []
              }
            }
          }
        ]
      }),
    getRecommendationLanes: (_target, _limit, runtimeMode) =>
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
        runtimeMode: runtimeMode ?? 'NEUTRAL',
        lanes: {
          overall: [],
          hiddenGems: [],
          exploration: [],
          blended: [],
          popular: [],
          recent: []
        }
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
            structuredSimilarity: 0.8,
            semanticSimilarity: 0.7,
            blendedSimilarity: 0.76,
            sharedTokens: {
              genres: [],
              developers: [],
              publishers: [],
              franchises: [],
              collections: ['Mario'],
              themes: [],
              keywords: []
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
    url: '/v1/recommendations/top?target=BACKLOG&runtimeMode=SHORT&limit=10'
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    target: string;
    runtimeMode: RecommendationRuntimeMode;
    items: Array<{
      scoreComponents?: { semantic?: number };
      explanations?: { matchedTokens?: { themes?: string[]; keywords?: string[] } };
    }>;
  };
  assert.equal(body.target, 'BACKLOG');
  assert.equal(body.runtimeMode, 'SHORT');
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]?.scoreComponents?.semantic, 0.2);
  assert.deepEqual(body.items[0]?.explanations?.matchedTokens?.themes, []);
  assert.deepEqual(body.items[0]?.explanations?.matchedTokens?.keywords, []);

  await app.close();
});

void test('GET /v1/recommendations/top accepts DISCOVERY target', async () => {
  const app = fastifyFactory({ logger: false });
  await registerRecommendationRoutes(app, createServiceMock());

  const response = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/top?target=DISCOVERY&runtimeMode=NEUTRAL&limit=5'
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as { target: string };
  assert.equal(body.target, 'DISCOVERY');

  await app.close();
});

void test('GET /v1/recommendations/lanes returns lanes and resolves runtime fallback', async () => {
  const app = fastifyFactory({ logger: false });
  await registerRecommendationRoutes(app, createServiceMock());

  const response = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/lanes?target=BACKLOG&limit=10'
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    runtimeMode: RecommendationRuntimeMode;
    lanes: {
      overall: unknown[];
      hiddenGems: unknown[];
      exploration: unknown[];
      blended: unknown[];
      popular: unknown[];
      recent: unknown[];
    };
  };
  assert.equal(body.runtimeMode, 'NEUTRAL');
  assert.ok(Array.isArray(body.lanes.overall));
  assert.ok(Array.isArray(body.lanes.hiddenGems));
  assert.ok(Array.isArray(body.lanes.exploration));
  assert.ok(Array.isArray(body.lanes.blended));
  assert.ok(Array.isArray(body.lanes.popular));
  assert.ok(Array.isArray(body.lanes.recent));

  await app.close();
});

void test('GET /v1/recommendations/top and /lanes validate runtime mode and not-found responses', async () => {
  const app = fastifyFactory({ logger: false });
  await registerRecommendationRoutes(
    app,
    createServiceMock({
      getTopRecommendations: () => Promise.resolve(null),
      getRecommendationLanes: () => Promise.resolve(null)
    })
  );

  const invalidTopRuntime = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/top?target=BACKLOG&runtimeMode=FAST'
  });
  assert.equal(invalidTopRuntime.statusCode, 400);

  const notFoundTop = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/top?target=BACKLOG&limit=invalid'
  });
  assert.equal(notFoundTop.statusCode, 404);

  const invalidLanesRuntime = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/lanes?target=BACKLOG&runtimeMode=FAST'
  });
  assert.equal(invalidLanesRuntime.statusCode, 400);

  const notFoundLanes = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/lanes?target=BACKLOG'
  });
  assert.equal(notFoundLanes.statusCode, 404);

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

void test('POST /v1/recommendations/rebuild handles backoff, failed, and skipped payloads', async () => {
  const app = fastifyFactory({ logger: false });
  const states: Array<'BACKOFF_SKIPPED' | 'FAILED' | 'SKIPPED'> = [
    'BACKOFF_SKIPPED',
    'FAILED',
    'SKIPPED'
  ];
  await registerRecommendationRoutes(
    app,
    createServiceMock({
      rebuild: () => {
        const state = states.shift();
        if (state === 'BACKOFF_SKIPPED') {
          return Promise.resolve({ target: 'BACKLOG', status: 'BACKOFF_SKIPPED' as const });
        }
        if (state === 'FAILED') {
          return Promise.resolve({ target: 'BACKLOG', runId: 8, status: 'FAILED' as const });
        }
        return Promise.resolve({
          target: 'BACKLOG',
          runId: 9,
          status: 'SKIPPED' as const,
          reusedRunId: 7
        });
      }
    })
  );

  const backoff = await app.inject({
    method: 'POST',
    url: '/v1/recommendations/rebuild',
    payload: { target: 'BACKLOG', force: true }
  });
  assert.equal(backoff.statusCode, 429);

  const failed = await app.inject({
    method: 'POST',
    url: '/v1/recommendations/rebuild',
    payload: { target: 'BACKLOG' }
  });
  assert.equal(failed.statusCode, 500);

  const skipped = await app.inject({
    method: 'POST',
    url: '/v1/recommendations/rebuild',
    payload: { target: 'BACKLOG' }
  });
  assert.equal(skipped.statusCode, 200);
  const body = JSON.parse(skipped.body) as { reusedRunId?: number | null; status?: string };
  assert.equal(body.status, 'SKIPPED');
  assert.equal(body.reusedRunId, 7);

  await app.close();
});

void test('GET /v1/recommendations/similar requires platformIgdbId and returns items', async () => {
  const app = fastifyFactory({ logger: false });
  await registerRecommendationRoutes(app, createServiceMock());

  const invalid = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/similar/123?target=BACKLOG'
  });

  assert.equal(invalid.statusCode, 400);

  const invalidTarget = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/similar/123?platformIgdbId=6'
  });

  assert.equal(invalidTarget.statusCode, 400);

  const invalidId = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/similar/not-numeric?target=BACKLOG&platformIgdbId=6'
  });
  assert.equal(invalidId.statusCode, 400);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/similar/123?target=BACKLOG&platformIgdbId=6&limit=5'
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    items: Array<{
      reasons?: {
        blendedSimilarity?: number;
        sharedTokens?: { themes?: string[]; keywords?: string[] };
      };
    }>;
  };
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]?.reasons?.blendedSimilarity, 0.76);
  assert.deepEqual(body.items[0]?.reasons?.sharedTokens?.themes, []);
  assert.deepEqual(body.items[0]?.reasons?.sharedTokens?.keywords, []);

  await app.close();
});
