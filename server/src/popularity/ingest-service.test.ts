import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { PopularityIngestService, type PopularityIngestServiceOptions } from './ingest-service.js';

type QueryHandler = (sql: string, params: unknown[] | undefined) => QueryResult<QueryResultRow>;

interface RecordedQuery {
  sql: string;
  params: unknown[] | undefined;
}

function toRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function queryResult<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount,
    oid: 0,
    fields: [],
    rows
  } as QueryResult<T>;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

class PoolClientMock {
  public readonly queries: RecordedQuery[] = [];

  constructor(private readonly handler: QueryHandler) {}

  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    this.queries.push({ sql, params });
    return Promise.resolve(this.handler(sql, params) as QueryResult<T>);
  }

  release(): void {}
}

class PoolMock {
  private readonly client: PoolClientMock;

  constructor(handler: QueryHandler) {
    this.client = new PoolClientMock(handler);
  }

  connect(): Promise<PoolClient> {
    return Promise.resolve(this.client as unknown as PoolClient);
  }

  getQueries(): RecordedQuery[] {
    return this.client.queries;
  }
}

function baseOptions(
  overrides: Partial<PopularityIngestServiceOptions> = {}
): PopularityIngestServiceOptions {
  return {
    enabled: true,
    signalLimit: 100,
    twitchClientId: 'client-id',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    maxRequestsPerSecond: 10_000,
    ...overrides
  };
}

void test('runOnce returns disabled summary when ingest is disabled', async () => {
  let connectCalled = false;
  const pool = {
    connect: () => {
      connectCalled = true;
      return Promise.reject(new Error('connect should not be called when ingest is disabled'));
    }
  } as unknown as Pool;

  let fetchCalls = 0;
  const fetchMock: typeof fetch = () => {
    fetchCalls += 1;
    return Promise.resolve(new Response('{}', { status: 200 }));
  };

  const service = new PopularityIngestService(pool, baseOptions({ enabled: false }), fetchMock);

  const summary = await service.runOnce();

  assert.equal(summary.enabled, false);
  assert.equal(summary.fetchedTypes, 0);
  assert.equal(summary.fetchedSignals, 0);
  assert.equal(summary.upsertedSignals, 0);
  assert.equal(summary.missingGamesDiscovered, 0);
  assert.equal(summary.gamesInserted, 0);
  assert.equal(summary.scoresUpdated, 0);
  assert.equal(connectCalled, false);
  assert.equal(fetchCalls, 0);
});

void test('runOnce resolves type ids, dedupes primitives, and recomputes scores for unique game ids', async () => {
  const recomputeParams: unknown[][] = [];
  const pool = new PoolMock((sql, params) => {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith('select pg_try_advisory_lock')) {
      return queryResult([{ acquired: true } as QueryResultRow]);
    }

    if (normalized.startsWith('select pg_advisory_unlock')) {
      return queryResult([{ pg_advisory_unlock: true } as QueryResultRow]);
    }

    if (normalized.includes('insert into game_popularity')) {
      return queryResult([], 3);
    }

    if (
      normalized.startsWith(
        'select igdb_game_id, platform_igdb_id from games where igdb_game_id = any'
      )
    ) {
      return queryResult([
        { igdb_game_id: '10', platform_igdb_id: 6 } as QueryResultRow,
        { igdb_game_id: '11', platform_igdb_id: 6 } as QueryResultRow
      ]);
    }

    if (normalized.includes('with target_game_ids as')) {
      recomputeParams.push(params ?? []);
      return queryResult(
        [{ popularity_score: 123 } as QueryResultRow, { popularity_score: 45 } as QueryResultRow],
        2
      );
    }

    throw new Error(`Unexpected SQL in test: ${sql}`);
  });

  const fetchMock: typeof fetch = (input, init) => {
    const url = toRequestUrl(input);
    if (url.includes('/oauth2/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }

    if (url.endsWith('/v4/popularity_types')) {
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }

    if (url.endsWith('/v4/popularity_primitives')) {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes('where popularity_type = 1')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { game_id: 10, popularity_type: 1, value: 10 },
              { game_id: 10, popularity_type: 1, value: 99 },
              { game_id: 11, popularity_type: 1, value: 50 }
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify([{ game_id: 11, popularity_type: 2, value: 40 }]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }

    if (url.endsWith('/v4/games')) {
      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: 10,
              name: 'Ten',
              game_type: { type: 'main_game' },
              platforms: [{ id: 6, name: 'PC' }]
            },
            {
              id: 11,
              name: 'Eleven',
              game_type: { type: 'main_game' },
              platforms: [{ id: 6, name: 'PC' }]
            }
          ]),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      );
    }

    return Promise.reject(new Error(`Unexpected fetch URL in test: ${url}`));
  };

  const service = new PopularityIngestService(pool as unknown as Pool, baseOptions(), fetchMock);

  const summary = await service.runOnce();

  assert.equal(summary.enabled, true);
  assert.equal(summary.fetchedTypes, 2);
  assert.equal(summary.fetchedSignals, 4);
  assert.equal(summary.upsertedSignals, 3);
  assert.equal(summary.missingGamesDiscovered, 0);
  assert.equal(summary.gamesInserted, 0);
  assert.equal(summary.scoresUpdated, 2);
  assert.deepEqual(recomputeParams, [[['10', '11']]]);
});

