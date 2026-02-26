import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { AppDb } from '../data/app-db';
import { GameSyncService } from './game-sync.service';
import { SyncEventsService } from './sync-events.service';
import { PLATFORM_ORDER_STORAGE_KEY, PlatformOrderService } from './platform-order.service';
import {
  PLATFORM_DISPLAY_NAMES_STORAGE_KEY,
  PlatformCustomizationService
} from './platform-customization.service';
import { SyncChangeEvent } from '../models/game.models';

describe('GameSyncService', () => {
  let db: AppDb;
  let service: GameSyncService;
  let platformOrderService: PlatformOrderService;
  let platformCustomizationService: PlatformCustomizationService;

  function createBaseGame(
    overrides: Partial<Record<string, unknown>> = {}
  ): Record<string, unknown> {
    return {
      igdbGameId: '123',
      platformIgdbId: 130,
      title: 'Game',
      platform: 'Switch',
      listType: 'collection',
      coverSource: 'igdb',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides
    };
  }

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
    platformOrderService = TestBed.inject(PlatformOrderService);
    platformCustomizationService = TestBed.inject(PlatformCustomizationService);
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

  it('normalizes pulled placeholder notes to null', async () => {
    const change: SyncChangeEvent = {
      eventId: '1',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({ notes: '  <p><br></p>  ' }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    };

    await (service as any).applyGameChange(change);
    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.notes).toBeNull();
  });

  it('normalizes pulled repeated empty paragraph placeholders to null', async () => {
    const change: SyncChangeEvent = {
      eventId: '1',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({ notes: '<p></p><p></p>' }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    };

    await (service as any).applyGameChange(change);
    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.notes).toBeNull();
  });

  it('sanitizes pulled notes HTML and preserves meaningful whitespace', async () => {
    const change: SyncChangeEvent = {
      eventId: '1',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({ notes: '  hello<script>alert(1)</script>  ' }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    };

    await (service as any).applyGameChange(change);
    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.notes).toBe('  hello  ');
  });

  it('applies game delete changes for existing records and ignores invalid identity', async () => {
    await db.games.put({
      igdbGameId: '123',
      platformIgdbId: 130,
      title: 'Stored',
      coverUrl: null,
      coverSource: 'igdb',
      platform: 'Switch',
      releaseDate: null,
      releaseYear: null,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });

    await (service as any).applyGameChange({
      eventId: '2',
      entityType: 'game',
      operation: 'delete',
      payload: { igdbGameId: '123', platformIgdbId: 130 },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const removed = await db.games
      .where('[igdbGameId+platformIgdbId]')
      .equals(['123', 130])
      .first();
    expect(removed).toBeUndefined();

    await db.games.put({
      igdbGameId: '123',
      platformIgdbId: 130,
      title: 'Stored',
      coverUrl: null,
      coverSource: 'igdb',
      platform: 'Switch',
      releaseDate: null,
      releaseYear: null,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });

    await (service as any).applyGameChange({
      eventId: '3',
      entityType: 'game',
      operation: 'delete',
      payload: { igdbGameId: '123', platformIgdbId: 'invalid' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const stillThere = await db.games
      .where('[igdbGameId+platformIgdbId]')
      .equals(['123', 130])
      .first();
    expect(stillThere).toBeDefined();
  });

  it('normalizes game upsert fallbacks for title/platform/list type/cover source and tag ids', async () => {
    await (service as any).applyGameChange({
      eventId: '4',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({
        igdbGameId: '  777  ',
        platformIgdbId: '130',
        title: '  ',
        platform: '',
        listType: 'invalid',
        coverSource: 'invalid',
        tagIds: [1, 1, 2, -3, 'bad']
      }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['777', 130]).first();
    expect(stored?.title).toBe('Unknown title');
    expect(stored?.platform).toBe('Unknown platform');
    expect(stored?.listType).toBe('collection');
    expect(stored?.coverSource).toBe('none');
    expect(stored?.tagIds).toEqual([1, 2]);
  });

  it('normalizes custom metadata in game upserts', async () => {
    await (service as any).applyGameChange({
      eventId: '5',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({
        customTitle: '  Custom Game  ',
        customPlatform: '  Custom Switch  ',
        customPlatformIgdbId: 999,
        customCoverUrl: '  data:image/png;base64,AAA  '
      }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.customTitle).toBe('Custom Game');
    expect(stored?.customPlatform).toBe('Custom Switch');
    expect(stored?.customPlatformIgdbId).toBe(999);
    expect(stored?.customCoverUrl).toBe('data:image/png;base64,AAA');
  });

  it('drops custom metadata when equivalent to defaults or invalid', async () => {
    await (service as any).applyGameChange({
      eventId: '6',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({
        title: 'Game',
        platform: 'Switch',
        customTitle: 'Game',
        customPlatform: 'Switch',
        customPlatformIgdbId: 130,
        customCoverUrl: 'https://not-allowed.example'
      }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.customTitle).toBeNull();
    expect(stored?.customPlatform).toBeNull();
    expect(stored?.customPlatformIgdbId).toBeNull();
    expect(stored?.customCoverUrl).toBeNull();
  });

  it('applies tag delete and updates games containing deleted tag', async () => {
    await db.tags.put({
      id: 7,
      name: 'ToDelete',
      color: '#123456',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
    await db.games.put({
      igdbGameId: '123',
      platformIgdbId: 130,
      title: 'Stored',
      coverUrl: null,
      coverSource: 'igdb',
      platform: 'Switch',
      releaseDate: null,
      releaseYear: null,
      listType: 'collection',
      tagIds: [7, 8],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });

    await (service as any).applyTagChange({
      eventId: '7',
      entityType: 'tag',
      operation: 'delete',
      payload: { id: 7 },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const deletedTag = await db.tags.get(7);
    expect(deletedTag).toBeUndefined();
    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.tagIds).toEqual([8]);
  });

  it('normalizes tag upsert defaults', async () => {
    await (service as any).applyTagChange({
      eventId: '8',
      entityType: 'tag',
      operation: 'upsert',
      payload: { id: 5, name: '  ', color: '  ' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const stored = await db.tags.get(5);
    expect(stored?.name).toBe('Tag 5');
    expect(stored?.color).toBe('#3880ff');
  });

  it('normalizes view upsert defaults and supports delete', async () => {
    await (service as any).applyViewChange({
      eventId: '9',
      entityType: 'view',
      operation: 'upsert',
      payload: { id: 11, name: '  ', listType: 'bad', filters: null, groupBy: null },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const stored = await db.views.get(11);
    expect(stored?.name).toBe('Saved View');
    expect(stored?.listType).toBe('collection');
    expect(stored?.groupBy).toBe('none');
    expect(stored?.filters.sortField).toBe('title');

    await (service as any).applyViewChange({
      eventId: '10',
      entityType: 'view',
      operation: 'delete',
      payload: { id: 11 },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);
    const removed = await db.views.get(11);
    expect(removed).toBeUndefined();
  });

  it('applies setting upsert/delete and refreshes dependent services', async () => {
    const orderRefreshSpy = vi.spyOn(platformOrderService, 'refreshFromStorage');
    const displayRefreshSpy = vi.spyOn(platformCustomizationService, 'refreshFromStorage');

    await (service as any).applySettingChange({
      eventId: '11',
      entityType: 'setting',
      operation: 'upsert',
      payload: { key: PLATFORM_ORDER_STORAGE_KEY, value: '["130"]' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);
    expect(localStorage.getItem(PLATFORM_ORDER_STORAGE_KEY)).toBe('["130"]');
    expect(orderRefreshSpy).toHaveBeenCalled();

    await (service as any).applySettingChange({
      eventId: '12',
      entityType: 'setting',
      operation: 'upsert',
      payload: { key: PLATFORM_DISPLAY_NAMES_STORAGE_KEY, value: '{"130":"Switch"}' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);
    expect(localStorage.getItem(PLATFORM_DISPLAY_NAMES_STORAGE_KEY)).toBe('{"130":"Switch"}');
    expect(displayRefreshSpy).toHaveBeenCalled();

    await (service as any).applySettingChange({
      eventId: '13',
      entityType: 'setting',
      operation: 'delete',
      payload: { key: PLATFORM_ORDER_STORAGE_KEY },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);
    expect(localStorage.getItem(PLATFORM_ORDER_STORAGE_KEY)).toBeNull();
  });

  it('builds operation batches under byte budget', () => {
    const operations = [
      {
        opId: '1',
        entityType: 'game',
        operation: 'upsert',
        payload: { a: 'x'.repeat(60) },
        clientTimestamp: '2026-01-01T00:00:00.000Z'
      },
      {
        opId: '2',
        entityType: 'game',
        operation: 'upsert',
        payload: { a: 'y'.repeat(60) },
        clientTimestamp: '2026-01-01T00:00:00.000Z'
      }
    ];

    const batches = (service as any).buildPushOperationBatches(operations, 140);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat().map((entry: { opId: string }) => entry.opId)).toEqual(['1', '2']);
  });

  it('normalizes helper values for ids/base url and notes', () => {
    expect((service as any).normalizeOptionalPlatformIgdbId('abc')).toBeNull();
    expect((service as any).normalizeOptionalPlatformIgdbId('130')).toBe(130);
    expect((service as any).normalizeBaseUrl('https://api.example.com///')).toBe(
      'https://api.example.com'
    );
    expect((service as any).normalizeNotes('   ')).toBeNull();
    expect((service as any).normalizeNotes('\r\nLine 1\r\n')).toBe('\nLine 1\n');
  });

  it('normalizes custom title/platform helper branches', () => {
    expect((service as any).normalizeCustomTitle(' Game ', 'Game')).toBeNull();
    expect((service as any).normalizeCustomTitle(' Custom ', 'Game')).toBe('Custom');

    expect((service as any).normalizeCustomPlatform(' Switch ', 130, 'Switch')).toBeNull();
    expect((service as any).normalizeCustomPlatform('', 130, 'Switch')).toBeNull();
    expect((service as any).normalizeCustomPlatform(' Custom ', 130, 'Switch')).toBe('Custom');

    expect((service as any).normalizeCustomPlatformIgdbId(130, 'Switch', 130, 'Switch')).toBeNull();
    expect(
      (service as any).normalizeCustomPlatformIgdbId(null, 'Custom', 130, 'Switch')
    ).toBeNull();
    expect((service as any).normalizeCustomPlatformIgdbId(999, 'Custom', 130, 'Switch')).toBe(999);
  });

  it('ignores invalid game upsert identity payloads', async () => {
    await (service as any).applyGameChange({
      eventId: '14',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({ igdbGameId: '', platformIgdbId: 130 }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);
    await (service as any).applyGameChange({
      eventId: '15',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({ igdbGameId: 'abc', platformIgdbId: 0 }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const games = await db.games.toArray();
    expect(games.length).toBe(0);
  });

  it('ignores invalid tag delete/upsert payloads', async () => {
    await (service as any).applyTagChange({
      eventId: '16',
      entityType: 'tag',
      operation: 'delete',
      payload: { id: 'bad' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    await (service as any).applyTagChange({
      eventId: '17',
      entityType: 'tag',
      operation: 'upsert',
      payload: { id: 0, name: 'ignored' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const tags = await db.tags.toArray();
    expect(tags.length).toBe(0);
  });

  it('handles invalid view delete payloads and wishlist upserts', async () => {
    await (service as any).applyViewChange({
      eventId: '18',
      entityType: 'view',
      operation: 'delete',
      payload: { id: 'bad' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    await (service as any).applyViewChange({
      eventId: '19',
      entityType: 'view',
      operation: 'upsert',
      payload: { id: 22, name: 'Wish', listType: 'wishlist' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const view = await db.views.get(22);
    expect(view?.listType).toBe('wishlist');
  });

  it('ignores setting changes with empty keys', async () => {
    await (service as any).applySettingChange({
      eventId: '20',
      entityType: 'setting',
      operation: 'upsert',
      payload: { key: '   ', value: 'x' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);
    await (service as any).applySettingChange({
      eventId: '21',
      entityType: 'setting',
      operation: 'delete',
      payload: { key: '   ' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    expect(localStorage.getItem('')).toBeNull();
  });

  it('covers online detection branch and operation id fallback path', () => {
    const cryptoSpy = vi.spyOn(globalThis, 'crypto', 'get').mockReturnValue({} as Crypto);
    const navigatorSpy = vi.spyOn(globalThis, 'navigator', 'get').mockReturnValue({
      onLine: false
    } as Navigator);

    expect((service as any).isOnline()).toBe(false);
    expect((service as any).generateOperationId()).toMatch(/^\d+-[a-z0-9]+$/);

    navigatorSpy.mockRestore();
    cryptoSpy.mockRestore();
  });

  it('pushOutbox acks applied operations, records failures, and updates cursor', async () => {
    const now = '2026-01-01T00:00:00.000Z';
    await db.outbox.bulkPut([
      {
        opId: 'op-a',
        entityType: 'game',
        operation: 'upsert',
        payload: { igdbGameId: '1' },
        clientTimestamp: now,
        createdAt: now,
        attemptCount: 0,
        lastError: null
      },
      {
        opId: 'op-b',
        entityType: 'game',
        operation: 'upsert',
        payload: { igdbGameId: '2' },
        clientTimestamp: now,
        createdAt: now,
        attemptCount: 0,
        lastError: null
      }
    ]);

    vi.spyOn((service as any).httpClient, 'post').mockReturnValue(
      of({
        cursor: 'cursor-1',
        results: [
          { opId: 'op-a', status: 'applied' },
          { opId: 'op-b', status: 'failed', message: 'boom' }
        ]
      })
    );

    await (service as any).pushOutbox();

    const opA = await db.outbox.get('op-a');
    const opB = await db.outbox.get('op-b');
    const cursor = await db.syncMeta.get('cursor');

    expect(opA).toBeUndefined();
    expect(opB?.attemptCount).toBe(1);
    expect(opB?.lastError).toBe('boom');
    expect(cursor?.value).toBe('cursor-1');
  });

  it('pullChanges updates cursor when response has no changes', async () => {
    vi.spyOn((service as any).httpClient, 'post').mockReturnValue(
      of({
        cursor: 'next-cursor',
        changes: []
      })
    );

    await (service as any).pullChanges();

    const cursor = await db.syncMeta.get('cursor');
    expect(cursor?.value).toBe('next-cursor');
  });

  it('pullChanges applies changes, emits event, and falls back cursor to last event id', async () => {
    const emitChangedSpy = vi.spyOn((service as any).syncEvents, 'emitChanged');
    vi.spyOn((service as any).httpClient, 'post').mockReturnValue(
      of({
        cursor: '',
        changes: [
          {
            eventId: '42',
            entityType: 'setting',
            operation: 'upsert',
            payload: { key: 'test-setting', value: 'on' },
            serverTimestamp: '2026-01-01T00:00:00.000Z'
          }
        ]
      })
    );

    await (service as any).pullChanges();

    const cursor = await db.syncMeta.get('cursor');
    expect(cursor?.value).toBe('42');
    expect(localStorage.getItem('test-setting')).toBe('on');
    expect(emitChangedSpy).toHaveBeenCalled();
  });

  it('syncNow marks connectivity degraded when push fails', async () => {
    vi.spyOn(service as any, 'pushOutbox').mockRejectedValue(new Error('push failed'));
    vi.spyOn(service as any, 'pullChanges').mockResolvedValue(undefined);

    await service.syncNow();

    const connectivity = await db.syncMeta.get('connectivity');
    expect(connectivity?.value).toBe('degraded');
  });
});
