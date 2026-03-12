import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { MIGRATIONS, createPool, isMigrationUnlockError, runMigrations } from '../db.js';

class FakeMigrationClient {
  readonly statements: string[] = [];

  query(sql: string): Promise<void> {
    this.statements.push(sql);
    return Promise.resolve();
  }
}

void test('runMigrations normalizes non-error throw values', async () => {
  const lockSqlPattern = 'pg_advisory_lock';
  const unlockSqlPattern = 'pg_advisory_unlock';
  const migrationClient = {
    query(sql: string): Promise<void> {
      if (sql.includes(lockSqlPattern) || sql.includes(unlockSqlPattern)) {
        return Promise.resolve();
      }
      const nonErrorReason: unknown = 'migration_failed_as_string';
      return Promise.reject(nonErrorReason as Error);
    }
  };

  await assert.rejects(
    runMigrations(migrationClient),
    (error: unknown) =>
      error instanceof Error && error.message.includes('migration_failed_as_string')
  );
});

void test('createPool destroys client when migration unlock fails', async () => {
  const originalConnectDescriptor = Object.getOwnPropertyDescriptor(Pool.prototype, 'connect');
  const releaseCalls: boolean[] = [];

  const fakeClient = {
    query(sql: string): Promise<unknown> {
      if (sql.includes('pg_advisory_unlock')) {
        return Promise.reject(new Error('unlock_failed'));
      }
      return Promise.resolve();
    },
    release(destroy?: boolean): void {
      releaseCalls.push(destroy ?? false);
    }
  };

  Pool.prototype.connect = function connect(): Promise<typeof fakeClient> {
    return Promise.resolve(fakeClient);
  };

  try {
    await assert.rejects(
      createPool('postgres://example:example@localhost:5432/example'),
      (error: unknown) =>
        isMigrationUnlockError(error) && error.unlockError.message === 'unlock_failed'
    );
    assert.deepEqual(releaseCalls, [true]);
  } finally {
    if (originalConnectDescriptor) {
      Object.defineProperty(Pool.prototype, 'connect', originalConnectDescriptor);
    }
  }
});

void test('recommendation migrations are present and idempotent runner executes all statements', async () => {
  const recommendationSql = MIGRATIONS.join('\n');

  assert.equal(recommendationSql.includes('CREATE EXTENSION IF NOT EXISTS vector'), true);
  assert.equal(recommendationSql.includes('CREATE TABLE IF NOT EXISTS recommendation_runs'), true);
  assert.equal(recommendationSql.includes("'BACKLOG', 'WISHLIST', 'DISCOVERY'"), true);
  assert.equal(recommendationSql.includes('CREATE TABLE IF NOT EXISTS recommendations'), true);
  assert.equal(
    recommendationSql.includes("runtime_mode IN ('NEUTRAL', 'SHORT', 'LONG')") ||
      recommendationSql.includes("runtime_mode IN ('NEUTRAL','SHORT','LONG')"),
    true
  );
  assert.equal(recommendationSql.includes('CREATE TABLE IF NOT EXISTS game_similarity'), true);
  assert.equal(recommendationSql.includes('ADD COLUMN IF NOT EXISTS run_id BIGINT'), true);
  assert.equal(recommendationSql.includes('ADD COLUMN IF NOT EXISTS target TEXT'), true);
  assert.equal(recommendationSql.includes('ADD COLUMN IF NOT EXISTS runtime_mode TEXT'), true);
  assert.equal(recommendationSql.includes('game_similarity_target_check'), true);
  assert.equal(
    recommendationSql.includes('game_similarity_runtime_mode_check') &&
      recommendationSql.includes("('NEUTRAL', 'SHORT', 'LONG')"),
    true
  );
  assert.equal(recommendationSql.includes('CREATE TABLE IF NOT EXISTS recommendation_lanes'), true);
  assert.equal(
    recommendationSql.includes(
      "'overall', 'hiddenGems', 'exploration', 'blended', 'popular', 'recent'"
    ),
    true
  );
  assert.equal(
    recommendationSql.includes('CREATE TABLE IF NOT EXISTS recommendation_history'),
    true
  );
  assert.equal(recommendationSql.includes('CREATE TABLE IF NOT EXISTS game_embeddings'), true);
  assert.equal(recommendationSql.includes('USING ivfflat (embedding vector_cosine_ops)'), true);
  assert.equal(recommendationSql.includes('recommendations_run_mode_rank_idx'), true);
  assert.equal(recommendationSql.includes('recommendation_lanes_run_mode_lane_rank_idx'), true);
  assert.equal(recommendationSql.includes('game_similarity_run_mode_source_similarity_idx'), true);
  assert.equal(recommendationSql.includes('recommendation_history_target_mode_last_idx'), true);
  assert.equal(
    recommendationSql.includes(
      "COALESCE(payload->>'reviewSource', '') NOT IN ('metacritic', 'mobygames')"
    ),
    true
  );
  assert.equal(recommendationSql.includes('jsonb_build_object('), true);
  assert.equal(recommendationSql.includes("'reviewScore', NULL"), true);
  assert.equal(recommendationSql.includes("'enrichmentRetry', NULL"), true);

  const client = new FakeMigrationClient();
  await runMigrations(client);
  await runMigrations(client);

  const advisoryLockStatements = client.statements.filter((statement) =>
    statement.includes('pg_advisory_lock')
  );
  const advisoryUnlockStatements = client.statements.filter((statement) =>
    statement.includes('pg_advisory_unlock')
  );

  assert.equal(advisoryLockStatements.length, 2);
  assert.equal(advisoryUnlockStatements.length, 2);
  assert.equal(client.statements.length, MIGRATIONS.length * 2 + 4);

  const firstLockIndex = client.statements.findIndex((statement) =>
    statement.includes('pg_advisory_lock')
  );
  const firstMigrationIndex = client.statements.findIndex(
    (statement) =>
      !statement.includes('pg_advisory_lock') && !statement.includes('pg_advisory_unlock')
  );
  const firstUnlockIndex = client.statements.findIndex((statement) =>
    statement.includes('pg_advisory_unlock')
  );
  assert.notEqual(firstLockIndex, -1);
  assert.notEqual(firstMigrationIndex, -1);
  assert.notEqual(firstUnlockIndex, -1);
  assert.ok(firstLockIndex < firstMigrationIndex);
  assert.ok(firstMigrationIndex < firstUnlockIndex);

  const secondLockIndex = client.statements.findIndex(
    (statement, index) => index > firstUnlockIndex && statement.includes('pg_advisory_lock')
  );
  const secondMigrationIndex = client.statements.findIndex(
    (statement, index) =>
      index > secondLockIndex &&
      !statement.includes('pg_advisory_lock') &&
      !statement.includes('pg_advisory_unlock')
  );
  const secondUnlockIndex = client.statements.findIndex(
    (statement, index) => index > secondMigrationIndex && statement.includes('pg_advisory_unlock')
  );
  assert.notEqual(secondLockIndex, -1);
  assert.notEqual(secondMigrationIndex, -1);
  assert.notEqual(secondUnlockIndex, -1);
  assert.ok(secondLockIndex < secondMigrationIndex);
  assert.ok(secondMigrationIndex < secondUnlockIndex);
});