void test('runOnce batches signal upserts in 500-row chunks', async () => {
  let popularityTypesFetchCount = 0;
  let signalUpsertQueryCount = 0;

  const pool = new PoolMock((sql, params) => {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith('select pg_try_advisory_lock')) {
      return queryResult([{ acquired: true } as QueryResultRow]);
    }

    if (normalized.startsWith('select pg_advisory_unlock')) {
      return queryResult([{ pg_advisory_unlock: true } as QueryResultRow]);
    }

    if (normalized.includes('insert into game_popularity')) {
      signalUpsertQueryCount += 1;
      return queryResult([], 1);
    }

    if (
      normalized.startsWith(
        'select igdb_game_id, platform_igdb_id from games where igdb_game_id = any'
      )
    ) {
      const gameIds = Array.isArray(params?.[0])
        ? params[0].filter((value): value is string => typeof value === 'string')
        : [];
      return queryResult(
        gameIds.map((gameId) => ({ igdb_game_id: gameId, platform_igdb_id: 6 }) as QueryResultRow)
      );
    }

    if (normalized.includes('with target_game_ids as')) {
      const gameIds = Array.isArray(params?.[0])
        ? params[0].filter((value): value is string => typeof value === 'string')
        : [];
      return queryResult(
        gameIds.map(() => ({ popularity_score: 1 }) as QueryResultRow),
        gameIds.length
      );
    }

    throw new Error(`Unexpected SQL in batching test: ${sql}`);
  });

  const fetchMock: typeof fetch = (input, init) => {
    const url = toRequestUrl(input);

    if (url.includes('/oauth2/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }

    if (url.endsWith('/v4/popularity_types')) {
      popularityTypesFetchCount += 1;
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 7 }]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }

    if (url.endsWith('/v4/popularity_primitives')) {
      const rows = Array.from({ length: 501 }, (_unused, index) => ({
        game_id: index + 1,
        popularity_type: 7,
        value: 1000 - index
      }));
      return Promise.resolve(
        new Response(JSON.stringify(rows), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }

    if (url.endsWith('/v4/games')) {
      const body = typeof init?.body === 'string' ? init.body : '';
      const match = body.match(/where id = \(([^)]+)\);/);
      const ids = match
        ? match[1]
            .split(',')
            .map((value) => Number.parseInt(value.trim(), 10))
            .filter((value) => Number.isInteger(value) && value > 0)
        : [];
      const games = ids.map((id) => ({
        id,
        name: `Game ${String(id)}`,
        game_type: { type: 'main_game' },
        platforms: [{ id: 6, name: 'PC' }]
      }));
      return Promise.resolve(
        new Response(JSON.stringify(games), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }

    return Promise.reject(new Error(`Unexpected fetch URL in batching test: ${url}`));
  };

  const service = new PopularityIngestService(
    pool as unknown as Pool,
    baseOptions({ sourceTypeIds: [7], signalLimit: 501 }),
    fetchMock
  );

  const summary = await service.runOnce();

  assert.equal(popularityTypesFetchCount, 0);
  assert.equal(summary.upsertedSignals, 501);
  assert.equal(signalUpsertQueryCount, 2);
  assert.equal(summary.scoresUpdated, 501);
});

void test('runOnce exits early when advisory lock is unavailable', async () => {
  let fetchCalls = 0;
  const pool = new PoolMock((sql) => {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith('select pg_try_advisory_lock')) {
      return queryResult([{ acquired: false } as QueryResultRow]);
    }

    throw new Error(`Unexpected SQL when lock is unavailable: ${sql}`);
  });

  const fetchMock: typeof fetch = () => {
    fetchCalls += 1;
    return Promise.resolve(new Response('{}', { status: 200 }));
  };

  const service = new PopularityIngestService(pool as unknown as Pool, baseOptions(), fetchMock);

  const summary = await service.runOnce();

  assert.equal(summary.enabled, true);
  assert.equal(summary.fetchedTypes, 0);
  assert.equal(summary.fetchedSignals, 0);
  assert.equal(summary.upsertedSignals, 0);
  assert.equal(summary.missingGamesDiscovered, 0);
  assert.equal(summary.gamesInserted, 0);
  assert.equal(summary.scoresUpdated, 0);
  assert.equal(fetchCalls, 0);
});

void test('runOnce handles invalid sourceTypeIds by returning empty type summary', async () => {
  const pool = new PoolMock((sql) => {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith('select pg_try_advisory_lock')) {
      return queryResult([{ acquired: true } as QueryResultRow]);
    }

    if (normalized.startsWith('select pg_advisory_unlock')) {
      return queryResult([{ pg_advisory_unlock: true } as QueryResultRow]);
    }

    throw new Error(`Unexpected SQL for invalid sourceTypeIds test: ${sql}`);
  });

  let fetchCalls = 0;
  const fetchMock: typeof fetch = () => {
    fetchCalls += 1;
    return Promise.resolve(new Response('{}', { status: 200 }));
  };

  const service = new PopularityIngestService(
    pool as unknown as Pool,
    baseOptions({ sourceTypeIds: [0, -1, 2.5] }),
    fetchMock
  );

  const summary = await service.runOnce();

  assert.equal(summary.enabled, true);
  assert.equal(summary.fetchedTypes, 0);
  assert.equal(summary.fetchedSignals, 0);
  assert.equal(summary.upsertedSignals, 0);
  assert.equal(summary.missingGamesDiscovered, 0);
  assert.equal(summary.gamesInserted, 0);
  assert.equal(summary.scoresUpdated, 0);
  assert.equal(fetchCalls, 0);
});

