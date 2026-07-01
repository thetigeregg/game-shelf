import assert from 'node:assert/strict';
import test from 'node:test';
import { MetadataEnrichmentService } from './service.js';
import { IgdbMetadataRecord, MetadataEnrichmentGameRow } from './types.js';

class RepositoryMock {
  public rows: MetadataEnrichmentGameRow[] = [];
  public updates: Array<{
    igdbGameId: string;
    platformIgdbId: number;
    payloadPatch: Record<string, unknown>;
  }> = [];
  public lockAcquired = true;

  async withAdvisoryLock<T>(
    callback: (client: object) => Promise<T>
  ): Promise<{ acquired: true; value: T } | { acquired: false }> {
    if (!this.lockAcquired) {
      return { acquired: false };
    }

    const value = await callback({});
    return { acquired: true, value };
  }

  listRowsMissingMetadata(params: {
    limit: number;
    refreshMonths?: number;
    refreshDays?: number;
    queryable?: object;
  }): Promise<MetadataEnrichmentGameRow[]> {
    return Promise.resolve(this.rows.slice(0, params.limit));
  }

  updateGamePayload(params: {
    igdbGameId: string;
    platformIgdbId: number;
    payloadPatch: Record<string, unknown>;
  }): Promise<void> {
    this.updates.push(params);
    const row = this.rows.find(
      (entry) =>
        entry.igdbGameId === params.igdbGameId && entry.platformIgdbId === params.platformIgdbId
    );
    if (row) {
      row.payload = { ...row.payload, ...params.payloadPatch };
    }
    return Promise.resolve();
  }
}

class IgdbClientMock {
  public failuresForBatchContaining = new Set<string>();

  constructor(private readonly data: Map<string, IgdbMetadataRecord>) {}

  fetchGameMetadataByIds(gameIds: string[]): Promise<Map<string, IgdbMetadataRecord>> {
    if (gameIds.some((id) => this.failuresForBatchContaining.has(id))) {
      return Promise.reject(new Error('igdb_failed'));
    }

    const out = new Map<string, IgdbMetadataRecord>();
    for (const gameId of gameIds) {
      const value = this.data.get(gameId);
      if (value) {
        out.set(gameId, value);
      }
    }
    return Promise.resolve(out);
  }
}

