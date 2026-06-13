import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AppDb } from './app-db';
import { DexieStorageEngine } from './dexie-storage-engine';
import { describeStorageEngineContract } from './storage-engine.contract';

vi.mock('./storage-transaction-context', () => import('./storage-transaction-context.node'));

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
