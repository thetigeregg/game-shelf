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

void test('service discovery rebuild refreshes per-source pool, prunes, and enriches', async () => {
  const upsertDiscoveryCalls: Array<{ source: string; rows: number }> = [];
  const pruneCalls: Array<{ source: string; keepKeys: string[] }> = [];
  const settingsWrites: Array<{ key: string; value: string }> = [];
  const fetchedSources: string[] = [];
  let enrichCalls = 0;

  const catalogGame = sampleGame();
  const ratedLibraryGame: NormalizedGameRecord = {
    ...catalogGame,
    igdbGameId: '10',
    platformIgdbId: 6,
    listType: 'collection',
    rating: 4.5,
    status: 'wantToPlay'
  };
  const discoveryPopular: NormalizedGameRecord = {
    ...catalogGame,
    igdbGameId: '20',
    platformIgdbId: 6,
    listType: 'discovery',
    discoverySource: 'popular',
    rating: null,
    status: null
  };
  const discoveryRecent: NormalizedGameRecord = {
    ...catalogGame,
    igdbGameId: '30',
    platformIgdbId: 48,
    listType: 'discovery',
    discoverySource: 'recent',
    rating: null,
    status: null
  };
  const games = [ratedLibraryGame, discoveryPopular, discoveryRecent];

  const repository = {
    withTargetLock: async (_target: string, callback: (client: object) => Promise<unknown>) => ({
      acquired: true as const,
      value: await callback({})
    }),
    getLatestRun: () => Promise.resolve(null),
    listNormalizedGames: () => Promise.resolve(games),
    listRecommendationHistory: () => Promise.resolve(new Map()),
    getLatestSuccessfulRun: () => Promise.resolve(null),
    createRun: () => Promise.resolve(55),
    finalizeRunSuccess: () => Promise.resolve(undefined),
    markRunFailed: () => Promise.resolve(),
    getDiscoveryPoolLatestUpdatedAt: () => Promise.resolve(null),
    getSetting: (key: string) => {
      if (key.startsWith('recommendations.discovery.source_last_refreshed.')) {
        return Promise.resolve('1970-01-01T00:00:00.000Z');
      }
      if (key.startsWith('recommendations.discovery.source_hash.')) {
        return Promise.resolve('different-hash');
      }
      return Promise.resolve(null);
    },
    upsertDiscoveryGames: (params: { rows: Array<{ payload: Record<string, unknown> }> }) => {
      const rawSource = params.rows[0]?.payload['discoverySource'];
      const source = typeof rawSource === 'string' ? rawSource : '';
      upsertDiscoveryCalls.push({ source, rows: params.rows.length });
      return Promise.resolve();
    },
    pruneDiscoveryGamesBySource: (params: { source: string; keepKeys: string[] }) => {
      pruneCalls.push({ source: params.source, keepKeys: params.keepKeys });
      return Promise.resolve();
    },
    upsertSetting: (params: { settingKey: string; settingValue: string }) => {
      settingsWrites.push({ key: params.settingKey, value: params.settingValue });
      return Promise.resolve();
    }
  };

  const discoveryClient = {
    fetchDiscoveryCandidatesBySource: (params: {
      source: 'popular' | 'recent';
      poolSize: number;
      preferredPlatformIds: number[];
    }) => {
      fetchedSources.push(
        `${params.source}:${String(params.poolSize)}:${params.preferredPlatformIds.join(',')}`
      );
      const shared = {
        source: params.source,
        sourceScore: params.source === 'popular' ? 0.9 : 0.8
      } as const;
      return Promise.resolve([
        // Strict-excluded because key matches existing collection game (10::6).
        { igdbGameId: '10', platformIgdbId: 6, payload: {}, ...shared },
        {
          igdbGameId: params.source === 'popular' ? '21' : '31',
          platformIgdbId: 6,
          payload: {},
          ...shared
        }
      ]);
    }
  };

  const discoveryEnrichmentService = {
    enrichNow: (_params: { limit: number }) => {
      enrichCalls += 1;
      return Promise.resolve({ scanned: 0, updated: 0, skipped: 0 });
    }
  };

  const embeddingRepository = {
    listGameEmbeddings: () => Promise.resolve([]),
    upsertGameEmbeddings: () => Promise.resolve(undefined)
  };
  const embeddingClient = {
    generateEmbeddings: () =>
      Promise.resolve(
        games.map((_game, index) => [1 + index * 0.01, 0.5 + index * 0.01, 0.25 + index * 0.01])
      )
  };

  const service = new RecommendationService(
    repository as never,
    { ...baseOptions(), discoveryEnabled: true },
    {
      embeddingRepository: embeddingRepository as never,
      embeddingClient,
      discoveryClient: discoveryClient as never,
      discoveryEnrichmentService: discoveryEnrichmentService as never,
      nowProvider: () => NOW
    }
  );

  const result = await service.rebuild({ target: 'DISCOVERY', force: false });
  assert.deepEqual(result, {
    target: 'DISCOVERY',
    runId: 55,
    status: 'SUCCESS'
  });
  assert.equal(fetchedSources.length, 2);
  assert.ok(fetchedSources.some((value) => value.startsWith('popular:2000:6')));
  assert.ok(fetchedSources.some((value) => value.startsWith('recent:2000:6')));
  assert.deepEqual(upsertDiscoveryCalls.map((entry) => entry.source).sort(), ['popular', 'recent']);
  assert.ok(upsertDiscoveryCalls.every((entry) => entry.rows === 1));
  assert.deepEqual(pruneCalls.map((entry) => entry.source).sort(), ['popular', 'recent']);
  assert.ok(
    settingsWrites.some(
      (entry) =>
        entry.key === 'recommendations.discovery.source_hash.popular' && entry.value.length > 0
    )
  );
  assert.ok(
    settingsWrites.some(
      (entry) => entry.key === 'recommendations.discovery.source_last_refreshed.recent'
    )
  );
  assert.equal(enrichCalls, 1);
});

