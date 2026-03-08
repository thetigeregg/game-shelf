import assert from 'node:assert/strict';
import test from 'node:test';
import { MIGRATIONS, runMigrations } from '../db.js';

class FakeMigrationClient {
  readonly statements: string[] = [];

  query(sql: string): Promise<void> {
    this.statements.push(sql);
    return Promise.resolve();
  }
}

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

  const client = new FakeMigrationClient();
  await runMigrations(client);
  await runMigrations(client);

  assert.equal(client.statements.length, MIGRATIONS.length * 2);
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