void test('metadata enrichment start skips scheduling when disabled', () => {
  const service = new MetadataEnrichmentService(
    new RepositoryMock() as never,
    new IgdbClientMock(new Map()) as never,
    {
      enabled: false,
      batchSize: 200,
      maxGamesPerRun: 5000,
      startupDelayMs: 25,
      refreshMonths: 0,
      refreshDays: 0,
    }
  );

  let scheduled = false;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((...args: unknown[]) => {
    scheduled = true;
    return originalSetTimeout(...(args as Parameters<typeof setTimeout>));
  }) as typeof setTimeout;

  try {
    service.start();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.equal(scheduled, false);
});

void test('metadata enrichment start schedules immediate run and logs startup failures', async () => {
  const service = new MetadataEnrichmentService(
    new RepositoryMock() as never,
    new IgdbClientMock(new Map()) as never,
    {
      enabled: true,
      batchSize: 200,
      maxGamesPerRun: 5000,
      startupDelayMs: -10,
      refreshMonths: 0,
      refreshDays: 0,
    }
  );

  let scheduledDelay: number | undefined;
  let scheduledCallback: (() => void) | undefined;
  let loggedMessage: string | undefined;
  let loggedPayload: unknown;

  const originalSetTimeout = globalThis.setTimeout;
  const originalConsoleWarn = console.warn;
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
    scheduledDelay = delay;
    scheduledCallback = typeof callback === 'function' ? callback : undefined;
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  console.warn = ((message?: unknown, payload?: unknown) => {
    loggedMessage = typeof message === 'string' ? message : String(message);
    loggedPayload = payload;
  }) as typeof console.warn;
  (service as { runOnce: () => Promise<null> }).runOnce = () =>
    Promise.reject(new Error('startup_failed'));

  try {
    service.start();
    assert.equal(scheduledDelay, 0);
    assert.ok(scheduledCallback);
    scheduledCallback();
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    console.warn = originalConsoleWarn;
  }

  assert.equal(loggedMessage, '[metadata_enrichment] startup_run_failed');
  assert.deepEqual(loggedPayload, { message: 'startup_failed' });
});

void test('metadata enrichment updates all platform rows for same game id', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '1520',
      platformIgdbId: 6,
      payload: { title: 'Mario' },
      isPeriodicRefresh: false,
    },
    {
      igdbGameId: '1520',
      platformIgdbId: 48,
      payload: { title: 'Mario' },
      isPeriodicRefresh: false,
    },
  ];
  const igdbClient = new IgdbClientMock(
    new Map([
      [
        '1520',
        {
          themes: ['Fantasy'],
          themeIds: [1],
          keywords: ['Plumber'],
          keywordIds: [100],
          screenshots: [],
          videos: [],
          websites: [
            {
              provider: 'steam',
              providerLabel: 'Steam',
              url: 'https://store.steampowered.com/app/12345',
              typeId: 13,
              typeName: 'steam',
              trusted: null,
            },
          ],
          steamAppId: 12345,
        },
      ],
    ])
  );

  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0,
    refreshMonths: 0,
    refreshDays: 0,
  });

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.updatedRows, 2);
  assert.equal(summary.uniqueGamesRequested, 1);
  assert.equal(repository.updates.length, 2);
  assert.deepEqual(repository.updates[0]?.payloadPatch['themes'], ['Fantasy']);
  assert.deepEqual(repository.updates[1]?.payloadPatch['keywords'], ['Plumber']);
  assert.equal(typeof repository.updates[0]?.payloadPatch['taxonomyEnrichedAt'], 'string');
  assert.equal(repository.updates[0]?.payloadPatch['taxonomyEnrichmentStatus'], 'success');
  assert.equal(typeof repository.updates[0]?.payloadPatch['mediaEnrichedAt'], 'string');
  assert.equal(repository.updates[0]?.payloadPatch['mediaEnrichmentStatus'], 'success');
  assert.equal(typeof repository.updates[0]?.payloadPatch['steamEnrichedAt'], 'string');
  assert.equal(repository.updates[0]?.payloadPatch['steamEnrichmentStatus'], 'success');
  assert.deepEqual(repository.updates[0]?.payloadPatch['websites'], [
    {
      provider: 'steam',
      providerLabel: 'Steam',
      url: 'https://store.steampowered.com/app/12345',
      typeId: 13,
      typeName: 'steam',
      trusted: null,
    },
  ]);
  assert.equal(repository.updates[0]?.payloadPatch['steamAppId'], 12345);
});

void test('metadata enrichment skips when advisory lock is not acquired', async () => {
  const repository = new RepositoryMock();
  repository.lockAcquired = false;
  const service = new MetadataEnrichmentService(
    repository as never,
    new IgdbClientMock(new Map()) as never,
    {
      enabled: true,
      batchSize: 200,
      maxGamesPerRun: 5000,
      startupDelayMs: 0,
      refreshMonths: 0,
      refreshDays: 0,
    }
  );

  const summary = await service.runOnce();
  assert.equal(summary, null);
  assert.equal(repository.updates.length, 0);
});