void test('migration SQL scopes constraint checks to target tables for drift safety', () => {
  const sql = MIGRATIONS.join('\n');

  assert.equal(
    sql.includes("conname = 'release_watch_state_release_precision_check'") &&
      sql.includes("conrelid = 'release_watch_state'::regclass"),
    true
  );
  assert.equal(
    sql.includes("conname = 'recommendation_runs_target_check'") &&
      sql.includes("conrelid = 'recommendation_runs'::regclass"),
    true
  );
  assert.equal(
    sql.includes("conname = 'recommendations_runtime_mode_check'") &&
      sql.includes("conrelid = 'recommendations'::regclass"),
    true
  );
  assert.equal(
    sql.includes("conname = 'recommendations_run_runtime_game_uid'") &&
      sql.includes("conrelid = 'recommendations'::regclass"),
    true
  );
  assert.equal(
    sql.includes("conname = 'game_similarity_target_check'") &&
      sql.includes("conrelid = 'game_similarity'::regclass"),
    true
  );
  assert.equal(
    sql.includes("conname = 'game_similarity_runtime_mode_check'") &&
      sql.includes("conrelid = 'game_similarity'::regclass"),
    true
  );
  assert.equal(
    sql.includes("conname = 'game_similarity_run_fk'") &&
      sql.includes("conrelid = 'game_similarity'::regclass"),
    true
  );
  assert.equal(
    sql.includes("conname = 'recommendation_lanes_lane_check'") &&
      sql.includes("conrelid = 'recommendation_lanes'::regclass"),
    true
  );
  assert.equal(
    sql.includes("conname = 'recommendation_history_target_check'") &&
      sql.includes("conrelid = 'recommendation_history'::regclass"),
    true
  );
});

void test('migration SQL handles primary key drift by definition for recommendations and similarity', () => {
  const sql = MIGRATIONS.join('\n');

  assert.equal(
    sql.includes("WHERE c.conrelid = 'recommendations'::regclass") &&
      sql.includes("AND c.contype = 'p'") &&
      sql.includes('pg_get_constraintdef(c.oid)'),
    true
  );
  assert.equal(
    sql.includes('ALTER TABLE recommendations DROP CONSTRAINT') &&
      sql.includes('ALTER TABLE recommendations RENAME CONSTRAINT'),
    true
  );

  assert.equal(
    sql.includes("WHERE c.conrelid = 'game_similarity'::regclass") &&
      sql.includes("AND c.contype = 'p'") &&
      sql.includes('pg_get_constraintdef(c.oid)'),
    true
  );
  assert.equal(
    sql.includes('ALTER TABLE game_similarity DROP CONSTRAINT') &&
      sql.includes('ALTER TABLE game_similarity RENAME CONSTRAINT'),
    true
  );
});

void test('override lock backfill heuristics avoid over-locking legacy provider rows', () => {
  const sql = MIGRATIONS.join('\n');
  const distinctGuardCount = sql.split('payload IS DISTINCT FROM (').length - 1;

  assert.equal(sql.includes("'psPricesMatchLocked'"), true);
  assert.equal(sql.includes("'reviewMatchLocked'"), true);
  assert.equal(sql.includes("OR NOT (payload ? 'reviewMatchLocked')"), true);
  assert.equal(distinctGuardCount >= 2, true);
  assert.equal(sql.includes("payload->>'psPricesUrl'"), false);
  assert.equal(
    sql.includes("OR BTRIM(COALESCE(payload->>'reviewMatchMobygamesGameId', '')) ~ '^[0-9]+$'"),
    false
  );
});
