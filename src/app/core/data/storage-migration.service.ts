import { Injectable, inject } from '@angular/core';
import Dexie from 'dexie';
import { AppDb } from './app-db';
import { DexieStorageEngine } from './dexie-storage-engine';
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
  private readonly dexieEngine = inject(DexieStorageEngine);
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
    const [games, tags, views, outbox, syncMeta] = await Promise.all([
      this.dexieEngine.listAllGames(),
      this.dexieEngine.listTagsSortedByName(),
      this.dexieEngine.listAllViews(),
      this.dexieEngine.listOutboxOrderedByCreatedAt(),
      this.dexieEngine.listAllSyncMeta(),
    ]);

    for (let index = 0; index < games.length; index += MIGRATION_BATCH_SIZE) {
      await target.bulkPutGames(games.slice(index, index + MIGRATION_BATCH_SIZE));
    }

    await target.bulkPutTags(tags);
    await target.bulkPutViews(views);
    await target.bulkPutOutbox(outbox);

    for (const entry of syncMeta) {
      await target.putSyncMeta(entry);
    }

    this.preferenceStorage.setItem(SQLITE_MIGRATION_KEY, '1');
    this.debugLogService.info('storage.sqlite_migration.completed', {
      games: games.length,
      tags: tags.length,
      views: views.length,
      outbox: outbox.length,
      syncMeta: syncMeta.length,
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
}
