import assert from 'node:assert/strict';
import test from 'node:test';
import { MetadataEnrichmentRepository } from './repository.js';

class PoolMock {
  public queries: Array<{ sql: string; params: unknown[] | undefined }> = [];

  constructor(
    private readonly handlers: {
      onQuery?: (sql: string, params: unknown[] | undefined) => { rows: unknown[] };
      onConnect?: () => {
        query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
        release: () => void;
      };
    } = {}
  ) {}

  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
    this.queries.push({ sql, params });
    return Promise.resolve(
      this.handlers.onQuery ? this.handlers.onQuery(sql, params) : { rows: [] }
    );
  }

  connect(): Promise<{
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    release: () => void;
  }> {
    if (this.handlers.onConnect) {
      return Promise.resolve(this.handlers.onConnect());
    }

    return Promise.reject(new Error('connect handler missing'));
  }
}

void test('repository selects rows missing themes/keywords arrays', async () => {
  const pool = new PoolMock({
    onQuery: () => ({
      rows: [{ igdb_game_id: '1520', platform_igdb_id: 4, payload: { title: 'Game' } }]
    })
  });
  const repository = new MetadataEnrichmentRepository(pool as never);

  const rows = await repository.listRowsMissingMetadata(10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.igdbGameId, '1520');
  assert.equal(rows[0]?.platformIgdbId, 4);

  const sql = pool.queries[0]?.sql ?? '';
  assert.equal(sql.includes("COALESCE(jsonb_typeof(payload -> 'themes'), '') <> 'array'"), true);
  assert.equal(sql.includes("COALESCE(jsonb_typeof(payload -> 'keywords'), '') <> 'array'"), true);
});

void test('repository wraps callback with advisory lock and unlock', async () => {
  const queries: string[] = [];
  const repository = new MetadataEnrichmentRepository(
    new PoolMock({
      onConnect: () => ({
        query: (sql: string) => {
          queries.push(sql);
          if (sql.includes('pg_try_advisory_lock')) {
            return Promise.resolve({ rows: [{ acquired: true }] });
          }
          return Promise.resolve({ rows: [] });
        },
        release: () => undefined
      })
    }) as never
  );

  const result = await repository.withAdvisoryLock(() => Promise.resolve('ok'));
  assert.equal(result.acquired, true);
  assert.equal((result as { acquired: true; value: string }).value, 'ok');
  assert.equal(
    queries.some((sql) => sql.includes('pg_try_advisory_lock')),
    true
  );
  assert.equal(
    queries.some((sql) => sql.includes('pg_advisory_unlock')),
    true
  );
});
