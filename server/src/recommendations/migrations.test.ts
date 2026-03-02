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

  assert.equal(recommendationSql.includes('CREATE TABLE IF NOT EXISTS recommendation_runs'), true);
  assert.equal(recommendationSql.includes('CREATE TABLE IF NOT EXISTS recommendations'), true);
  assert.equal(recommendationSql.includes('CREATE TABLE IF NOT EXISTS game_similarity'), true);

  const client = new FakeMigrationClient();
  await runMigrations(client);
  await runMigrations(client);

  assert.equal(client.statements.length, MIGRATIONS.length * 2);
});
