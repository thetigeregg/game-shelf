import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { describe, expect, it, vi } from 'vitest';
import { SQLITE_UPGRADE_STATEMENTS } from './sqlite-connection';
import type { SqliteConnection, SqliteRunResult, SqliteStatement } from './sqlite-connection';
import { SqliteStorageEngine } from './sqlite-storage-engine';
import {
  describeStorageEngineContract,
  makeContractGame,
  makeContractImageCacheRecord,
  makeContractTag,
  makeContractView,
} from './storage-engine.contract';
import { isStorageConstraintError } from './storage-engine';
import type { DebugLogService } from '../services/debug-log.service';

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

describe('SqliteStorageEngine transaction logging', () => {
  it('traces begin and committed when a transaction succeeds', async () => {
    const traceSpy = vi.fn();
    const debugLog = {
      trace: traceSpy,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as DebugLogService;
    const connection = await InProcessSqliteConnection.create();
    const engine = new SqliteStorageEngine(connection, debugLog);

    await engine.runInTransaction(['games'], () => Promise.resolve());

    expect(traceSpy).toHaveBeenCalledWith('sqlite.transaction.begin', expect.any(Object));
    expect(traceSpy).toHaveBeenCalledWith('sqlite.transaction.committed');

    await connection.close();
  });

  it('traces rolled_back when the action throws', async () => {
    const traceSpy = vi.fn();
    const debugLog = {
      trace: traceSpy,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as DebugLogService;
    const connection = await InProcessSqliteConnection.create();
    const engine = new SqliteStorageEngine(connection, debugLog);

    await expect(
      engine.runInTransaction(['games'], () => Promise.reject(new Error('action failed')))
    ).rejects.toThrow('action failed');

    expect(traceSpy).toHaveBeenCalledWith('sqlite.transaction.rolled_back');

    await connection.close();
  });

  it('warns when rollback itself fails after an action error', async () => {
    const warnSpy = vi.fn();
    const debugLog = {
      trace: vi.fn(),
      info: vi.fn(),
      warn: warnSpy,
      error: vi.fn(),
    } as unknown as DebugLogService;
    const connection = await InProcessSqliteConnection.create();
    vi.spyOn(connection, 'rollbackTransaction').mockRejectedValueOnce(new Error('rollback failed'));
    const engine = new SqliteStorageEngine(connection, debugLog);

    await expect(
      engine.runInTransaction(['games'], () => Promise.reject(new Error('action failed')))
    ).rejects.toThrow('action failed');

    expect(warnSpy).toHaveBeenCalledWith(
      'sqlite.transaction.rollback_failed',
      expect.objectContaining({ error: 'rollback failed' })
    );

    await connection.close();
  });
});

describe('SqliteStorageEngine coverage gaps', () => {
  it('countGames returns 0 on empty store and the correct count after inserts', async () => {
    const connection = await InProcessSqliteConnection.create();
    const engine = new SqliteStorageEngine(connection);

    expect(await engine.countGames()).toBe(0);

    await engine.addGame(makeContractGame());
    await engine.addGame(makeContractGame({ igdbGameId: '202', platformIgdbId: 20 }));

    expect(await engine.countGames()).toBe(2);
    await connection.close();
  });

  it('putGame inserts when id is undefined', async () => {
    const connection = await InProcessSqliteConnection.create();
    const engine = new SqliteStorageEngine(connection);

    const id = await engine.putGame(makeContractGame());

    expect(typeof id).toBe('number');
    expect(await engine.getGameById(id)).toBeDefined();
    await connection.close();
  });

  it('updateGame is a no-op when the game does not exist', async () => {
    const connection = await InProcessSqliteConnection.create();
    const engine = new SqliteStorageEngine(connection);

    await expect(engine.updateGame(9999, { title: 'Ghost' })).resolves.toBeUndefined();
    await connection.close();
  });

  it('putTag inserts when id is undefined', async () => {
    const connection = await InProcessSqliteConnection.create();
    const engine = new SqliteStorageEngine(connection);

    const id = await engine.putTag(makeContractTag());

    expect(typeof id).toBe('number');
    expect(await engine.getTag(id)).toBeDefined();
    await connection.close();
  });

  it('putView inserts when id is undefined', async () => {
    const connection = await InProcessSqliteConnection.create();
    const engine = new SqliteStorageEngine(connection);

    const id = await engine.putView(makeContractView());

    expect(typeof id).toBe('number');
    expect(await engine.getView(id)).toBeDefined();
    await connection.close();
  });

  it('putImageCache updates an existing record by id', async () => {
    const connection = await InProcessSqliteConnection.create();
    const engine = new SqliteStorageEngine(connection);
    const record = makeContractImageCacheRecord();

    const id = await engine.putImageCache(record);
    const updated = { ...record, id, sizeBytes: 2048 };
    const returnedId = await engine.putImageCache(updated);

    expect(returnedId).toBe(id);
    await connection.close();
  });

  it('updateImageCacheLastAccessedAt is a no-op when record does not exist', async () => {
    const connection = await InProcessSqliteConnection.create();
    const engine = new SqliteStorageEngine(connection);

    await expect(
      engine.updateImageCacheLastAccessedAt(9999, '2026-06-01T00:00:00.000Z')
    ).resolves.toBeUndefined();
    await connection.close();
  });

  it('propagates non-Error throws from connection as wrapped errors', async () => {
    const mockRun = vi.fn().mockRejectedValue('sqlite: table locked');
    const connection = {
      run: mockRun,
      query: vi.fn().mockResolvedValue([]),
      executeSet: vi.fn().mockResolvedValue(undefined),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      rollbackTransaction: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as SqliteConnection;
    const engine = new SqliteStorageEngine(connection);

    await expect(engine.addGame(makeContractGame())).rejects.toThrow('sqlite: table locked');
  });

  it('requireLastId throws when insert returns no lastId', async () => {
    const mockRun = vi.fn().mockResolvedValue({ changes: 1, lastId: undefined });
    const connection = {
      run: mockRun,
      query: vi.fn().mockResolvedValue([]),
      executeSet: vi.fn().mockResolvedValue(undefined),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      rollbackTransaction: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as SqliteConnection;
    const engine = new SqliteStorageEngine(connection);

    await expect(engine.addGame(makeContractGame())).rejects.toThrow(
      'SQLite insert did not return a generated id.'
    );
  });
});