void test('metadata enrichment backfills storefront links for collection rows with prior timestamps', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '999',
      platformIgdbId: 6,
      payload: {
        title: 'Existing Collection Game',
        listType: 'collection',
        taxonomyEnrichedAt: '2026-03-01T00:00:00.000Z',
        mediaEnrichedAt: '2026-03-01T00:00:00.000Z',
        steamEnrichedAt: '2026-03-01T00:00:00.000Z',
        metadataSyncEnqueuedAt: '2026-03-01T00:00:00.000Z',
      },
      isPeriodicRefresh: false,
    },
  ];
  const igdbClient = new IgdbClientMock(
    new Map([
      [
        '999',
        {
          themes: [],
          themeIds: [],
          keywords: [],
          keywordIds: [],
          screenshots: [],
          videos: [],
          websites: [],
          steamAppId: null,
        },
      ],
    ])
  );

  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0,
    refreshMonths: 0,
    refreshDays: 0,
  });

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.updatedRows, 1);
  assert.deepEqual(repository.updates[0]?.payloadPatch['websites'], []);
  assert.equal(repository.updates[0]?.payloadPatch['steamAppId'], null);
});

void test('metadata enrichment tolerates failed batches and still updates successful batches', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    { igdbGameId: '1', platformIgdbId: 6, payload: { title: 'One' }, isPeriodicRefresh: false },
    { igdbGameId: '2', platformIgdbId: 6, payload: { title: 'Two' }, isPeriodicRefresh: false },
  ];
  const igdbClient = new IgdbClientMock(
    new Map([
      [
        '1',
        {
          themes: ['T1'],
          themeIds: [10],
          keywords: ['K1'],
          keywordIds: [11],
          screenshots: [],
          videos: [],
          websites: [],
          steamAppId: 101,
        },
      ],
      [
        '2',
        {
          themes: ['T2'],
          themeIds: [20],
          keywords: ['K2'],
          keywordIds: [22],
          screenshots: [],
          videos: [],
          websites: [],
          steamAppId: 202,
        },
      ],
    ])
  );
  igdbClient.failuresForBatchContaining.add('2');
  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 1,
    maxGamesPerRun: 5000,
    startupDelayMs: 0,
    refreshMonths: 0,
    refreshDays: 0,
  });

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.failedBatches, 1);
  assert.equal(summary.updatedRows, 1);
  assert.equal(summary.skippedRows, 1);

  const gameOne = repository.updates.find((entry) => entry.igdbGameId === '1');
  const gameTwo = repository.updates.find((entry) => entry.igdbGameId === '2');
  assert.ok(gameOne);
  assert.deepEqual(gameOne.payloadPatch['themes'], ['T1']);
  assert.equal(gameOne.payloadPatch['taxonomyEnrichmentStatus'], 'success');
  assert.equal(gameTwo, undefined);
});

void test('metadata enrichment is idempotent on rerun', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    { igdbGameId: '10', platformIgdbId: 6, payload: { title: 'Game' }, isPeriodicRefresh: false },
  ];
  const igdbClient = new IgdbClientMock(
    new Map([
      [
        '10',
        {
          themes: ['Arcade'],
          themeIds: [3],
          keywords: ['Retro'],
          keywordIds: [4],
          screenshots: [],
          videos: [],
          websites: [],
          steamAppId: 999,
        },
      ],
    ])
  );

  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0,
    refreshMonths: 0,
    refreshDays: 0,
  });

  const first = await service.runOnce();
  const second = await service.runOnce();

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.updatedRows, 1);
  assert.equal(second.updatedRows, 0);
});

void test('metadata enrichment marks no_data when IGDB returns no row for a fetched id', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '404',
      platformIgdbId: 6,
      payload: { title: 'Missing' },
      isPeriodicRefresh: false,
    },
  ];
  const igdbClient = new IgdbClientMock(new Map());

  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0,
    refreshMonths: 0,
    refreshDays: 0,
  });

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.updatedRows, 1);
  assert.equal(repository.updates.length, 1);
  assert.equal(repository.updates[0]?.payloadPatch['taxonomyEnrichmentStatus'], 'no_data');
  assert.equal(repository.updates[0]?.payloadPatch['mediaEnrichmentStatus'], 'no_data');
  assert.equal(repository.updates[0]?.payloadPatch['steamEnrichmentStatus'], 'no_data');
  assert.equal(typeof repository.updates[0]?.payloadPatch['taxonomyEnrichedAt'], 'string');
  assert.equal(typeof repository.updates[0]?.payloadPatch['mediaEnrichedAt'], 'string');
  assert.equal(typeof repository.updates[0]?.payloadPatch['steamEnrichedAt'], 'string');
});

