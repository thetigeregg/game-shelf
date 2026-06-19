import { Injectable, inject } from '@angular/core';
import { DexieStorageEngine } from './dexie-storage-engine';
import { StorageMigrationService } from './storage-migration.service';
import { DebugLogService } from '../services/debug-log.service';
import { isNativePlatform } from '../utils/native-platform.util';
import type { SqliteConnection } from './sqlite-connection';
import { StorageEngine } from './storage-engine';

/**
 * Selects and initializes the storage engine during app bootstrap:
 * native platforms get SQLite (with a one-time IndexedDB migration), web
 * keeps Dexie/IndexedDB. If the SQLite database cannot be opened or migrated,
 * the session falls back to the Dexie engine and retries on next launch.
 *
 * initialize() must complete (via provideAppInitializer) before STORAGE_ENGINE
 * is injected anywhere.
 */
@Injectable({ providedIn: 'root' })
export class StorageEngineFactory {
  private readonly dexieEngine = inject(DexieStorageEngine);
  private readonly migrationService = inject(StorageMigrationService);
  private readonly debugLogService = inject(DebugLogService);
  private engine: StorageEngine | null = null;

  async initialize(): Promise<void> {
    if (this.engine) {
      return;
    }

    const native = isNativePlatform();
    this.debugLogService.trace('storage.engine.initializing', { native });

    if (!native) {
      this.debugLogService.trace('storage.engine.using_dexie');
      await this.dexieEngine.initialize();
      this.engine = this.dexieEngine;
      return;
    }

    let connection: SqliteConnection | null = null;

    try {
      this.debugLogService.trace('storage.engine.loading_sqlite_modules');
      const [{ openCapacitorSqliteConnection }, { SqliteStorageEngine }] = await Promise.all([
        import('./sqlite-connection'),
        import('./sqlite-storage-engine'),
      ]);
      this.debugLogService.trace('storage.engine.sqlite_modules_loaded');

      this.debugLogService.trace('storage.engine.opening_sqlite_connection');
      connection = await openCapacitorSqliteConnection(this.debugLogService);

      const sqliteEngine = new SqliteStorageEngine(connection, this.debugLogService);

      this.debugLogService.trace('storage.engine.initializing_sqlite_engine');
      await sqliteEngine.initialize();

      this.debugLogService.trace('storage.engine.running_migration_check');
      await this.migrationService.migrateIfNeeded(sqliteEngine);

      this.engine = sqliteEngine;
      this.debugLogService.info('storage.engine.sqlite_active');
    } catch (error: unknown) {
      if (connection) {
        try {
          await connection.close();
        } catch {
          // Best-effort cleanup before Dexie fallback.
        }
      }

      this.debugLogService.error('storage.engine.sqlite_unavailable_falling_back_to_dexie', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.debugLogService.trace('storage.engine.initializing_dexie_fallback');
      await this.dexieEngine.initialize();
      this.engine = this.dexieEngine;
    }
  }

  getEngine(): StorageEngine {
    if (!this.engine) {
      throw new Error('StorageEngineFactory.initialize() must complete before engine use.');
    }

    return this.engine;
  }
}
