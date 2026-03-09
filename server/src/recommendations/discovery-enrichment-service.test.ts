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
      apiBaseUrl: 'http://127.0.0.1:3000',
      maxAttempts: 6,
      backoffBaseMinutes: 60,
      backoffMaxHours: 168
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

void test('discovery enrichment ignores non-provider reviewScore when deciding metacritic fetch', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '1521',
      platformIgdbId: 6,
      payload: {
        title: 'Legacy Review Game',
        releaseYear: 2020,
        platform: 'PC',
        listType: 'discovery',
        reviewScore: 91.2,
        reviewSource: null
      }
    }
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: URL | RequestInfo): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('/v1/hltb/search')) {
      return Promise.resolve(new Response(JSON.stringify({ item: null }), { status: 200 }));
    }

    if (url.includes('/v1/metacritic/search')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            item: { metacriticScore: 86, metacriticUrl: 'https://www.metacritic.com/game/example' }
          }),
          { status: 200 }
        )
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  try {
    const service = new DiscoveryEnrichmentService(repository as never, {
      enabled: true,
      startupDelayMs: 0,
      intervalMinutes: 30,
      maxGamesPerRun: 50,
      requestTimeoutMs: 1000,
      apiBaseUrl: 'http://127.0.0.1:3000',
      maxAttempts: 6,
      backoffBaseMinutes: 60,
      backoffMaxHours: 168
    });
    const result = await service.enrichNow({ limit: 10 });

    assert.deepEqual(result, {
      scanned: 1,
      updated: 1,
      skipped: 0
    } satisfies DiscoveryEnrichmentSummary);
    assert.equal(repository.updates.length, 1);
    assert.equal(repository.updates[0]?.payload.metacriticScore, 86);
    assert.equal(repository.updates[0]?.payload.reviewScore, 86);
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
    apiBaseUrl: 'http://127.0.0.1:3000',
    maxAttempts: 6,
    backoffBaseMinutes: 60,
    backoffMaxHours: 168
  });

  const result = await service.runOnce();
  assert.equal(result, null);
});