void test('metadata enrichment backfills sync marker without IGDB fetch when metadata already exists', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '20',
      platformIgdbId: 6,
      payload: {
        title: 'Synced Later',
        taxonomyEnrichedAt: '2026-03-01T00:00:00.000Z',
        mediaEnrichedAt: '2026-03-01T00:00:00.000Z',
        steamEnrichedAt: '2026-03-01T00:00:00.000Z',
        themes: ['Action'],
        keywords: ['Shooter'],
        screenshots: [],
        videos: [],
        websites: [
          {
            provider: null,
            providerLabel: null,
            url: 'https://example.com/existing',
            typeId: 1,
            typeName: 'Official Website',
            trusted: true,
          },
        ],
        steamAppId: null,
      },
      isPeriodicRefresh: false,
    },
  ];
  const igdbClient = new IgdbClientMock(new Map());
  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0,
    refreshMonths: 0,
    refreshDays: 0,
  });

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.uniqueGamesRequested, 0);
  assert.equal(summary.updatedRows, 1);
  assert.equal(repository.updates.length, 1);
  const updated = repository.updates[0];
  assert.ok(updated);
  assert.equal(typeof updated.payloadPatch['metadataSyncEnqueuedAt'], 'string');
  assert.deepEqual(repository.rows[0]?.payload['themes'], ['Action']);
});

void test('metadata enrichment patch updates preserve manual override lock fields', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '40',
      platformIgdbId: 6,
      payload: {
        title: 'Locked Row',
        listType: 'wishlist',
        hltbMatchLocked: true,
        reviewMatchLocked: true,
        psPricesMatchLocked: true,
      },
      isPeriodicRefresh: false,
    },
  ];
  const igdbClient = new IgdbClientMock(
    new Map([
      [
        '40',
        {
          themes: ['Arcade'],
          themeIds: [7],
          keywords: ['Retro'],
          keywordIds: [8],
          screenshots: [],
          videos: [],
          websites: [],
          steamAppId: 4242,
        },
      ],
    ])
  );

  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0,
    refreshMonths: 0,
    refreshDays: 0,
  });

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.updatedRows, 1);
  assert.equal(repository.rows[0]?.payload['hltbMatchLocked'], true);
  assert.equal(repository.rows[0]?.payload['reviewMatchLocked'], true);
  assert.equal(repository.rows[0]?.payload['psPricesMatchLocked'], true);
});

void test('metadata enrichment skips row when enrichment and sync markers are already present', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '30',
      platformIgdbId: 6,
      payload: {
        title: 'Already Done',
        themes: ['Action'],
        keywords: ['Shooter'],
        screenshots: [],
        videos: [],
        taxonomyEnrichedAt: '2026-03-01T00:00:00.000Z',
        mediaEnrichedAt: '2026-03-01T00:00:00.000Z',
        steamEnrichedAt: '2026-03-01T00:00:00.000Z',
        metadataSyncEnqueuedAt: '2026-03-01T00:00:00.000Z',
        websites: [
          {
            provider: null,
            providerLabel: null,
            url: 'https://example.com/already-present',
            typeId: 1,
            typeName: 'Official Website',
            trusted: true,
          },
        ],
        steamAppId: null,
      },
      isPeriodicRefresh: false,
    },
  ];

  const service = new MetadataEnrichmentService(
    repository as never,
    new IgdbClientMock(new Map()) as never,
    {
      enabled: true,
      batchSize: 200,
      maxGamesPerRun: 5000,
      startupDelayMs: 0,
      refreshMonths: 0,
      refreshDays: 0,
    }
  );

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.uniqueGamesRequested, 0);
  assert.equal(summary.updatedRows, 0);
  assert.equal(summary.skippedRows, 1);
  assert.equal(repository.updates.length, 0);
});

