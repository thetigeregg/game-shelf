import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { AppDb } from '../data/app-db';
import { GameSyncService } from './game-sync.service';
import { SyncEventsService } from './sync-events.service';
import { PlatformOrderService } from './platform-order.service';
import { PlatformCustomizationService } from './platform-customization.service';
import { SyncChangeEvent } from '../models/game.models';

describe('GameSyncService', () => {
  let db: AppDb;
  let service: GameSyncService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AppDb,
        GameSyncService,
        SyncEventsService,
        PlatformOrderService,
        PlatformCustomizationService
      ]
    });

    db = TestBed.inject(AppDb);
    service = TestBed.inject(GameSyncService);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('normalizes pulled game notes line endings to LF', async () => {
    const change: SyncChangeEvent = {
      eventId: '1',
      entityType: 'game',
      operation: 'upsert',
      payload: {
        igdbGameId: '123',
        platformIgdbId: 130,
        title: 'Game',
        platform: 'Switch',
        listType: 'collection',
        notes: 'Line 1\r\nLine 2',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    };

    await (service as any).applyGameChange(change);

    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.notes).toBe('Line 1\nLine 2');
  });

  it('normalizes empty pulled notes to null', async () => {
    const change: SyncChangeEvent = {
      eventId: '1',
      entityType: 'game',
      operation: 'upsert',
      payload: {
        igdbGameId: '123',
        platformIgdbId: 130,
        title: 'Game',
        platform: 'Switch',
        listType: 'collection',
        notes: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    };

    await (service as any).applyGameChange(change);

    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.notes).toBeNull();
  });
});
