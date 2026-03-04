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
  assert.equal(recommendationSql.includes('ADD COLUMN IF NOT EXISTS runtime_mode TEXT'), true);
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
