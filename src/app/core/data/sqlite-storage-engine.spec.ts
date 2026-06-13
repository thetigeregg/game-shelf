import BetterSqlite3 from 'better-sqlite3';
import { SQLITE_UPGRADE_STATEMENTS } from './sqlite-connection';
import type { SqliteConnection, SqliteRunResult, SqliteStatement } from './sqlite-connection';
import { SqliteStorageEngine } from './sqlite-storage-engine';
import { describeStorageEngineContract } from './storage-engine.contract';

/**
 * In-process SqliteConnection used to exercise SqliteStorageEngine in vitest
 * without a device. Implements the same run/query/executeSet/transaction
 * surface the Capacitor plugin adapter provides.
 */
class InProcessSqliteConnection implements SqliteConnection {
  private readonly db: BetterSqlite3.Database;

  constructor() {
    this.db = new BetterSqlite3(':memory:');
    for (const upgrade of SQLITE_UPGRADE_STATEMENTS) {
      for (const statement of upgrade.statements) {
        this.db.exec(statement);
      }
    }
  }

  run(statement: string, values: unknown[]): Promise<SqliteRunResult> {
    try {
      const result = this.db.prepare(statement).run(...values.map(normalizeValue));
      return Promise.resolve({
        changes: result.changes,
        lastId: Number(result.lastInsertRowid),
      });
    } catch (error: unknown) {
      return Promise.reject(toError(error));
    }
  }

  query<T = Record<string, unknown>>(statement: string, values: unknown[]): Promise<T[]> {
    try {
      return Promise.resolve(this.db.prepare(statement).all(...values.map(normalizeValue)) as T[]);
    } catch (error: unknown) {
      return Promise.reject(toError(error));
    }
  }

  executeSet(statements: SqliteStatement[]): Promise<void> {
    try {
      for (const entry of statements) {
        this.db.prepare(entry.statement).run(...entry.values.map(normalizeValue));
      }
      return Promise.resolve();
    } catch (error: unknown) {
      return Promise.reject(toError(error));
    }
  }

  beginTransaction(): Promise<void> {
    this.db.exec('BEGIN');
    return Promise.resolve();
  }

  commitTransaction(): Promise<void> {
    this.db.exec('COMMIT');
    return Promise.resolve();
  }

  rollbackTransaction(): Promise<void> {
    this.db.exec('ROLLBACK');
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

describeStorageEngineContract('SqliteStorageEngine', () => {
  const connection = new InProcessSqliteConnection();
  const engine = new SqliteStorageEngine(connection);

  return Promise.resolve({
    engine,
    cleanup: () => connection.close(),
  });
});