void test('metadata enrichment refetches rows when websites are present but empty', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '347668',
      platformIgdbId: 6,
      payload: {
        title: 'Resident Evil Requiem',
        listType: 'wishlist',
        taxonomyEnrichedAt: '2026-03-01T00:00:00.000Z',
        mediaEnrichedAt: '2026-03-01T00:00:00.000Z',
        steamEnrichedAt: '2026-03-01T00:00:00.000Z',
        metadataSyncEnqueuedAt: '2026-03-01T00:00:00.000Z',
        screenshots: [],
        videos: [],
        websites: [],
        steamAppId: null,
      },
      isPeriodicRefresh: false,
    },
  ];
  const igdbClient = new IgdbClientMock(
    new Map([
      [
        '347668',
        {
          themes: [],
          themeIds: [],
          keywords: [],
          keywordIds: [],
          screenshots: [],
          videos: [],
          websites: [
            {
              provider: null,
              providerLabel: null,
              url: 'https://www.residentevil.com/requiem/en-us/',
              typeId: 1,
              typeName: 'Official Website',
              trusted: false,
            },
          ],
          steamAppId: null,
        },
      ],
    ])
  );

  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0,
    refreshMonths: 0,
    refreshDays: 0,
  });

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.uniqueGamesRequested, 1);
  assert.equal(summary.updatedRows, 1);
  assert.deepEqual(repository.updates[0]?.payloadPatch['websites'], [
    {
      provider: null,
      providerLabel: null,
      url: 'https://www.residentevil.com/requiem/en-us/',
      typeId: 1,
      typeName: 'Official Website',
      trusted: false,
    },
  ]);
});

void test('periodic refresh row is fetched and all enrichment timestamps are updated', async () => {
  const repository = new RepositoryMock();
  const oldTimestamp = '2025-12-01T00:00:00.000Z';
  repository.rows = [
    {
      igdbGameId: '5000',
      platformIgdbId: 6,
      payload: {
        title: 'Recently Released',
        listType: 'wishlist',
        releaseDate: '2026-02-01T00:00:00.000Z',
        taxonomyEnrichedAt: oldTimestamp,
        mediaEnrichedAt: oldTimestamp,
        steamEnrichedAt: oldTimestamp,
        websitesEnrichedAt: oldTimestamp,
        metadataSyncEnqueuedAt: oldTimestamp,
        themes: ['Action'],
        keywords: ['Old Keyword'],
        screenshots: [],
        videos: [],
        websites: [],
        steamAppId: null,
      },
      isPeriodicRefresh: true,
    },
  ];
  const igdbClient = new IgdbClientMock(
    new Map([
      [
        '5000',
        {
          themes: ['Action', 'Fantasy'],
          themeIds: [1, 2],
          keywords: ['Old Keyword', 'New Keyword'],
          keywordIds: [10, 11],
          screenshots: [
            {
              id: 1,
              imageId: 'img1',
              url: 'https://example.com/img1.jpg',
              width: 1920,
              height: 1080,
            },
          ],
          videos: [],
          websites: [],
          steamAppId: null,
        },
      ],
    ])
  );

  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0,
    refreshMonths: 6,
    refreshDays: 30,
  });

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.uniqueGamesRequested, 1);
  assert.equal(summary.updatedRows, 1);
  assert.equal(repository.updates.length, 1);

  const patch = repository.updates[0]?.payloadPatch;
  assert.ok(patch);
  assert.deepEqual(patch['themes'], ['Action', 'Fantasy']);
  assert.deepEqual(patch['keywords'], ['Old Keyword', 'New Keyword']);
  assert.equal(patch['taxonomyEnrichmentStatus'], 'success');
  assert.equal(patch['mediaEnrichmentStatus'], 'success');
  assert.equal(patch['steamEnrichmentStatus'], 'success');
  assert.equal(typeof patch['taxonomyEnrichedAt'], 'string');
  assert.notEqual(patch['taxonomyEnrichedAt'], oldTimestamp);
  assert.equal(typeof patch['metadataSyncEnqueuedAt'], 'string');
  assert.notEqual(patch['metadataSyncEnqueuedAt'], oldTimestamp);
});

