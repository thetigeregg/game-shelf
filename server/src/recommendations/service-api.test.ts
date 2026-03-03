import assert from 'node:assert/strict';
import test from 'node:test';
import { RecommendationService } from './service.js';
import type {
  NormalizedGameRecord,
  RankedRecommendationItem,
  RecommendationLaneCollection,
  RecommendationRunSummary,
  RecommendationRuntimeMode
} from './types.js';

const NOW = Date.parse('2026-03-03T10:00:00.000Z');

function baseOptions() {
  return {
    topLimit: 200,
    laneLimit: 20,
    similarityK: 20,
    staleHours: 24,
    failureBackoffMinutes: 120,
    semanticWeight: 2,
    similarityStructuredWeight: 0.6,
    similaritySemanticWeight: 0.4,
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 3,
    embeddingBatchSize: 32,
    runtimeModeDefault: 'NEUTRAL' as RecommendationRuntimeMode,
    explorationWeight: 0.3,
    diversityPenaltyWeight: 0.5,
    repeatPenaltyStep: 0.2,
    tuningMinRated: 8,
    keywordsStructuredMax: 100,
    keywordsEmbeddingMax: 40,
    keywordsGlobalMaxRatio: 0.7,
    keywordsStructuredMaxRatio: 0.3,
    keywordsMinLibraryCount: 3,
    keywordsWeight: 0.6,
    themesWeight: 1.3,
    similarityThemeWeight: 0.35,
    similarityGenreWeight: 0.25,
    similaritySeriesWeight: 0.2,
    similarityDeveloperWeight: 0.1,
    similarityPublisherWeight: 0.1,
    similarityKeywordWeight: 0.05,
    discoveryEnabled: false,
    discoveryPoolSize: 2000,
    discoveryRefreshHours: 24,
    discoveryPopularRefreshHours: 24,
    discoveryRecentRefreshHours: 6,
    discoveryIgdbRequestTimeoutMs: 15000,
    discoveryIgdbMaxRequestsPerSecond: 4
  };
}

function sampleRun(overrides: Partial<RecommendationRunSummary> = {}): RecommendationRunSummary {
  return {
    id: 1,
    target: 'BACKLOG',
    status: 'SUCCESS',
    settingsHash: 'settings',
    inputHash: 'input',
    startedAt: new Date(NOW - 1_000).toISOString(),
    finishedAt: new Date(NOW).toISOString(),
    error: null,
    ...overrides
  };
}

function sampleGame(): NormalizedGameRecord {
  return {
    igdbGameId: '100',
    platformIgdbId: 6,
    title: 'Game',
    listType: 'collection',
    discoverySource: null,
    status: null,
    rating: 4.5,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    releaseYear: 2024,
    runtimeHours: 12,
    summary: 'summary',
    storyline: 'story',
    reviewScore: 85,
    reviewSource: 'metacritic',
    metacriticScore: 85,
    mobyScore: null,
    genres: ['Action'],
    themes: ['Fantasy'],
    keywords: ['co-op'],
    developers: ['Nintendo'],
    publishers: ['Nintendo'],
    franchises: ['Mario'],
    collections: ['Super Mario']
  };
}