void test('service discovery rebuild skips source refresh when markers are fresh', async () => {
  let discoveryFetchCalls = 0;
  const games: NormalizedGameRecord[] = [
    {
      ...sampleGame(),
      igdbGameId: '11',
      platformIgdbId: 6,
      listType: 'collection',
      rating: 4.5,
      status: null
    },
    {
      ...sampleGame(),
      igdbGameId: '22',
      platformIgdbId: 6,
      listType: 'discovery',
      discoverySource: 'popular',
      rating: null,
      status: null
    }
  ];

  const repository = {
    withTargetLock: async (_target: string, callback: (client: object) => Promise<unknown>) => ({
      acquired: true as const,
      value: await callback({})
    }),
    getLatestRun: () => Promise.resolve(null),
    listNormalizedGames: () => Promise.resolve(games),
    listRecommendationHistory: () => Promise.resolve(new Map()),
    getLatestSuccessfulRun: () => Promise.resolve(null),
    createRun: () => Promise.resolve(56),
    finalizeRunSuccess: () => Promise.resolve(undefined),
    markRunFailed: () => Promise.resolve(),
    getDiscoveryPoolLatestUpdatedAt: () => Promise.resolve(null),
    getSetting: (key: string) => {
      if (key.startsWith('recommendations.discovery.source_last_refreshed.')) {
        return Promise.resolve(new Date(NOW).toISOString());
      }
      return Promise.resolve(null);
    },
    upsertDiscoveryGames: () => Promise.resolve(),
    pruneDiscoveryGamesBySource: () => Promise.resolve(),
    upsertSetting: () => Promise.resolve()
  };
  const discoveryClient = {
    fetchDiscoveryCandidatesBySource: () => {
      discoveryFetchCalls += 1;
      return Promise.resolve([]);
    }
  };
  const embeddingRepository = {
    listGameEmbeddings: () => Promise.resolve([]),
    upsertGameEmbeddings: () => Promise.resolve(undefined)
  };
  const embeddingClient = {
    generateEmbeddings: () =>
      Promise.resolve(games.map((_game, index) => [0.1 + index * 0.01, 0.2, 0.3]))
  };

  const service = new RecommendationService(
    repository as never,
    { ...baseOptions(), discoveryEnabled: true },
    {
      embeddingRepository: embeddingRepository as never,
      embeddingClient,
      discoveryClient: discoveryClient as never,
      nowProvider: () => NOW
    }
  );

  const result = await service.rebuild({ target: 'DISCOVERY', force: false });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(discoveryFetchCalls, 0);
});