void test('periodic refresh row with failed IGDB fetch is not written and not sync-backfilled', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '5001',
      platformIgdbId: 6,
      payload: {
        title: 'Failed Refresh',
        listType: 'wishlist',
        releaseDate: '2026-02-01T00:00:00.000Z',
        taxonomyEnrichedAt: '2025-12-01T00:00:00.000Z',
        mediaEnrichedAt: '2025-12-01T00:00:00.000Z',
        steamEnrichedAt: '2025-12-01T00:00:00.000Z',
        websitesEnrichedAt: '2025-12-01T00:00:00.000Z',
        metadataSyncEnqueuedAt: '2025-12-01T00:00:00.000Z',
        themes: ['Action'],
        keywords: [],
        screenshots: [],
        videos: [],
        websites: [],
        steamAppId: null,
      },
      isPeriodicRefresh: true,
    },
  ];
  const igdbClient = new IgdbClientMock(new Map());
  igdbClient.failuresForBatchContaining.add('5001');

  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0,
    refreshMonths: 6,
    refreshDays: 30,
  });

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.updatedRows, 0);
  assert.equal(summary.skippedRows, 1);
  assert.equal(repository.updates.length, 0);
});

void test('periodic refresh row is idempotent when IGDB returns identical data', async () => {
  const existingWebsite = {
    provider: null,
    providerLabel: null,
    url: 'https://example.com',
    typeId: 1,
    typeName: 'Official Website',
    trusted: true,
  };
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '5002',
      platformIgdbId: 6,
      payload: {
        title: 'Unchanged Game',
        listType: 'collection',
        releaseDate: '2026-03-01T00:00:00.000Z',
        taxonomyEnrichedAt: '2026-04-01T00:00:00.000Z',
        mediaEnrichedAt: '2026-04-01T00:00:00.000Z',
        steamEnrichedAt: '2026-04-01T00:00:00.000Z',
        websitesEnrichedAt: '2026-04-01T00:00:00.000Z',
        metadataSyncEnqueuedAt: '2026-04-01T00:00:00.000Z',
        themes: ['RPG'],
        themeIds: [5],
        keywords: ['Fantasy'],
        keywordIds: [50],
        screenshots: [],
        videos: [],
        websites: [existingWebsite],
        steamAppId: null,
      },
      isPeriodicRefresh: true,
    },
  ];
  const igdbClient = new IgdbClientMock(
    new Map([
      [
        '5002',
        {
          themes: ['RPG'],
          themeIds: [5],
          keywords: ['Fantasy'],
          keywordIds: [50],
          screenshots: [],
          videos: [],
          websites: [existingWebsite],
          steamAppId: null,
        },
      ],
    ])
  );

  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0,
    refreshMonths: 6,
    refreshDays: 30,
  });

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.updatedRows, 1);
  assert.equal(summary.skippedRows, 0);
  assert.equal(repository.updates.length, 1);
  // Enrichment timestamps, statuses, and sync marker are set even when data is unchanged.
  const patch = repository.updates[0]?.payloadPatch;
  assert.ok(patch);
  assert.equal(typeof patch['taxonomyEnrichedAt'], 'string');
  assert.equal(typeof patch['mediaEnrichedAt'], 'string');
  assert.equal(typeof patch['steamEnrichedAt'], 'string');
  assert.equal(typeof patch['websitesEnrichedAt'], 'string');
  assert.equal(typeof patch['metadataSyncEnqueuedAt'], 'string');
  assert.equal(patch['taxonomyEnrichmentStatus'], 'success');
  assert.equal(patch['mediaEnrichmentStatus'], 'success');
  assert.equal(patch['steamEnrichmentStatus'], 'success');
  assert.equal(patch['themes'], undefined);
  assert.equal(patch['keywords'], undefined);
});