function sampleItem(): RankedRecommendationItem {
  return {
    igdbGameId: '100',
    platformIgdbId: 6,
    rank: 1,
    scoreTotal: 1,
    scoreComponents: {
      taste: 1,
      novelty: 0,
      runtimeFit: 0,
      criticBoost: 0,
      recencyBoost: 0,
      semantic: 0,
      exploration: 0,
      diversityPenalty: 0,
      repeatPenalty: 0
    },
    explanations: {
      headline: 'h',
      bullets: [],
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
  };
}

void test('service resolves runtime mode and read APIs with safe limits', async () => {
  const readTopCalls: Array<{ limit: number; runtimeMode: RecommendationRuntimeMode }> = [];
  const readLaneCalls: Array<{ limit: number; runtimeMode: RecommendationRuntimeMode }> = [];
  const readSimilarCalls: Array<{ limit: number }> = [];

  const lanes: RecommendationLaneCollection = {
    overall: [sampleItem()],
    hiddenGems: [],
    exploration: [],
    blended: [],
    popular: [],
    recent: []
  };

  const repository = {
    getRuntimeModeDefault: () => Promise.resolve('SHORT' as const),
    readTopRecommendations: (params: { limit: number; runtimeMode: RecommendationRuntimeMode }) => {
      readTopCalls.push({ limit: params.limit, runtimeMode: params.runtimeMode });
      return Promise.resolve({ run: sampleRun(), items: [sampleItem()] });
    },
    readRecommendationLanes: (params: {
      limit: number;
      runtimeMode: RecommendationRuntimeMode;
    }) => {
      readLaneCalls.push({ limit: params.limit, runtimeMode: params.runtimeMode });
      return Promise.resolve({ run: sampleRun(), lanes });
    },
    readSimilarGames: (params: { limit: number }) => {
      readSimilarCalls.push({ limit: params.limit });
      return Promise.resolve([
        {
          igdbGameId: '200',
          platformIgdbId: 6,
          similarity: 0.9,
          reasons: {
            summary: 's',
            structuredSimilarity: 0.8,
            semanticSimilarity: 0.9,
            blendedSimilarity: 0.85,
            sharedTokens: {
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
      ]);
    }
  };

  const service = new RecommendationService(repository as never, baseOptions(), {
    nowProvider: () => NOW
  });

  assert.equal(await service.resolveRuntimeMode('LONG'), 'LONG');
  assert.equal(await service.resolveRuntimeMode(undefined), 'SHORT');
  const top = await service.getTopRecommendations('BACKLOG', 999, undefined);
  assert.ok(top);
  assert.equal(top.runtimeMode, 'SHORT');
  const lanesResponse = await service.getRecommendationLanes('BACKLOG', 0, null);
  assert.ok(lanesResponse);
  const similar = await service.getSimilarGames({
    target: 'BACKLOG',
    igdbGameId: '100',
    platformIgdbId: 6,
    limit: 999
  });
  assert.equal(similar.length, 1);
  assert.deepEqual(readTopCalls, [{ limit: 200, runtimeMode: 'SHORT' }]);
  assert.deepEqual(readLaneCalls, [{ limit: 20, runtimeMode: 'SHORT' }]);
  assert.deepEqual(readSimilarCalls, [{ limit: 50 }]);
});

void test('service returns LOCKED when target lock cannot be acquired', async () => {
  const repository = {
    withTargetLock: () => Promise.resolve({ acquired: false as const })
  };

  const service = new RecommendationService(repository as never, baseOptions(), {
    nowProvider: () => NOW
  });

  const result = await service.rebuild({ target: 'BACKLOG' });
  assert.deepEqual(result, {
    target: 'BACKLOG',
    status: 'LOCKED'
  });
});

void test('service skips scheduler rebuild during failure backoff', async () => {
  const repository = {
    withTargetLock: async (target: string, callback: (client: object) => Promise<unknown>) => ({
      acquired: true as const,
      value: await callback({})
    }),
    getLatestRun: () =>
      Promise.resolve(
        sampleRun({
          status: 'FAILED',
          startedAt: new Date(NOW - 5 * 60 * 1000).toISOString(),
          finishedAt: new Date(NOW - 5 * 60 * 1000).toISOString()
        })
      )
  };

  const service = new RecommendationService(repository as never, baseOptions(), {
    nowProvider: () => NOW
  });

  const result = await service.rebuild({
    target: 'BACKLOG',
    triggeredBy: 'scheduler'
  });
  assert.deepEqual(result, {
    target: 'BACKLOG',
    status: 'BACKOFF_SKIPPED'
  });
});

void test('service rebuild runs success path and supports stale checks', async () => {
  const createdRuns: Array<{ settingsHash: string; inputHash: string }> = [];
  let finalizeCalled = 0;

  const repository = {
    withTargetLock: async (_target: string, callback: (client: object) => Promise<unknown>) => ({
      acquired: true as const,
      value: await callback({})
    }),
    getLatestRun: () => Promise.resolve(null),
    listNormalizedGames: () => Promise.resolve([sampleGame()]),
    listRecommendationHistory: () => Promise.resolve(new Map()),
    getLatestSuccessfulRun: () => Promise.resolve(null),
    createRun: (params: { settingsHash: string; inputHash: string }) => {
      createdRuns.push({ settingsHash: params.settingsHash, inputHash: params.inputHash });
      return Promise.resolve(5);
    },
    finalizeRunSuccess: () => {
      finalizeCalled += 1;
      return Promise.resolve();
    },
    markRunFailed: () => {
      assert.fail('markRunFailed should not be called in success path');
    },
    getLatestSuccessfulRunForTarget: () => Promise.resolve(null)
  };

  const embeddingRepository = {
    listGameEmbeddings: () => Promise.resolve([]),
    upsertGameEmbeddings: () => Promise.resolve(undefined)
  };
  const embeddingClient = {
    generateEmbeddings: () => Promise.resolve([[0.1, 0.2, 0.3]])
  };

  const service = new RecommendationService(repository as never, baseOptions(), {
    embeddingRepository: embeddingRepository as never,
    embeddingClient,
    nowProvider: () => NOW
  });

  const result = await service.rebuild({
    target: 'BACKLOG',
    force: true
  });
  assert.deepEqual(result, {
    target: 'BACKLOG',
    runId: 5,
    status: 'SUCCESS'
  });
  assert.equal(createdRuns.length, 1);
  assert.equal(finalizeCalled, 1);

  const freshRepository = {
    ...repository,
    getLatestSuccessfulRun: () =>
      Promise.resolve(
        sampleRun({
          finishedAt: new Date(NOW - 60_000).toISOString()
        })
      )
  };
  const freshService = new RecommendationService(freshRepository as never, baseOptions(), {
    embeddingRepository: embeddingRepository as never,
    embeddingClient,
    nowProvider: () => NOW
  });
  const staleResult = await freshService.rebuildIfStale('BACKLOG', 'scheduler');
  assert.equal(staleResult, null);
});

void test('service handles null top/lanes reads and stale-triggered rebuild path', async () => {
  const repository = {
    getRuntimeModeDefault: () => Promise.resolve(null),
    readTopRecommendations: () => Promise.resolve(null),
    readRecommendationLanes: () => Promise.resolve(null),
    getLatestSuccessfulRun: () =>
      Promise.resolve(
        sampleRun({
          finishedAt: new Date(NOW - 48 * 60 * 60 * 1000).toISOString()
        })
      ),
    withTargetLock: () => Promise.resolve({ acquired: false as const })
  };

  const service = new RecommendationService(repository as never, baseOptions(), {
    nowProvider: () => NOW
  });

  assert.equal(await service.getTopRecommendations('BACKLOG', 10, undefined), null);
  assert.equal(await service.getRecommendationLanes('BACKLOG', 10, undefined), null);
  const staleResult = await service.rebuildIfStale('BACKLOG', 'scheduler');
  assert.deepEqual(staleResult, {
    target: 'BACKLOG',
    status: 'LOCKED'
  });
});

void test('service rebuild returns SKIPPED when input/settings hashes match latest success', async () => {
  let latestSuccessful: RecommendationRunSummary | null = null;
  const repository = {
    withTargetLock: async (_target: string, callback: (client: object) => Promise<unknown>) => ({
      acquired: true as const,
      value: await callback({})
    }),
    getLatestRun: () => Promise.resolve(null),
    listNormalizedGames: () => Promise.resolve([sampleGame()]),
    listRecommendationHistory: () => Promise.resolve(new Map()),
    getLatestSuccessfulRun: () => Promise.resolve(latestSuccessful),
    createRun: (params: { settingsHash: string; inputHash: string }) => {
      latestSuccessful = sampleRun({
        id: 77,
        settingsHash: params.settingsHash,
        inputHash: params.inputHash
      });
      return Promise.resolve(77);
    },
    finalizeRunSuccess: () => Promise.resolve(undefined),
    markRunFailed: () => {
      assert.fail('markRunFailed should not be called');
    }
  };

  const embeddingRepository = {
    listGameEmbeddings: () => Promise.resolve([]),
    upsertGameEmbeddings: () => Promise.resolve(undefined)
  };
  const embeddingClient = {
    generateEmbeddings: () => Promise.resolve([[0.1, 0.2, 0.3]])
  };

  const service = new RecommendationService(repository as never, baseOptions(), {
    embeddingRepository: embeddingRepository as never,
    embeddingClient,
    nowProvider: () => NOW
  });

  const first = await service.rebuild({ target: 'BACKLOG', force: true });
  assert.equal(first.status, 'SUCCESS');

  const second = await service.rebuild({ target: 'BACKLOG', force: false });
  assert.deepEqual(second, {
    target: 'BACKLOG',
    runId: 77,
    status: 'SKIPPED',
    reusedRunId: 77
  });
});

void test('service rebuild marks run failed when embedding vectors are invalid', async () => {
  let markRunFailedCalls = 0;
  const repository = {
    withTargetLock: async (_target: string, callback: (client: object) => Promise<unknown>) => ({
      acquired: true as const,
      value: await callback({})
    }),
    getLatestRun: () => Promise.resolve(null),
    listNormalizedGames: () => Promise.resolve([sampleGame()]),
    listRecommendationHistory: () => Promise.resolve(new Map()),
    getLatestSuccessfulRun: () => Promise.resolve(null),
    createRun: () => Promise.resolve(44),
    finalizeRunSuccess: () => {
      assert.fail('finalizeRunSuccess should not be called in failed rebuild');
    },
    markRunFailed: () => {
      markRunFailedCalls += 1;
      return Promise.resolve();
    }
  };
  const embeddingRepository = {
    listGameEmbeddings: () => Promise.resolve([]),
    upsertGameEmbeddings: () => Promise.resolve(undefined)
  };
  const embeddingClient = {
    generateEmbeddings: () => Promise.resolve([[0.1, 0.2]])
  };

  const service = new RecommendationService(repository as never, baseOptions(), {
    embeddingRepository: embeddingRepository as never,
    embeddingClient,
    nowProvider: () => NOW
  });

  const result = await service.rebuild({
    target: 'BACKLOG',
    force: true
  });
  assert.deepEqual(result, {
    target: 'BACKLOG',
    runId: 44,
    status: 'FAILED'
  });
  assert.equal(markRunFailedCalls, 1);
});

void test('service constructor can build default dependencies', () => {
  const service = new RecommendationService({} as never, {
    ...baseOptions(),
    discoveryEnabled: true
  });
  assert.ok(service);
});