void test('runOnce returns zero-signal summary when primitive rows normalize to empty', async () => {
  const pool = new PoolMock((sql) => {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith('select pg_try_advisory_lock')) {
      return queryResult([{ acquired: true } as QueryResultRow]);
    }

    if (normalized.startsWith('select pg_advisory_unlock')) {
      return queryResult([{ pg_advisory_unlock: true } as QueryResultRow]);
    }

    throw new Error(`Unexpected SQL for empty primitives test: ${sql}`);
  });

  const fetchMock: typeof fetch = (input) => {
    const url = toRequestUrl(input);

    if (url.includes('/oauth2/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }

    if (url.endsWith('/v4/popularity_primitives')) {
      return Promise.resolve(
        new Response(JSON.stringify([{ game_id: 0, popularity_type: 7, value: 'bad' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }

    return Promise.reject(new Error(`Unexpected fetch URL for empty primitives test: ${url}`));
  };

  const service = new PopularityIngestService(
    pool as unknown as Pool,
    baseOptions({ sourceTypeIds: [7] }),
    fetchMock
  );

  const summary = await service.runOnce();

  assert.equal(summary.enabled, true);
  assert.equal(summary.fetchedTypes, 1);
  assert.equal(summary.fetchedSignals, 0);
  assert.equal(summary.upsertedSignals, 0);
  assert.equal(summary.missingGamesDiscovered, 0);
  assert.equal(summary.gamesInserted, 0);
  assert.equal(summary.scoresUpdated, 0);
});

void test('runOnce inserts missing game platforms and updates scores', async () => {
  const pool = new PoolMock((sql, params) => {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith('select pg_try_advisory_lock')) {
      return queryResult([{ acquired: true } as QueryResultRow]);
    }

    if (normalized.startsWith('select pg_advisory_unlock')) {
      return queryResult([{ pg_advisory_unlock: true } as QueryResultRow]);
    }

    if (normalized.includes('insert into game_popularity')) {
      return queryResult([], 1);
    }

    if (
      normalized.startsWith(
        'select igdb_game_id, platform_igdb_id from games where igdb_game_id = any'
      )
    ) {
      return queryResult([]);
    }

    if (
      normalized.includes('insert into games (igdb_game_id, platform_igdb_id, payload, updated_at)')
    ) {
      const payload = typeof params?.[2] === 'string' ? params[2] : '';
      assert.ok(payload.includes('"gameType":"main_game"'));
      return queryResult([], 1);
    }

    if (normalized.includes('with target_game_ids as')) {
      return queryResult([{ popularity_score: 111 } as QueryResultRow], 1);
    }

    throw new Error(`Unexpected SQL for missing game insert test: ${sql}`);
  });

  const fetchMock: typeof fetch = (input) => {
    const url = toRequestUrl(input);

    if (url.includes('/oauth2/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }

    if (url.endsWith('/v4/popularity_primitives')) {
      return Promise.resolve(
        new Response(JSON.stringify([{ game_id: 10, popularity_type: 7, value: 90 }]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }

    if (url.endsWith('/v4/games')) {
      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: 10,
              name: 'New Game',
              first_release_date: 1_700_000_000,
              platforms: [{ id: 6, name: 'PC' }]
            }
          ]),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      );
    }

    return Promise.reject(new Error(`Unexpected fetch URL for missing game insert test: ${url}`));
  };

  const service = new PopularityIngestService(
    pool as unknown as Pool,
    baseOptions({ sourceTypeIds: [7], signalLimit: 1 }),
    fetchMock
  );

  const summary = await service.runOnce();

  assert.equal(summary.enabled, true);
  assert.equal(summary.fetchedTypes, 1);
  assert.equal(summary.fetchedSignals, 1);
  assert.equal(summary.upsertedSignals, 1);
  assert.equal(summary.missingGamesDiscovered, 1);
  assert.equal(summary.gamesInserted, 1);
  assert.equal(summary.scoresUpdated, 1);
});

void test('runOnce applies cooldown when popularity type fetch is rate limited', async () => {
  const pool = new PoolMock((sql) => {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith('select pg_try_advisory_lock')) {
      return queryResult([{ acquired: true } as QueryResultRow]);
    }

    if (normalized.startsWith('select pg_advisory_unlock')) {
      return queryResult([{ pg_advisory_unlock: true } as QueryResultRow]);
    }

    throw new Error(`Unexpected SQL for popularity type rate limit test: ${sql}`);
  });

  let popularityTypesFetchCalls = 0;
  const fetchMock: typeof fetch = (input) => {
    const url = toRequestUrl(input);

    if (url.includes('/oauth2/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }

    if (url.endsWith('/v4/popularity_types')) {
      popularityTypesFetchCalls += 1;
      return Promise.resolve(
        new Response('rate limited', { status: 429, headers: { 'Retry-After': '120' } })
      );
    }

    return Promise.reject(
      new Error(`Unexpected fetch URL in popularity type rate limit test: ${url}`)
    );
  };

  const service = new PopularityIngestService(pool as unknown as Pool, baseOptions(), fetchMock);

  const firstSummary = await service.runOnce();
  const secondSummary = await service.runOnce();

  assert.equal(firstSummary.enabled, true);
  assert.equal(firstSummary.fetchedTypes, 0);
  assert.equal(firstSummary.fetchedSignals, 0);
  assert.equal(secondSummary.enabled, true);
  assert.equal(secondSummary.fetchedTypes, 0);
  assert.equal(secondSummary.fetchedSignals, 0);
  assert.equal(popularityTypesFetchCalls, 1);
});

void test('runOnce returns partial summary when primitive fetch is rate limited', async () => {
  let signalsUpserted = 0;
  const pool = new PoolMock((sql, params) => {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith('select pg_try_advisory_lock')) {
      return queryResult([{ acquired: true } as QueryResultRow]);
    }

    if (normalized.startsWith('select pg_advisory_unlock')) {
      return queryResult([{ pg_advisory_unlock: true } as QueryResultRow]);
    }

    if (normalized.includes('insert into game_popularity')) {
      signalsUpserted += 1;
      return queryResult([], 1);
    }

    if (
      normalized.startsWith(
        'select igdb_game_id, platform_igdb_id from games where igdb_game_id = any'
      )
    ) {
      const gameIds = Array.isArray(params?.[0])
        ? params[0].filter((value): value is string => typeof value === 'string')
        : [];
      return queryResult(
        gameIds.map((gameId) => ({ igdb_game_id: gameId, platform_igdb_id: 6 }) as QueryResultRow)
      );
    }

    if (normalized.includes('with target_game_ids as')) {
      return queryResult([{ popularity_score: 77 } as QueryResultRow], 1);
    }

    throw new Error(`Unexpected SQL for primitive rate limit test: ${sql}`);
  });

  const fetchMock: typeof fetch = (input, init) => {
    const url = toRequestUrl(input);

    if (url.includes('/oauth2/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }

    if (url.endsWith('/v4/popularity_primitives')) {
      const body = typeof init?.body === 'string' ? init.body : '';

      if (body.includes('where popularity_type = 1')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ game_id: 10, popularity_type: 1, value: 90 }]), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }

      return Promise.resolve(
        new Response('rate limited', { status: 429, headers: { 'Retry-After': '30' } })
      );
    }

    if (url.endsWith('/v4/games')) {
      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: 10,
              name: 'Ten',
              game_type: { type: 'main_game' },
              platforms: [{ id: 6, name: 'PC' }]
            }
          ]),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      );
    }

    return Promise.reject(new Error(`Unexpected fetch URL in primitive rate limit test: ${url}`));
  };

  const service = new PopularityIngestService(
    pool as unknown as Pool,
    baseOptions({ sourceTypeIds: [1, 2] }),
    fetchMock
  );

  const summary = await service.runOnce();

  assert.equal(summary.enabled, true);
  assert.equal(summary.fetchedTypes, 2);
  assert.equal(summary.fetchedSignals, 1);
  assert.equal(summary.upsertedSignals, 1);
  assert.equal(summary.scoresUpdated, 1);
  assert.equal(signalsUpserted, 1);
});

void test('runOnce keeps persisted signal results when game metadata fetch is rate limited', async () => {
  const pool = new PoolMock((sql) => {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith('select pg_try_advisory_lock')) {
      return queryResult([{ acquired: true } as QueryResultRow]);
    }

    if (normalized.startsWith('select pg_advisory_unlock')) {
      return queryResult([{ pg_advisory_unlock: true } as QueryResultRow]);
    }

    if (normalized.includes('insert into game_popularity')) {
      return queryResult([], 1);
    }

    if (normalized.includes('with target_game_ids as')) {
      return queryResult([{ popularity_score: 33 } as QueryResultRow], 1);
    }

    throw new Error(`Unexpected SQL for game metadata rate limit test: ${sql}`);
  });

  const fetchMock: typeof fetch = (input) => {
    const url = toRequestUrl(input);

    if (url.includes('/oauth2/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }

    if (url.endsWith('/v4/popularity_primitives')) {
      return Promise.resolve(
        new Response(JSON.stringify([{ game_id: 10, popularity_type: 7, value: 90 }]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }

    if (url.endsWith('/v4/games')) {
      return Promise.resolve(
        new Response('rate limited', { status: 429, headers: { 'Retry-After': '45' } })
      );
    }

    return Promise.reject(
      new Error(`Unexpected fetch URL for game metadata rate limit test: ${url}`)
    );
  };

  const service = new PopularityIngestService(
    pool as unknown as Pool,
    baseOptions({ sourceTypeIds: [7] }),
    fetchMock
  );

  const summary = await service.runOnce();

  assert.equal(summary.enabled, true);
  assert.equal(summary.fetchedTypes, 1);
  assert.equal(summary.fetchedSignals, 1);
  assert.equal(summary.upsertedSignals, 1);
  assert.equal(summary.missingGamesDiscovered, 0);
  assert.equal(summary.gamesInserted, 0);
  assert.equal(summary.scoresUpdated, 1);
});
