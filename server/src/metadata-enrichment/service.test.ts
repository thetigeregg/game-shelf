import assert from 'node:assert/strict';
import test from 'node:test';
import { MetadataEnrichmentService } from './service.js';
import { IgdbMetadataRecord, MetadataEnrichmentGameRow } from './types.js';

class RepositoryMock {
  public rows: MetadataEnrichmentGameRow[] = [];
  public updates: Array<{
    igdbGameId: string;
    platformIgdbId: number;
    payload: Record<string, unknown>;
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
    payload: Record<string, unknown>;
  }): Promise<void> {
    this.updates.push(params);
    const row = this.rows.find(
      (entry) =>
        entry.igdbGameId === params.igdbGameId && entry.platformIgdbId === params.platformIgdbId
    );
    if (row) {
      row.payload = params.payload;
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
    { igdbGameId: '1520', platformIgdbId: 48, payload: { title: 'Mario' } }
  ];
  const igdbClient = new IgdbClientMock(
    new Map([
      [
        '1520',
        {
          themes: ['Fantasy'],
          themeIds: [1],
          keywords: ['Plumber'],
          keywordIds: [100]
        }
      ]
    ])
  );

  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0
  });

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.updatedRows, 2);
  assert.equal(summary.uniqueGamesRequested, 1);
  assert.equal(repository.updates.length, 2);
  assert.deepEqual(repository.updates[0]?.payload['themes'], ['Fantasy']);
  assert.deepEqual(repository.updates[1]?.payload['keywords'], ['Plumber']);
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
      startupDelayMs: 0
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
    { igdbGameId: '2', platformIgdbId: 6, payload: { title: 'Two' } }
  ];
  const igdbClient = new IgdbClientMock(
    new Map([
      ['1', { themes: ['T1'], themeIds: [10], keywords: ['K1'], keywordIds: [11] }],
      ['2', { themes: ['T2'], themeIds: [20], keywords: ['K2'], keywordIds: [22] }]
    ])
  );
  igdbClient.failuresForBatchContaining.add('2');
  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 1,
    maxGamesPerRun: 5000,
    startupDelayMs: 0
  });

  const summary = await service.runOnce();
  assert.ok(summary);
  assert.equal(summary.failedBatches, 1);
  assert.equal(summary.updatedRows, 1);
  assert.equal(summary.skippedRows, 1);

  const gameOne = repository.updates.find((entry) => entry.igdbGameId === '1');
  const gameTwo = repository.updates.find((entry) => entry.igdbGameId === '2');
  assert.deepEqual(gameOne?.payload['themes'], ['T1']);
  assert.equal(gameTwo, undefined);
});

void test('metadata enrichment is idempotent on rerun', async () => {
  const repository = new RepositoryMock();
  repository.rows = [{ igdbGameId: '10', platformIgdbId: 6, payload: { title: 'Game' } }];
  const igdbClient = new IgdbClientMock(
    new Map([['10', { themes: ['Arcade'], themeIds: [3], keywords: ['Retro'], keywordIds: [4] }]])
  );

  const service = new MetadataEnrichmentService(repository as never, igdbClient as never, {
    enabled: true,
    batchSize: 200,
    maxGamesPerRun: 5000,
    startupDelayMs: 0
  });

  const first = await service.runOnce();
  const second = await service.runOnce();

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.updatedRows, 1);
  assert.equal(second.updatedRows, 0);
});
