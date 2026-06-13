import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import Dexie from 'dexie';
import { beforeEach, afterEach, describe, expect, it, vi, Mock } from 'vitest';
import { AppDb } from './app-db';
import { DexieStorageEngine } from './dexie-storage-engine';
import { StorageMigrationService } from './storage-migration.service';
import { StorageEngine } from './storage-engine';
import { SQLITE_MIGRATION_KEY } from '../storage/preference-keys';
import {
  makeContractGame,
  makeContractOutboxEntry,
  makeContractSyncMeta,
  makeContractTag,
  makeContractView,
} from './storage-engine.contract';

interface MigrationTarget {
  bulkPutGames: Mock;
  bulkPutTags: Mock;
  bulkPutViews: Mock;
  bulkPutOutbox: Mock;
  putSyncMeta: Mock;
  runInTransaction: Mock;
}

function makeTarget(): MigrationTarget {
  return {
    bulkPutGames: vi.fn().mockResolvedValue(undefined),
    bulkPutTags: vi.fn().mockResolvedValue(undefined),
    bulkPutViews: vi.fn().mockResolvedValue(undefined),
    bulkPutOutbox: vi.fn().mockResolvedValue(undefined),
    putSyncMeta: vi.fn().mockResolvedValue(undefined),
    runInTransaction: vi.fn((_scope: readonly unknown[], action: () => Promise<unknown>) =>
      action()
    ),
  };
}

function asEngine(target: MigrationTarget): StorageEngine {
  return target as unknown as StorageEngine;
}

describe('StorageMigrationService', () => {
  let db: AppDb;
  let dexieEngine: DexieStorageEngine;
  let service: StorageMigrationService;

  beforeEach(async () => {
    window.localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [AppDb, DexieStorageEngine, StorageMigrationService],
    });
    db = TestBed.inject(AppDb);
    dexieEngine = TestBed.inject(DexieStorageEngine);
    service = TestBed.inject(StorageMigrationService);
    await Dexie.delete(db.name);
  });

  afterEach(async () => {
    await Dexie.delete(db.name);
    window.localStorage.clear();
  });

  it('marks fresh installs as migrated without copying anything', async () => {
    const target = makeTarget();

    await service.migrateIfNeeded(asEngine(target));

    expect(window.localStorage.getItem(SQLITE_MIGRATION_KEY)).toBe('1');
    expect(target.bulkPutGames).not.toHaveBeenCalled();
    expect(target.bulkPutTags).not.toHaveBeenCalled();
    expect(target.putSyncMeta).not.toHaveBeenCalled();
  });

  it('skips entirely when the migration flag is already set', async () => {
    await dexieEngine.addGame(makeContractGame());
    window.localStorage.setItem(SQLITE_MIGRATION_KEY, '1');
    const target = makeTarget();

    await service.migrateIfNeeded(asEngine(target));

    expect(target.bulkPutGames).not.toHaveBeenCalled();
    expect(await Dexie.exists(db.name)).toBe(true);
  });

  it('copies all stores into the target, sets the flag, and deletes the Dexie database', async () => {
    const gameId = await dexieEngine.addGame(makeContractGame({ title: 'Migrated Game' }));
    await dexieEngine.addTag(makeContractTag({ name: 'Migrated Tag' }));
    await dexieEngine.addView(makeContractView({ name: 'Migrated View' }));
    await dexieEngine.putOutboxEntry(makeContractOutboxEntry({ opId: 'op-migrate' }));
    await dexieEngine.putSyncMeta(makeContractSyncMeta({ key: 'cursor', value: '42' }));
    const target = makeTarget();

    await service.migrateIfNeeded(asEngine(target));

    expect(target.runInTransaction).toHaveBeenCalledWith(
      ['games', 'tags', 'views', 'outbox', 'syncMeta'],
      expect.any(Function)
    );
    expect(target.bulkPutGames).toHaveBeenCalledTimes(1);
    const migratedGames = target.bulkPutGames.mock.calls[0][0] as Array<{
      id?: number;
      title: string;
    }>;
    expect(migratedGames).toHaveLength(1);
    expect(migratedGames[0].id).toBe(gameId);
    expect(migratedGames[0].title).toBe('Migrated Game');

    expect(target.bulkPutTags.mock.calls[0][0]).toHaveLength(1);
    expect(target.bulkPutViews.mock.calls[0][0]).toHaveLength(1);
    expect(target.bulkPutOutbox.mock.calls[0][0]).toHaveLength(1);
    expect(target.putSyncMeta).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'cursor', value: '42' })
    );

    expect(window.localStorage.getItem(SQLITE_MIGRATION_KEY)).toBe('1');
    expect(await Dexie.exists(db.name)).toBe(false);
  });

  it('leaves the flag unset and the Dexie database intact when the copy fails', async () => {
    await dexieEngine.addGame(makeContractGame());
    const target = makeTarget();
    target.bulkPutGames.mockRejectedValue(new Error('sqlite write failed'));

    await expect(service.migrateIfNeeded(asEngine(target))).rejects.toThrow('sqlite write failed');

    expect(window.localStorage.getItem(SQLITE_MIGRATION_KEY)).toBeNull();
    expect(await Dexie.exists(db.name)).toBe(true);
  });
});
