import { Injectable, inject } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { AppDb } from './app-db';
import { DebugLogService } from '../services/debug-log.service';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import { SQLITE_MIGRATION_KEY } from '../storage/preference-keys';
import { StorageEngine } from './storage-engine';

const MIGRATION_BATCH_SIZE = 500;

/**
 * One-time copy of native IndexedDB data (games, tags, views, outbox,
 * syncMeta) into the SQLite engine when a native install upgrades to the
 * SQLite storage backend. Image cache blobs are intentionally not migrated;
 * the cache repopulates on demand.
 *
 * On success the migration flag is set and the Dexie database is deleted.
 * On failure the flag stays unset and the error propagates so the caller can
 * fall back to the Dexie engine for the session and retry on next launch.
 */
@Injectable({ providedIn: 'root' })
export class StorageMigrationService {
  private readonly db = inject(AppDb);
  private readonly preferenceStorage = inject(PreferenceStorageService);
  private readonly debugLogService = inject(DebugLogService);

  async migrateIfNeeded(target: StorageEngine): Promise<void> {
    if (this.preferenceStorage.getItem(SQLITE_MIGRATION_KEY) === '1') {
      return;
    }

    const dexieDbExists = await Dexie.exists(this.db.name);

    if (!dexieDbExists) {
      this.preferenceStorage.setItem(SQLITE_MIGRATION_KEY, '1');
      this.debugLogService.info('storage.sqlite_migration.fresh_install');
      return;
    }

    const startedAt = Date.now();
    const counts = { games: 0, tags: 0, views: 0, outbox: 0, syncMeta: 0 };

    await target.runInTransaction(['games', 'tags', 'views', 'outbox', 'syncMeta'], async () => {
      for await (const batch of this.iterateTableBatches(this.db.games, MIGRATION_BATCH_SIZE)) {
        await target.bulkPutGames(batch);
        counts.games += batch.length;
      }

      for await (const batch of this.iterateTableBatches(this.db.tags, MIGRATION_BATCH_SIZE)) {
        await target.bulkPutTags(batch);
        counts.tags += batch.length;
      }

      for await (const batch of this.iterateTableBatches(this.db.views, MIGRATION_BATCH_SIZE)) {
        await target.bulkPutViews(batch);
        counts.views += batch.length;
      }

      for await (const batch of this.iterateTableBatches(this.db.outbox, MIGRATION_BATCH_SIZE)) {
        await target.bulkPutOutbox(batch);
        counts.outbox += batch.length;
      }

      for await (const batch of this.iterateTableBatches(this.db.syncMeta, MIGRATION_BATCH_SIZE)) {
        for (const entry of batch) {
          await target.putSyncMeta(entry);
        }
        counts.syncMeta += batch.length;
      }
    });

    this.preferenceStorage.setItem(SQLITE_MIGRATION_KEY, '1');
    this.debugLogService.info('storage.sqlite_migration.completed', {
      ...counts,
      durationMs: Date.now() - startedAt,
    });

    try {
      await this.db.delete();
    } catch {
      // The copy already succeeded; a failed Dexie cleanup is non-fatal and
      // will not rerun the migration because the flag is set.
      this.debugLogService.warn('storage.sqlite_migration.dexie_cleanup_failed');
    }
  }

  private async *iterateTableBatches<T>(table: Table<T>, batchSize: number): AsyncGenerator<T[]> {
    let offset = 0;
    let batch = await table.offset(offset).limit(batchSize).toArray();

    while (batch.length > 0) {
      yield batch;
      offset += batch.length;
      batch = await table.offset(offset).limit(batchSize).toArray();
    }
  }
}
