import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { runMigrations } from '../db.js';

const driftDatabaseUrl =
  typeof process.env.MIGRATION_DRIFT_TEST_DATABASE_URL === 'string'
    ? process.env.MIGRATION_DRIFT_TEST_DATABASE_URL.trim()
    : '';

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

void test(
  'migrations repair primary-key and check-constraint drift on real postgres',
  { skip: driftDatabaseUrl.length === 0 },
  async () => {
    const schemaName = `migration_drift_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const schemaIdent = quoteIdentifier(schemaName);
    const pool = new Pool({ connectionString: driftDatabaseUrl, max: 1 });
    const client = await pool.connect();

    try {
      await client.query(`CREATE SCHEMA ${schemaIdent}`);
      await client.query(`SET search_path TO ${schemaIdent}, public`);
      await runMigrations(client);

      // Drift 1: recommendations primary key renamed/redefined.
      await client.query('ALTER TABLE recommendations DROP CONSTRAINT recommendations_pkey');
      await client.query(
        'ALTER TABLE recommendations ADD CONSTRAINT recommendations_drift_pk PRIMARY KEY (run_id, rank)'
      );

      // Drift 2: game_similarity primary key renamed/redefined.
      await client.query('ALTER TABLE game_similarity DROP CONSTRAINT game_similarity_pkey');
      await client.query(
        'ALTER TABLE game_similarity ADD CONSTRAINT game_similarity_drift_pk PRIMARY KEY (source_igdb_game_id, source_platform_igdb_id, similar_igdb_game_id, similar_platform_igdb_id)'
      );

      // Drift 3: same constraint name exists on another table; target table is missing it.
      await client.query(
        'ALTER TABLE recommendations DROP CONSTRAINT IF EXISTS recommendations_runtime_mode_check'
      );
      await client.query('CREATE TABLE migration_drift_shadow (runtime_mode TEXT NOT NULL)');
      await client.query(
        "ALTER TABLE migration_drift_shadow ADD CONSTRAINT recommendations_runtime_mode_check CHECK (runtime_mode IN ('SHADOW'))"
      );

      await runMigrations(client);

      const recommendationsPk = await client.query<{
        conname: string;
        definition: string;
      }>(
        `
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'recommendations'::regclass
          AND contype = 'p'
        LIMIT 1
        `
      );
      assert.equal(recommendationsPk.rowCount, 1);
      assert.equal(recommendationsPk.rows[0]?.conname, 'recommendations_pkey');
      assert.equal(
        recommendationsPk.rows[0]?.definition.startsWith(
          'PRIMARY KEY (run_id, runtime_mode, rank)'
        ),
        true
      );

      const gameSimilarityPk = await client.query<{
        conname: string;
        definition: string;
      }>(
        `
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'game_similarity'::regclass
          AND contype = 'p'
        LIMIT 1
        `
      );
      assert.equal(gameSimilarityPk.rowCount, 1);
      assert.equal(gameSimilarityPk.rows[0]?.conname, 'game_similarity_pkey');
      assert.equal(
        gameSimilarityPk.rows[0]?.definition.startsWith(
          'PRIMARY KEY (run_id, target, runtime_mode, source_igdb_game_id, source_platform_igdb_id, similar_igdb_game_id, similar_platform_igdb_id)'
        ),
        true
      );

      const recommendationsRuntimeCheck = await client.query<{ definition: string }>(
        `
        SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'recommendations'::regclass
          AND conname = 'recommendations_runtime_mode_check'
        LIMIT 1
        `
      );
      assert.equal(recommendationsRuntimeCheck.rowCount, 1);
      const runtimeCheckDefinition = recommendationsRuntimeCheck.rows[0]?.definition ?? '';
      assert.equal(
        runtimeCheckDefinition.includes('NEUTRAL') &&
          runtimeCheckDefinition.includes('SHORT') &&
          runtimeCheckDefinition.includes('LONG'),
        true
      );
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schemaIdent} CASCADE`);
      client.release();
      await pool.end();
    }
  }
);