void test('discovery enrichment handles disabled mode and short-title rows', async () => {
  const disabledRepository = new RepositoryMock();
  const disabledService = new DiscoveryEnrichmentService(disabledRepository as never, {
    enabled: false,
    startupDelayMs: 0,
    intervalMinutes: 30,
    maxGamesPerRun: 50,
    requestTimeoutMs: 1000,
    apiBaseUrl: 'http://127.0.0.1:3000',
    maxAttempts: 6,
    backoffBaseMinutes: 60,
    backoffMaxHours: 168
  });

  assert.equal(await disabledService.runOnce(), null);
  assert.deepEqual(await disabledService.enrichNow({ limit: 5 }), {
    scanned: 0,
    updated: 0,
    skipped: 0
  });

  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '1',
      platformIgdbId: 6,
      payload: { title: 'x', listType: 'discovery' }
    }
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 500 }))) as typeof fetch;
  try {
    const service = new DiscoveryEnrichmentService(repository as never, {
      enabled: true,
      startupDelayMs: 0,
      intervalMinutes: 30,
      maxGamesPerRun: 50,
      requestTimeoutMs: 1000,
      apiBaseUrl: 'http://127.0.0.1:3000',
      maxAttempts: 6,
      backoffBaseMinutes: 60,
      backoffMaxHours: 168
    });
    const result = await service.enrichNow({ limit: 10 });
    assert.deepEqual(result, {
      scanned: 1,
      updated: 0,
      skipped: 1
    });
    assert.equal(repository.updates.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('discovery enrichment start/stop guards interval lifecycle', () => {
  const repository = new RepositoryMock();
  const service = new DiscoveryEnrichmentService(repository as never, {
    enabled: true,
    startupDelayMs: 10,
    intervalMinutes: 0,
    maxGamesPerRun: 50,
    requestTimeoutMs: 1000,
    apiBaseUrl: 'http://127.0.0.1:3000',
    maxAttempts: 6,
    backoffBaseMinutes: 60,
    backoffMaxHours: 168
  });

  const originalSetTimeout = globalThis.setTimeout;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const timeoutCalls: number[] = [];
  let intervalCalls = 0;
  let clearCalls = 0;

  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number) => {
    timeoutCalls.push(timeout ?? 0);
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.setInterval = ((handler: TimerHandler, timeout?: number) => {
    intervalCalls += 1;
    timeoutCalls.push(timeout ?? 0);
    return 2 as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
    void id;
    clearCalls += 1;
  }) as typeof clearInterval;

  try {
    service.start();
    service.start();
    service.stop();
    service.stop();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }

  assert.equal(intervalCalls, 1);
  assert.equal(clearCalls, 1);
  assert.ok(timeoutCalls.some((value) => value === 10));
  assert.ok(timeoutCalls.some((value) => value === 60_000));
});

void test('discovery enrichment applies cooldown after failed attempt', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '1',
      platformIgdbId: 6,
      payload: {
        title: 'Never Match Game',
        releaseYear: 2001,
        platform: 'PC',
        listType: 'discovery'
      }
    }
  ];

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(JSON.stringify({ item: null }), { status: 200 }));
  }) as typeof fetch;

  try {
    const baseNow = Date.parse('2026-01-01T00:00:00.000Z');
    let nowMs = baseNow;
    const service = new DiscoveryEnrichmentService(
      repository as never,
      {
        enabled: true,
        startupDelayMs: 0,
        intervalMinutes: 30,
        maxGamesPerRun: 50,
        requestTimeoutMs: 1000,
        apiBaseUrl: 'http://127.0.0.1:3000',
        maxAttempts: 6,
        backoffBaseMinutes: 60,
        backoffMaxHours: 168
      },
      () => nowMs
    );

    const first = await service.enrichNow({ limit: 10 });
    assert.deepEqual(first, { scanned: 1, updated: 1, skipped: 0 });
    assert.equal(fetchCalls, 2);
    assert.equal(repository.updates.length, 1);
    const firstPayload = repository.updates[0].payload;
    assert.equal(typeof firstPayload.enrichmentRetry, 'object');

    repository.rows = [
      {
        igdbGameId: '1',
        platformIgdbId: 6,
        payload: firstPayload
      }
    ];
    nowMs = baseNow + 30 * 60 * 1000;

    const second = await service.enrichNow({ limit: 10 });
    assert.deepEqual(second, { scanned: 1, updated: 0, skipped: 1 });
    assert.equal(fetchCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('discovery enrichment marks permanent miss at max attempts and stops retrying', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '2',
      platformIgdbId: 6,
      payload: {
        title: 'No Match Forever',
        releaseYear: 2002,
        platform: 'PC',
        listType: 'discovery'
      }
    }
  ];

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(JSON.stringify({ item: null }), { status: 200 }));
  }) as typeof fetch;

  try {
    const baseNow = Date.parse('2026-01-01T00:00:00.000Z');
    let nowMs = baseNow;
    const service = new DiscoveryEnrichmentService(
      repository as never,
      {
        enabled: true,
        startupDelayMs: 0,
        intervalMinutes: 30,
        maxGamesPerRun: 50,
        requestTimeoutMs: 1000,
        apiBaseUrl: 'http://127.0.0.1:3000',
        maxAttempts: 2,
        backoffBaseMinutes: 60,
        backoffMaxHours: 168
      },
      () => nowMs
    );

    const first = await service.enrichNow({ limit: 10 });
    assert.deepEqual(first, { scanned: 1, updated: 1, skipped: 0 });
    assert.equal(fetchCalls, 2);
    const firstPayload = repository.updates[0].payload;
    assert.equal(
      typeof (firstPayload.enrichmentRetry as Record<string, unknown>)['hltb'],
      'object'
    );

    repository.rows = [
      {
        igdbGameId: '2',
        platformIgdbId: 6,
        payload: firstPayload
      }
    ];
    nowMs = baseNow + 2 * 60 * 60 * 1000;

    const second = await service.enrichNow({ limit: 10 });
    assert.deepEqual(second, { scanned: 1, updated: 1, skipped: 0 });
    assert.equal(fetchCalls, 4);
    const secondPayload = repository.updates[1].payload;
    const retry = secondPayload.enrichmentRetry as {
      hltb: { attempts: number; permanentMiss: boolean };
      metacritic: { attempts: number; permanentMiss: boolean };
    };
    assert.equal(retry.hltb.attempts, 2);
    assert.equal(retry.hltb.permanentMiss, true);
    assert.equal(retry.metacritic.attempts, 2);
    assert.equal(retry.metacritic.permanentMiss, true);

    repository.rows = [
      {
        igdbGameId: '2',
        platformIgdbId: 6,
        payload: secondPayload
      }
    ];
    nowMs = baseNow + 24 * 60 * 60 * 1000;

    const third = await service.enrichNow({ limit: 10 });
    assert.deepEqual(third, { scanned: 1, updated: 0, skipped: 1 });
    assert.equal(fetchCalls, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('discovery enrichment does not increment retry state on transient provider failures', async () => {
  const repository = new RepositoryMock();
  const initialPayload = {
    title: 'Provider Outage Game',
    releaseYear: 2004,
    platform: 'PC',
    listType: 'discovery',
    enrichmentRetry: {
      hltb: {
        attempts: 1,
        lastTriedAt: '2026-01-01T00:00:00.000Z',
        nextTryAt: null,
        permanentMiss: false
      },
      metacritic: {
        attempts: 1,
        lastTriedAt: '2026-01-01T00:00:00.000Z',
        nextTryAt: null,
        permanentMiss: false
      }
    }
  };
  repository.rows = [
    {
      igdbGameId: '4',
      platformIgdbId: 6,
      payload: initialPayload
    }
  ];

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ error: 'upstream_down' }), { status: 500 })
    );
  }) as typeof fetch;

  try {
    const service = new DiscoveryEnrichmentService(
      repository as never,
      {
        enabled: true,
        startupDelayMs: 0,
        intervalMinutes: 30,
        maxGamesPerRun: 50,
        requestTimeoutMs: 1000,
        apiBaseUrl: 'http://127.0.0.1:3000',
        maxAttempts: 2,
        backoffBaseMinutes: 60,
        backoffMaxHours: 168
      },
      () => Date.parse('2026-01-01T02:00:00.000Z')
    );

    const first = await service.enrichNow({ limit: 10 });
    assert.deepEqual(first, { scanned: 1, updated: 0, skipped: 1 });
    assert.equal(repository.updates.length, 0);
    assert.equal(fetchCalls, 2);

    repository.rows = [
      {
        igdbGameId: '4',
        platformIgdbId: 6,
        payload: initialPayload
      }
    ];

    const second = await service.enrichNow({ limit: 10 });
    assert.deepEqual(second, { scanned: 1, updated: 0, skipped: 1 });
    assert.equal(repository.updates.length, 0);
    assert.equal(fetchCalls, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('discovery enrichment increments retry state on 204 no-content responses', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '5',
      platformIgdbId: 6,
      payload: {
        title: 'No Content Game',
        releaseYear: 2005,
        platform: 'PC',
        listType: 'discovery'
      }
    }
  ];

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;

  try {
    const service = new DiscoveryEnrichmentService(
      repository as never,
      {
        enabled: true,
        startupDelayMs: 0,
        intervalMinutes: 30,
        maxGamesPerRun: 50,
        requestTimeoutMs: 1000,
        apiBaseUrl: 'http://127.0.0.1:3000',
        maxAttempts: 6,
        backoffBaseMinutes: 60,
        backoffMaxHours: 168
      },
      () => Date.parse('2026-01-01T02:00:00.000Z')
    );

    const result = await service.enrichNow({ limit: 10 });
    assert.deepEqual(result, { scanned: 1, updated: 1, skipped: 0 });
    assert.equal(repository.updates.length, 1);
    assert.equal(fetchCalls, 2);

    const retry = repository.updates[0].payload.enrichmentRetry as {
      hltb?: { attempts: number };
      metacritic?: { attempts: number };
    };
    assert.equal(retry.hltb?.attempts, 1);
    assert.equal(retry.metacritic?.attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('discovery enrichment clears retry state after successful retry', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '3',
      platformIgdbId: 6,
      payload: {
        title: 'Eventually Match',
        releaseYear: 2003,
        platform: 'PC',
        listType: 'discovery',
        enrichmentRetry: {
          hltb: {
            attempts: 2,
            lastTriedAt: '2026-01-01T00:00:00.000Z',
            nextTryAt: '2026-01-01T01:00:00.000Z',
            permanentMiss: false
          },
          metacritic: {
            attempts: 2,
            lastTriedAt: '2026-01-01T00:00:00.000Z',
            nextTryAt: '2026-01-01T01:00:00.000Z',
            permanentMiss: false
          }
        }
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
            item: { hltbMainHours: 10.5 }
          }),
          { status: 200 }
        )
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          item: { metacriticScore: 79, metacriticUrl: 'https://www.metacritic.com/game/example' }
        }),
        { status: 200 }
      )
    );
  };

  try {
    const service = new DiscoveryEnrichmentService(
      repository as never,
      {
        enabled: true,
        startupDelayMs: 0,
        intervalMinutes: 30,
        maxGamesPerRun: 50,
        requestTimeoutMs: 1000,
        apiBaseUrl: 'http://127.0.0.1:3000',
        maxAttempts: 6,
        backoffBaseMinutes: 60,
        backoffMaxHours: 168
      },
      () => Date.parse('2026-01-01T02:00:00.000Z')
    );

    const result = await service.enrichNow({ limit: 10 });
    assert.deepEqual(result, { scanned: 1, updated: 1, skipped: 0 });
    assert.equal(repository.updates.length, 1);
    const updatedPayload = repository.updates[0].payload;
    assert.equal(updatedPayload.hltbMainHours, 10.5);
    assert.equal(updatedPayload.metacriticScore, 79);
    assert.equal('enrichmentRetry' in updatedPayload, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('discovery enrichment rearms capped retry state for recent releases after cooldown days', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '4',
      platformIgdbId: 6,
      payload: {
        title: 'Recent Rearm Game',
        releaseYear: 2026,
        platform: 'PC',
        listType: 'discovery',
        enrichmentRetry: {
          hltb: {
            attempts: 6,
            lastTriedAt: '2026-01-01T00:00:00.000Z',
            nextTryAt: null,
            permanentMiss: true
          },
          metacritic: {
            attempts: 6,
            lastTriedAt: '2026-01-01T00:00:00.000Z',
            nextTryAt: null,
            permanentMiss: true
          }
        }
      }
    }
  ];

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(JSON.stringify({ item: null }), { status: 200 }));
  }) as typeof fetch;

  try {
    const service = new DiscoveryEnrichmentService(
      repository as never,
      {
        enabled: true,
        startupDelayMs: 0,
        intervalMinutes: 30,
        maxGamesPerRun: 50,
        requestTimeoutMs: 1000,
        apiBaseUrl: 'http://127.0.0.1:3000',
        maxAttempts: 6,
        backoffBaseMinutes: 60,
        backoffMaxHours: 168,
        rearmAfterDays: 30,
        rearmRecentReleaseYears: 1
      },
      () => Date.parse('2026-03-10T00:00:00.000Z')
    );

    const result = await service.enrichNow({ limit: 10 });
    assert.deepEqual(result, { scanned: 1, updated: 1, skipped: 0 });
    assert.equal(fetchCalls, 2);

    const retry = repository.updates[0].payload.enrichmentRetry as {
      hltb: { attempts: number; permanentMiss: boolean };
      metacritic: { attempts: number; permanentMiss: boolean };
    };
    assert.equal(retry.hltb.attempts, 1);
    assert.equal(retry.hltb.permanentMiss, false);
    assert.equal(retry.metacritic.attempts, 1);
    assert.equal(retry.metacritic.permanentMiss, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('discovery enrichment rearms capped retry state when release year is missing', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '5',
      platformIgdbId: 6,
      payload: {
        title: 'Unknown Release Rearm',
        platform: 'PC',
        listType: 'discovery',
        enrichmentRetry: {
          hltb: {
            attempts: 6,
            lastTriedAt: '2026-01-01T00:00:00.000Z',
            nextTryAt: null,
            permanentMiss: true
          },
          metacritic: {
            attempts: 6,
            lastTriedAt: '2026-01-01T00:00:00.000Z',
            nextTryAt: null,
            permanentMiss: true
          }
        }
      }
    }
  ];

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(JSON.stringify({ item: null }), { status: 200 }));
  }) as typeof fetch;

  try {
    const service = new DiscoveryEnrichmentService(
      repository as never,
      {
        enabled: true,
        startupDelayMs: 0,
        intervalMinutes: 30,
        maxGamesPerRun: 50,
        requestTimeoutMs: 1000,
        apiBaseUrl: 'http://127.0.0.1:3000',
        maxAttempts: 6,
        backoffBaseMinutes: 60,
        backoffMaxHours: 168,
        rearmAfterDays: 30,
        rearmRecentReleaseYears: 1
      },
      () => Date.parse('2026-03-10T00:00:00.000Z')
    );

    const result = await service.enrichNow({ limit: 10 });
    assert.deepEqual(result, { scanned: 1, updated: 1, skipped: 0 });
    assert.equal(fetchCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('discovery enrichment keeps permanent miss for older releases outside rearm window', async () => {
  const repository = new RepositoryMock();
  const oldPayload = {
    title: 'Old Permanent Miss',
    releaseYear: 2020,
    platform: 'PC',
    listType: 'discovery',
    enrichmentRetry: {
      hltb: {
        attempts: 6,
        lastTriedAt: '2026-01-01T00:00:00.000Z',
        nextTryAt: null,
        permanentMiss: true
      },
      metacritic: {
        attempts: 6,
        lastTriedAt: '2026-01-01T00:00:00.000Z',
        nextTryAt: null,
        permanentMiss: true
      }
    }
  };
  repository.rows = [
    {
      igdbGameId: '6',
      platformIgdbId: 6,
      payload: oldPayload
    }
  ];

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(JSON.stringify({ item: null }), { status: 200 }));
  }) as typeof fetch;

  try {
    const service = new DiscoveryEnrichmentService(
      repository as never,
      {
        enabled: true,
        startupDelayMs: 0,
        intervalMinutes: 30,
        maxGamesPerRun: 50,
        requestTimeoutMs: 1000,
        apiBaseUrl: 'http://127.0.0.1:3000',
        maxAttempts: 6,
        backoffBaseMinutes: 60,
        backoffMaxHours: 168,
        rearmAfterDays: 30,
        rearmRecentReleaseYears: 1
      },
      () => Date.parse('2026-03-10T00:00:00.000Z')
    );

    const result = await service.enrichNow({ limit: 10 });
    assert.deepEqual(result, { scanned: 1, updated: 0, skipped: 1 });
    assert.equal(fetchCalls, 0);
    assert.equal(repository.updates.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('discovery enrichment does not rearm before cooldown days elapse', async () => {
  const repository = new RepositoryMock();
  repository.rows = [
    {
      igdbGameId: '7',
      platformIgdbId: 6,
      payload: {
        title: 'Cooldown Not Elapsed',
        releaseYear: 2026,
        platform: 'PC',
        listType: 'discovery',
        enrichmentRetry: {
          hltb: {
            attempts: 6,
            lastTriedAt: '2026-03-05T00:00:00.000Z',
            nextTryAt: null,
            permanentMiss: true
          },
          metacritic: {
            attempts: 6,
            lastTriedAt: '2026-03-05T00:00:00.000Z',
            nextTryAt: null,
            permanentMiss: true
          }
        }
      }
    }
  ];

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(JSON.stringify({ item: null }), { status: 200 }));
  }) as typeof fetch;

  try {
    const service = new DiscoveryEnrichmentService(
      repository as never,
      {
        enabled: true,
        startupDelayMs: 0,
        intervalMinutes: 30,
        maxGamesPerRun: 50,
        requestTimeoutMs: 1000,
        apiBaseUrl: 'http://127.0.0.1:3000',
        maxAttempts: 6,
        backoffBaseMinutes: 60,
        backoffMaxHours: 168,
        rearmAfterDays: 30,
        rearmRecentReleaseYears: 1
      },
      () => Date.parse('2026-03-10T00:00:00.000Z')
    );

    const result = await service.enrichNow({ limit: 10 });
    assert.deepEqual(result, { scanned: 1, updated: 0, skipped: 1 });
    assert.equal(fetchCalls, 0);
    assert.equal(repository.updates.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
