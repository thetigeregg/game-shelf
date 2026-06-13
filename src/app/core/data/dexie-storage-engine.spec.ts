import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { AppDb } from './app-db';
import { DexieStorageEngine } from './dexie-storage-engine';
import { describeStorageEngineContract } from './storage-engine.contract';

describeStorageEngineContract('DexieStorageEngine', () => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [AppDb, DexieStorageEngine],
  });

  const db = TestBed.inject(AppDb);
  const engine = TestBed.inject(DexieStorageEngine);

  return Promise.resolve({
    engine,
    cleanup: async () => {
      await db.delete();
    },
  });
});
