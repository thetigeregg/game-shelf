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

  listRowsMissingMetadata(limit: number): Promise<MetadataEnrichmentGameRow[]> {
    return Promise.resolve(this.rows.slice(0, limit));
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

void test('metadata enrichment updates all platform rows for same game id', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    { igdbGameId: '1520', platformIgdbId: 6, payload: { title: 'Mario' } },
    { igdbGameId: '1520', platformIgdbId: 48, payload: { title: 'Mario' } },
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
    }
  );

  const summary = await service.runOnce();
  assert.equal(summary, null);
  assert.equal(repository.updates.length, 0);
});

void test('metadata enrichment tolerates failed batches and still updates successful batches', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    { igdbGameId: '1', platformIgdbId: 6, payload: { title: 'One' } },
    { igdbGameId: '2', platformIgdbId: 6, payload: { title: 'Two' } },
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
  repository.rows = [{ igdbGameId: '10', platformIgdbId: 6, payload: { title: 'Game' } }];
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
  repository.rows = [{ igdbGameId: '404', platformIgdbId: 6, payload: { title: 'Missing' } }];
  const igdbClient = new IgdbClientMock(new Map());

  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0,
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
      },
    },
  ];
  const igdbClient = new IgdbClientMock(new Map());
  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0,
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
      },
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
    }
  );

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.uniqueGamesRequested, 0);
  assert.equal(summary.updatedRows, 0);
  assert.equal(summary.skippedRows, 1);
  assert.equal(repository.updates.length, 0);
});
