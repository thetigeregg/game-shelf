import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResult, QueryResultRow } from 'pg';
import {
  DiscoveryEnrichmentService,
  DiscoveryEnrichmentSummary
} from './discovery-enrichment-service.js';

interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    _text: string,
    _values?: unknown[]
  ): Promise<QueryResult<T>>;
}

class RepositoryMock {
  public lockAcquired = true;
  public rows: Array<{
    igdbGameId: string;
    platformIgdbId: number;
    payload: Record<string, unknown>;
  }> = [];
  public updates: Array<{
    igdbGameId: string;
    platformIgdbId: number;
    payload: Record<string, unknown>;
  }> = [];

  async withAdvisoryLock<T>(params: {
    namespace: number;
    key: number;
    callback: (client: Queryable) => Promise<T>;
  }): Promise<{ acquired: true; value: T } | { acquired: false }> {
    if (!this.lockAcquired) {
      return { acquired: false };
    }

    const value = await params.callback({
      query: () => Promise.resolve({ rows: [], rowCount: 0 } as QueryResult)
    });
    return { acquired: true, value };
  }

  listDiscoveryRowsMissingEnrichment(limit: number): Promise<
    Array<{
      igdbGameId: string;
      platformIgdbId: number;
      payload: Record<string, unknown>;
    }>
  > {
    return Promise.resolve(this.rows.slice(0, limit));
  }

  updateGamePayload(params: {
    igdbGameId: string;
    platformIgdbId: number;
    payload: Record<string, unknown>;
  }): Promise<void> {
    this.updates.push(params);
    return Promise.resolve();
  }
}

void test('discovery enrichment updates hltb and critic fields', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '1520',
      platformIgdbId: 6,
      payload: {
        title: 'Super Mario Bros.',
        releaseYear: 1985,
        platform: 'NES',
        listType: 'discovery'
      }
    }
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: URL | RequestInfo): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/v1/hltb/search')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            item: { hltbMainHours: 8.4, hltbMainExtraHours: 11.2, hltbCompletionistHours: 13.8 }
          }),
          { status: 200 }
        )
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          item: { metacriticScore: 88, metacriticUrl: 'https://www.metacritic.com/game/example' }
        }),
        { status: 200 }
      )
    );
  };

  try {
    const service = new DiscoveryEnrichmentService(repository as never, {
      enabled: true,
      startupDelayMs: 0,
      intervalMinutes: 30,
      maxGamesPerRun: 50,
      requestTimeoutMs: 1000,
      apiBaseUrl: 'http://127.0.0.1:3000'
    });
    const result = await service.enrichNow({ limit: 10 });

    assert.deepEqual(result, {
      scanned: 1,
      updated: 1,
      skipped: 0
    } satisfies DiscoveryEnrichmentSummary);
    assert.equal(repository.updates.length, 1);
    assert.equal(repository.updates[0]?.payload.hltbMainHours, 8.4);
    assert.equal(repository.updates[0]?.payload.metacriticScore, 88);
    assert.equal(repository.updates[0]?.payload.reviewSource, 'metacritic');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('discovery enrichment runOnce returns null when lock is unavailable', async () => {
  const repository = new RepositoryMock();
  repository.lockAcquired = false;

  const service = new DiscoveryEnrichmentService(repository as never, {
    enabled: true,
    startupDelayMs: 0,
    intervalMinutes: 30,
    maxGamesPerRun: 50,
    requestTimeoutMs: 1000,
    apiBaseUrl: 'http://127.0.0.1:3000'
  });

  const result = await service.runOnce();
  assert.equal(result, null);
});
