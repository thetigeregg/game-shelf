import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

export interface SqliteStatement {
  statement: string;
  values: unknown[];
}

export interface SqliteRunResult {
  changes: number;
  lastId: number | undefined;
}

/**
 * Thin SQL execution surface the SqliteStorageEngine talks to. Production uses
 * the @capacitor-community/sqlite plugin; tests provide an in-process SQLite
 * implementation with the same semantics.
 */
export interface SqliteConnection {
  run(statement: string, values: unknown[]): Promise<SqliteRunResult>;
  query<T = Record<string, unknown>>(statement: string, values: unknown[]): Promise<T[]>;
  executeSet(statements: SqliteStatement[]): Promise<void>;
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
  close(): Promise<void>;
}

export const SQLITE_DB_NAME = 'game-shelf';
export const SQLITE_SCHEMA_VERSION = 1;

export const SQLITE_UPGRADE_STATEMENTS: { toVersion: number; statements: string[] }[] = [
  {
    toVersion: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        igdb_game_id TEXT NOT NULL,
        platform_igdb_id INTEGER NOT NULL,
        list_type TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_games_identity ON games (igdb_game_id, platform_igdb_id);`,
      `CREATE INDEX IF NOT EXISTS idx_games_list_type ON games (list_type);`,
      `CREATE INDEX IF NOT EXISTS idx_games_title ON games (title);`,
      `CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        payload TEXT NOT NULL
      );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name ON tags (name);`,
      `CREATE TABLE IF NOT EXISTS views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_type TEXT NOT NULL,
        name TEXT NOT NULL,
        payload TEXT NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_views_list_type ON views (list_type);`,
      `CREATE TABLE IF NOT EXISTS outbox (
        op_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_outbox_created_at ON outbox (created_at);`,
      `CREATE INDEX IF NOT EXISTS idx_outbox_entity_type ON outbox (entity_type);`,
      `CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS image_cache_meta (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cache_key TEXT NOT NULL,
        game_key TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_image_cache_cache_key ON image_cache_meta (cache_key);`,
      `CREATE INDEX IF NOT EXISTS idx_image_cache_game_key ON image_cache_meta (game_key);`,
      `CREATE INDEX IF NOT EXISTS idx_image_cache_last_accessed_at ON image_cache_meta (last_accessed_at);`,
    ],
  },
];

class CapacitorSqliteConnection implements SqliteConnection {
  constructor(
    private readonly sqlite: SQLiteConnection,
    private readonly db: SQLiteDBConnection,
    private readonly dbName: string
  ) {}

  async run(statement: string, values: unknown[]): Promise<SqliteRunResult> {
    const result = await this.db.run(statement, values, false);
    return {
      changes: result.changes?.changes ?? 0,
      lastId: result.changes?.lastId,
    };
  }

  async query<T = Record<string, unknown>>(statement: string, values: unknown[]): Promise<T[]> {
    const result = await this.db.query(statement, values);
    return (result.values ?? []) as T[];
  }

  async executeSet(statements: SqliteStatement[]): Promise<void> {
    if (statements.length === 0) {
      return;
    }

    await this.db.executeSet(
      statements.map((entry) => ({ statement: entry.statement, values: entry.values })),
      false
    );
  }

  async beginTransaction(): Promise<void> {
    await this.db.beginTransaction();
  }

  async commitTransaction(): Promise<void> {
    await this.db.commitTransaction();
  }

  async rollbackTransaction(): Promise<void> {
    await this.db.rollbackTransaction();
  }

  async close(): Promise<void> {
    await this.sqlite.closeConnection(this.dbName, false);
  }
}

/**
 * Opens (and migrates) the native SQLite database via the Capacitor plugin.
 * Only call on native platforms.
 */
export async function openCapacitorSqliteConnection(): Promise<SqliteConnection> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);

  await sqlite.addUpgradeStatement(SQLITE_DB_NAME, SQLITE_UPGRADE_STATEMENTS);

  const consistency = await sqlite.checkConnectionsConsistency();
  const isConnected = (await sqlite.isConnection(SQLITE_DB_NAME, false)).result ?? false;

  const db =
    consistency.result && isConnected
      ? await sqlite.retrieveConnection(SQLITE_DB_NAME, false)
      : await sqlite.createConnection(
          SQLITE_DB_NAME,
          false,
          'no-encryption',
          SQLITE_SCHEMA_VERSION,
          false
        );

  await db.open();

  return new CapacitorSqliteConnection(sqlite, db, SQLITE_DB_NAME);
}
