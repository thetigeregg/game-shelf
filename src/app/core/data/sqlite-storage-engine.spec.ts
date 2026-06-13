import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { describe, expect, it, vi } from 'vitest';
import { SQLITE_UPGRADE_STATEMENTS } from './sqlite-connection';
import type { SqliteConnection, SqliteRunResult, SqliteStatement } from './sqlite-connection';
import { SqliteStorageEngine } from './sqlite-storage-engine';
import { describeStorageEngineContract, makeContractTag } from './storage-engine.contract';
import { isStorageConstraintError } from './storage-engine';

vi.mock('./storage-transaction-context', () => import('./storage-transaction-context.node'));

const require = createRequire(import.meta.url);
let sqlJsPromise: Promise<SqlJsStatic> | undefined;

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    const wasmBinary = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));
    sqlJsPromise = initSqlJs({ wasmBinary });
  }

  return sqlJsPromise;
}

/**
 * In-process SqliteConnection used to exercise SqliteStorageEngine in vitest
 * without a device. Implements the same run/query/executeSet/transaction
 * surface the Capacitor plugin adapter provides.
 */
class InProcessSqliteConnection implements SqliteConnection {
  private readonly db: Database;

  private constructor(db: Database) {
    this.db = db;

    for (const upgrade of SQLITE_UPGRADE_STATEMENTS) {
      for (const statement of upgrade.statements) {
        this.db.run(statement);
      }
    }
  }

  static async create(): Promise<InProcessSqliteConnection> {
    const SQL = await loadSqlJs();
    return new InProcessSqliteConnection(new SQL.Database());
  }

  run(statement: string, values: unknown[]): Promise<SqliteRunResult> {
    try {
      this.db.run(statement, values.map(normalizeValue));
      const lastIdResult = this.db.exec('SELECT last_insert_rowid() AS id');
      const rawLastId = lastIdResult[0]?.values[0]?.[0];
      const lastId = typeof rawLastId === 'number' ? rawLastId : Number(rawLastId);

      return Promise.resolve({
        changes: this.db.getRowsModified(),
        lastId: Number.isFinite(lastId) ? lastId : undefined,
      });
    } catch (error: unknown) {
      return Promise.reject(toError(error));
    }
  }

  query<T = Record<string, unknown>>(statement: string, values: unknown[]): Promise<T[]> {
    try {
      const stmt = this.db.prepare(statement);
      stmt.bind(values.map(normalizeValue));
      const rows: T[] = [];

      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }

      stmt.free();
      return Promise.resolve(rows);
    } catch (error: unknown) {
      return Promise.reject(toError(error));
    }
  }

  executeSet(statements: SqliteStatement[]): Promise<void> {
    try {
      for (const entry of statements) {
        this.db.run(entry.statement, entry.values.map(normalizeValue));
      }

      return Promise.resolve();
    } catch (error: unknown) {
      return Promise.reject(toError(error));
    }
  }

  beginTransaction(): Promise<void> {
    this.db.run('BEGIN');
    return Promise.resolve();
  }

  commitTransaction(): Promise<void> {
    this.db.run('COMMIT');
    return Promise.resolve();
  }

  rollbackTransaction(): Promise<void> {
    this.db.run('ROLLBACK');
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  return value;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

describeStorageEngineContract('SqliteStorageEngine', async () => {
  const connection = await InProcessSqliteConnection.create();
  const engine = new SqliteStorageEngine(connection);

  return {
    engine,
    cleanup: () => connection.close(),
  };
});

describe('SqliteStorageEngine schema', () => {
  it('rejects tag names that differ only by case', async () => {
    const connection = await InProcessSqliteConnection.create();
    const engine = new SqliteStorageEngine(connection);

    await engine.addTag(makeContractTag({ name: 'Backlog' }));

    await expect(
      engine.addTag(makeContractTag({ name: 'backlog', color: '#ff0000' }))
    ).rejects.toSatisfy((error: unknown) => isStorageConstraintError(error));

    await connection.close();
  });
});