void test('periodic refresh and initial enrichment rows in same run deduplicate IGDB requests', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '6000',
      platformIgdbId: 6,
      payload: { title: 'Needs Initial Enrichment' },
      isPeriodicRefresh: false,
    },
    {
      igdbGameId: '6000',
      platformIgdbId: 48,
      payload: {
        title: 'Needs Periodic Refresh',
        taxonomyEnrichedAt: '2025-12-01T00:00:00.000Z',
        mediaEnrichedAt: '2025-12-01T00:00:00.000Z',
        steamEnrichedAt: '2025-12-01T00:00:00.000Z',
        websitesEnrichedAt: '2025-12-01T00:00:00.000Z',
        metadataSyncEnqueuedAt: '2025-12-01T00:00:00.000Z',
        themes: [],
        keywords: [],
        screenshots: [],
        videos: [],
        websites: [],
        steamAppId: null,
      },
      isPeriodicRefresh: true,
    },
  ];

  let fetchCallCount = 0;
  const igdbClient = new IgdbClientMock(
    new Map([
      [
        '6000',
        {
          themes: ['Strategy'],
          themeIds: [9],
          keywords: ['Turn-based'],
          keywordIds: [99],
          screenshots: [],
          videos: [],
          websites: [],
          steamAppId: null,
        },
      ],
    ])
  );
  const originalFetch = igdbClient.fetchGameMetadataByIds.bind(igdbClient);
  igdbClient.fetchGameMetadataByIds = (ids: string[]) => {
    fetchCallCount += 1;
    return originalFetch(ids);
  };

  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0,
    refreshMonths: 6,
    refreshDays: 30,
  });

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.uniqueGamesRequested, 1);
  assert.equal(fetchCallCount, 1);
  assert.equal(summary.updatedRows, 2);
  assert.deepEqual(repository.updates[0]?.payloadPatch['themes'], ['Strategy']);
  assert.deepEqual(repository.updates[1]?.payloadPatch['themes'], ['Strategy']);
});

void test('periodic refresh row with no IGDB record bumps timestamps and records no_data status', async () => {
  const oldTimestamp = '2025-12-01T00:00:00.000Z';
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '5003',
      platformIgdbId: 6,
      payload: {
        title: 'Removed Game',
        listType: 'collection',
        releaseDate: '2026-02-01T00:00:00.000Z',
        taxonomyEnrichedAt: oldTimestamp,
        mediaEnrichedAt: oldTimestamp,
        steamEnrichedAt: oldTimestamp,
        websitesEnrichedAt: oldTimestamp,
        metadataSyncEnqueuedAt: oldTimestamp,
        themes: ['Action'],
        keywords: [],
        screenshots: [],
        videos: [],
        websites: [],
        steamAppId: null,
      },
      isPeriodicRefresh: true,
    },
  ];
  // IGDB fetch succeeds but returns no record for this game ID.
  const igdbClient = new IgdbClientMock(new Map());

  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0,
    refreshMonths: 6,
    refreshDays: 30,
  });

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.updatedRows, 1);
  assert.equal(summary.skippedRows, 0);
  assert.equal(repository.updates.length, 1);

  const patch = repository.updates[0]?.payloadPatch;
  assert.ok(patch);
  assert.equal(patch['taxonomyEnrichmentStatus'], 'no_data');
  assert.equal(patch['mediaEnrichmentStatus'], 'no_data');
  assert.equal(patch['steamEnrichmentStatus'], 'no_data');
  assert.equal(typeof patch['taxonomyEnrichedAt'], 'string');
  assert.notEqual(patch['taxonomyEnrichedAt'], oldTimestamp);
  assert.equal(typeof patch['metadataSyncEnqueuedAt'], 'string');
  assert.notEqual(patch['metadataSyncEnqueuedAt'], oldTimestamp);
});
