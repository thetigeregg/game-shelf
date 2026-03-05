import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Observable, of } from 'rxjs';
import { AppDb } from '../data/app-db';
import { GameSyncService } from './game-sync.service';
import { SyncEventsService } from './sync-events.service';
import { PLATFORM_ORDER_STORAGE_KEY, PlatformOrderService } from './platform-order.service';
import {
  PLATFORM_DISPLAY_NAMES_STORAGE_KEY,
  PlatformCustomizationService
} from './platform-customization.service';
import { OutboxRecord, SyncChangeEvent } from '../models/game.models';

type GameSyncServicePrivate = {
  applyPulledChanges(changes: SyncChangeEvent[]): Promise<void>;
  applyGameChange(change: SyncChangeEvent): Promise<void>;
  applyTagChange(change: SyncChangeEvent): Promise<void>;
  applyViewChange(change: SyncChangeEvent): Promise<void>;
  applySettingChange(change: SyncChangeEvent): Promise<void>;
  buildPushOperationBatches(operations: OutboxRecord[], maxBatchBytes: number): OutboxRecord[][];
  normalizeOptionalPlatformIgdbId(value: unknown): number | null;
  normalizeBaseUrl(value: string): string;
  normalizeNotes(value: unknown): string | null;
  normalizeCustomTitle(custom: unknown, title: string): string | null;
  normalizeCustomPlatform(
    custom: unknown,
    customPlatformIgdbId: number | null,
    platform: string
  ): string | null;
  normalizeCustomPlatformIgdbId(
    customPlatformIgdbId: number | null,
    customPlatform: string | null,
    platformIgdbId: number,
    platform: string
  ): number | null;
  isOnline(): boolean;
  generateOperationId(): string;
  pushOutbox(): Promise<void>;
  pullChanges(): Promise<void>;
  syncInFlight: boolean;
  initialized: boolean;
  baseUrl: string;
  httpClient: {
    post: (url: string, body: unknown) => Observable<unknown>;
  };
  syncEvents: {
    emitChanged: () => void;
  };
};

describe('GameSyncService', () => {
  let db: AppDb;
  let service: GameSyncService;
  let servicePrivate: GameSyncServicePrivate;
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
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AppDb,
        GameSyncService,
        SyncEventsService,
        PlatformOrderService,
        PlatformCustomizationService
      ]
    });

    db = TestBed.inject(AppDb);
    service = TestBed.inject(GameSyncService);
    servicePrivate = service as unknown as GameSyncServicePrivate;
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

    await servicePrivate.applyGameChange(change);

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

    await servicePrivate.applyGameChange(change);

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

    await servicePrivate.applyGameChange(change);
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

    await servicePrivate.applyGameChange(change);
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

    await servicePrivate.applyGameChange(change);
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

    await servicePrivate.applyGameChange({
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

    await servicePrivate.applyGameChange({
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
    await servicePrivate.applyGameChange({
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

  it('ignores pulled discovery game upserts', async () => {
    await servicePrivate.applyGameChange({
      eventId: '4-discovery',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({
        igdbGameId: '194558',
        platformIgdbId: 6,
        listType: 'discovery',
        discoverySource: 'recent'
      }),
      serverTimestamp: '2026-03-05T14:15:00.000Z'
    } as SyncChangeEvent);

    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['194558', 6]).first();
    expect(stored).toBeUndefined();
  });

  it('falls back to local auto id when pulled id collides with an unrelated local row', async () => {
    await db.games.put({
      id: 218,
      igdbGameId: '999',
      platformIgdbId: 48,
      title: 'Existing Local',
      coverUrl: null,
      coverSource: 'igdb',
      platform: 'PlayStation 4',
      releaseDate: null,
      releaseYear: null,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });

    await servicePrivate.applyGameChange({
      eventId: '4c-id-collision',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({
        id: 218,
        igdbGameId: '1234',
        platformIgdbId: 130,
        title: 'Pulled Game'
      }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const localRow = await db.games
      .where('[igdbGameId+platformIgdbId]')
      .equals(['999', 48])
      .first();
    const pulledRow = await db.games
      .where('[igdbGameId+platformIgdbId]')
      .equals(['1234', 130])
      .first();

    expect(localRow?.id).toBe(218);
    expect(localRow?.title).toBe('Existing Local');
    expect(pulledRow).toBeDefined();
    expect(pulledRow?.title).toBe('Pulled Game');
    expect(pulledRow?.id).not.toBe(218);
  });

  it('strict-normalizes pulled metacritic/hltb and list metadata fields', async () => {
    await servicePrivate.applyGameChange({
      eventId: '4b',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({
        hltbMainHours: -4,
        hltbMainExtraHours: 21.234,
        hltbCompletionistHours: 'not-a-number',
        metacriticScore: 777,
        metacriticUrl: 'https://www.metacritic.com/game/example/',
        collections: [' Series A ', 'Series A', '', 3],
        genres: [' Action ', 'Action', ''],
        themes: [' Fantasy ', 'Fantasy', ''],
        themeIds: [1, 1, '2', '2.5', '10x', 'x'],
        keywords: [' Zelda ', 'Zelda', ''],
        keywordIds: [10, 10, '11', '11.8', '20x', 'x'],
        similarGameIgdbIds: ['123', '123', 'bad', 456],
        releaseYear: 1700,
        releaseDate: '',
        rating: '6',
        status: 'invalid',
        gameType: 'invalid',
        coverUrl: 'not-a-url',
        createdAt: 'not-a-date'
      }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.hltbMainHours).toBeNull();
    expect(stored?.hltbMainExtraHours).toBe(21.2);
    expect(stored?.hltbCompletionistHours).toBeNull();
    expect(stored?.metacriticScore).toBeNull();
    expect(stored?.metacriticUrl).toBe('https://www.metacritic.com/game/example/');
    expect(stored?.collections).toEqual(['Series A']);
    expect(stored?.genres).toEqual(['Action']);
    expect(stored?.themes).toEqual(['Fantasy']);
    expect(stored?.themeIds).toEqual([1, 2]);
    expect(stored?.keywords).toEqual(['Zelda']);
    expect(stored?.keywordIds).toEqual([10, 11]);
    expect(stored?.similarGameIgdbIds).toEqual(['123', '456']);
    expect(stored?.releaseYear).toBeNull();
    expect(stored?.releaseDate).toBeNull();
    expect(stored?.rating).toBeNull();
    expect(stored?.status).toBeNull();
    expect(stored?.gameType).toBeNull();
    expect(stored?.coverUrl).toBeNull();
    expect(stored?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('preserves existing enriched arrays when a pulled upsert omits them', async () => {
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
      themes: ['Action'],
      themeIds: [1],
      keywords: ['aliens'],
      keywordIds: [10],
      screenshots: [
        {
          id: 5673,
          imageId: 'hjnzngnrtwr82jzmmkef',
          url: 'https://images.igdb.com/igdb/image/upload/t_screenshot_huge/hjnzngnrtwr82jzmmkef.jpg',
          width: 1280,
          height: 720
        }
      ],
      videos: [
        {
          id: 3164,
          name: 'Next-gen Launch Trailer',
          videoId: 'PIF_fqFZEuk',
          url: 'https://www.youtube.com/watch?v=PIF_fqFZEuk'
        }
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });

    await servicePrivate.applyGameChange({
      eventId: '4c-preserve-enrichment-arrays',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({
        title: 'Updated Title'
      }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.title).toBe('Updated Title');
    expect(stored?.themes).toEqual(['Action']);
    expect(stored?.themeIds).toEqual([1]);
    expect(stored?.keywords).toEqual(['aliens']);
    expect(stored?.keywordIds).toEqual([10]);
    expect(stored?.screenshots).toHaveLength(1);
    expect(stored?.videos).toHaveLength(1);
  });

  it('normalizes and replaces media arrays when pulled upsert includes media fields', async () => {
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
      screenshots: [{ id: 1, imageId: 'old', url: '', width: 1, height: 1 }],
      videos: [{ id: 1, name: 'Old', videoId: 'PIF_fqFZEuk', url: '' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });

    await servicePrivate.applyGameChange({
      eventId: '4d-replace-media-arrays',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({
        screenshots: [
          { id: '2', image_id: 'new-image', width: '1280', height: '720' },
          { id: 2, image_id: 'new-image' }
        ],
        videos: [
          { id: '3', name: ' Trailer ', video_id: 'abc def' },
          { id: 3, name: 'Duplicate', video_id: 'abc def' }
        ]
      }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.screenshots).toEqual([
      {
        id: 2,
        imageId: 'new-image',
        url: 'https://images.igdb.com/igdb/image/upload/t_screenshot_huge/new-image.jpg',
        width: 1280,
        height: 720
      }
    ]);
    expect(stored?.videos).toEqual([
      {
        id: 3,
        name: 'Trailer',
        videoId: 'abc def',
        url: 'https://www.youtube.com/watch?v=abc%20def'
      }
    ]);
  });

  it('accepts half-step ratings in pulled game payloads', async () => {
    await servicePrivate.applyGameChange({
      eventId: '4c',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({
        rating: '4.5'
      }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.rating).toBe(4.5);
  });

  it('normalizes custom metadata in game upserts', async () => {
    await servicePrivate.applyGameChange({
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
    await servicePrivate.applyGameChange({
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

  it('normalizes mobyScore, mobygamesGameId, and review source fields in game upserts', async () => {
    await servicePrivate.applyGameChange({
      eventId: '7-mobygames',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({
        reviewScore: 88,
        reviewUrl: 'https://www.mobygames.com/game/42/sonic/',
        reviewSource: 'mobygames',
        mobyScore: 8.8,
        mobygamesGameId: 42
      }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.reviewScore).toBe(88);
    expect(stored?.reviewSource).toBe('mobygames');
    expect(stored?.mobyScore).toBe(8.8);
    expect(stored?.mobygamesGameId).toBe(42);
    expect(stored?.metacriticScore).toBeNull();
    expect(stored?.metacriticUrl).toBeNull();
  });

  it('scales MobyGames reviewScore from 0–10 to 0–100 when reviewSource is mobygames', async () => {
    await servicePrivate.applyGameChange({
      eventId: '7b-decimal-review',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({
        reviewScore: 8.8,
        reviewUrl: 'https://www.mobygames.com/game/42/sonic/',
        reviewSource: 'mobygames',
        mobyScore: 8.8,
        mobygamesGameId: 42
      }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.reviewScore).toBe(88);
    expect(stored?.reviewSource).toBe('mobygames');
    expect(stored?.mobyScore).toBe(8.8);
  });

  it('does not scale MobyGames reviewScore when it differs from mobyScore (critic_score case)', async () => {
    await servicePrivate.applyGameChange({
      eventId: '7c-critic-score',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({
        reviewScore: 75,
        reviewUrl: 'https://www.mobygames.com/game/42/sonic/',
        reviewSource: 'mobygames',
        mobyScore: 7.5,
        mobygamesGameId: 42
      }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.reviewScore).toBe(75);
    expect(stored?.reviewSource).toBe('mobygames');
    expect(stored?.mobyScore).toBe(7.5);
  });

  it('scales MobyGames reviewScore via ≤10 heuristic when mobyScore is absent', async () => {
    await servicePrivate.applyGameChange({
      eventId: '7d-no-mobyscore',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({
        reviewScore: 8.8,
        reviewUrl: 'https://www.mobygames.com/game/42/sonic/',
        reviewSource: 'mobygames',
        mobygamesGameId: 42
      }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.reviewScore).toBe(88);
    expect(stored?.reviewSource).toBe('mobygames');
    expect(stored?.mobyScore).toBeNull();
  });

  it('normalizes metacritic review source and does not set moby fields', async () => {
    await servicePrivate.applyGameChange({
      eventId: '8-metacritic',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({
        reviewScore: 91,
        reviewUrl: 'https://www.metacritic.com/game/some-game/',
        reviewSource: 'metacritic'
      }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    const stored = await db.games.where('[igdbGameId+platformIgdbId]').equals(['123', 130]).first();
    expect(stored?.reviewScore).toBe(91);
    expect(stored?.reviewSource).toBe('metacritic');
    expect(stored?.metacriticScore).toBe(91);
    expect(stored?.metacriticUrl).toBe('https://www.metacritic.com/game/some-game/');
    expect(stored?.mobyScore).toBeNull();
    expect(stored?.mobygamesGameId).toBeNull();
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

    await servicePrivate.applyTagChange({
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
    await servicePrivate.applyTagChange({
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
    await servicePrivate.applyViewChange({
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

    await servicePrivate.applyViewChange({
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

    await servicePrivate.applySettingChange({
      eventId: '11',
      entityType: 'setting',
      operation: 'upsert',
      payload: { key: PLATFORM_ORDER_STORAGE_KEY, value: '["130"]' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);
    expect(localStorage.getItem(PLATFORM_ORDER_STORAGE_KEY)).toBe('["130"]');
    expect(orderRefreshSpy).toHaveBeenCalled();

    await servicePrivate.applySettingChange({
      eventId: '12',
      entityType: 'setting',
      operation: 'upsert',
      payload: { key: PLATFORM_DISPLAY_NAMES_STORAGE_KEY, value: '{"130":"Switch"}' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);
    expect(localStorage.getItem(PLATFORM_DISPLAY_NAMES_STORAGE_KEY)).toBe('{"130":"Switch"}');
    expect(displayRefreshSpy).toHaveBeenCalled();

    await servicePrivate.applySettingChange({
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

    const batches = servicePrivate.buildPushOperationBatches(operations as OutboxRecord[], 140);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat().map((entry: { opId: string }) => entry.opId)).toEqual(['1', '2']);
  });

  it('normalizes helper values for ids/base url and notes', () => {
    expect(servicePrivate.normalizeOptionalPlatformIgdbId('abc')).toBeNull();
    expect(servicePrivate.normalizeOptionalPlatformIgdbId('130')).toBe(130);
    expect(servicePrivate.normalizeBaseUrl('https://api.example.com///')).toBe(
      'https://api.example.com'
    );
    expect(servicePrivate.normalizeNotes('   ')).toBeNull();
    expect(servicePrivate.normalizeNotes('\r\nLine 1\r\n')).toBe('\nLine 1\n');
    expect(
      (
        service as unknown as { normalizeExternalUrl: (value: unknown) => string | null }
      ).normalizeExternalUrl('//www.metacritic.com/game/example/')
    ).toBe('https://www.metacritic.com/game/example/');
  });

  it('normalizes custom title/platform helper branches', () => {
    expect(servicePrivate.normalizeCustomTitle(' Game ', 'Game')).toBeNull();
    expect(servicePrivate.normalizeCustomTitle(' Custom ', 'Game')).toBe('Custom');

    expect(servicePrivate.normalizeCustomPlatform(' Switch ', 130, 'Switch')).toBeNull();
    expect(servicePrivate.normalizeCustomPlatform('', 130, 'Switch')).toBeNull();
    expect(servicePrivate.normalizeCustomPlatform(' Custom ', 130, 'Switch')).toBe('Custom');

    expect(servicePrivate.normalizeCustomPlatformIgdbId(130, 'Switch', 130, 'Switch')).toBeNull();
    expect(servicePrivate.normalizeCustomPlatformIgdbId(null, 'Custom', 130, 'Switch')).toBeNull();
    expect(servicePrivate.normalizeCustomPlatformIgdbId(999, 'Custom', 130, 'Switch')).toBe(999);
  });

  it('ignores invalid game upsert identity payloads', async () => {
    await servicePrivate.applyGameChange({
      eventId: '14',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({ igdbGameId: '', platformIgdbId: 130 }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);
    await servicePrivate.applyGameChange({
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
    await servicePrivate.applyTagChange({
      eventId: '16',
      entityType: 'tag',
      operation: 'delete',
      payload: { id: 'bad' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    await servicePrivate.applyTagChange({
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
    await servicePrivate.applyViewChange({
      eventId: '18',
      entityType: 'view',
      operation: 'delete',
      payload: { id: 'bad' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    await servicePrivate.applyViewChange({
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
    await servicePrivate.applySettingChange({
      eventId: '20',
      entityType: 'setting',
      operation: 'upsert',
      payload: { key: '   ', value: 'x' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);
    await servicePrivate.applySettingChange({
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

    expect(servicePrivate.isOnline()).toBe(false);
    expect(servicePrivate.generateOperationId()).toMatch(/^\d+-[a-z0-9]+$/);

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

    vi.spyOn(servicePrivate.httpClient, 'post').mockReturnValue(
      of({
        cursor: 'cursor-1',
        results: [
          { opId: 'op-a', status: 'applied' },
          { opId: 'op-b', status: 'failed', message: 'boom' }
        ]
      })
    );

    await servicePrivate.pushOutbox();

    const opA = await db.outbox.get('op-a');
    const opB = await db.outbox.get('op-b');
    const cursor = await db.syncMeta.get('cursor');

    expect(opA).toBeUndefined();
    expect(opB?.attemptCount).toBe(1);
    expect(opB?.lastError).toBe('boom');
    expect(cursor?.value).toBe('cursor-1');
  });

  it('pullChanges updates cursor when response has no changes', async () => {
    vi.spyOn(servicePrivate.httpClient, 'post').mockReturnValue(
      of({
        cursor: 'next-cursor',
        changes: []
      })
    );

    await servicePrivate.pullChanges();

    const cursor = await db.syncMeta.get('cursor');
    expect(cursor?.value).toBe('next-cursor');
  });

  it('pullChanges applies changes, emits event, and falls back cursor to last event id', async () => {
    const emitChangedSpy = vi.spyOn(servicePrivate.syncEvents, 'emitChanged');
    vi.spyOn(servicePrivate.httpClient, 'post').mockReturnValue(
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

    await servicePrivate.pullChanges();

    const cursor = await db.syncMeta.get('cursor');
    expect(cursor?.value).toBe('42');
    expect(localStorage.getItem('test-setting')).toBe('on');
    expect(emitChangedSpy).toHaveBeenCalled();
  });

  it('pullChanges paginates and applies subsequent pages in one run', async () => {
    const emitChangedSpy = vi.spyOn(servicePrivate.syncEvents, 'emitChanged');
    const pageOneChanges = Array.from({ length: 1000 }, (_, index) => ({
      eventId: String(index + 1),
      entityType: 'setting' as const,
      operation: 'upsert' as const,
      payload: { key: `k-${String(index + 1)}`, value: 'v1' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    }));
    const pageTwoChanges = [
      {
        eventId: '1001',
        entityType: 'setting' as const,
        operation: 'upsert' as const,
        payload: { key: 'k-1001', value: 'v2' },
        serverTimestamp: '2026-01-01T00:00:00.000Z'
      }
    ];

    const postSpy = vi
      .spyOn(servicePrivate.httpClient, 'post')
      .mockReturnValueOnce(
        of({
          cursor: 'cursor-1000',
          changes: pageOneChanges
        })
      )
      .mockReturnValueOnce(
        of({
          cursor: 'cursor-1001',
          changes: pageTwoChanges
        })
      );

    await servicePrivate.pullChanges();

    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('k-1')).toBe('v1');
    expect(localStorage.getItem('k-1001')).toBe('v2');
    const cursor = await db.syncMeta.get('cursor');
    expect(cursor?.value).toBe('cursor-1001');
    expect(emitChangedSpy).toHaveBeenCalledTimes(1);
  });

  it('applyPulledChanges dispatches by entity type', async () => {
    const gameSpy = vi.spyOn(servicePrivate, 'applyGameChange').mockResolvedValue(undefined);
    const tagSpy = vi.spyOn(servicePrivate, 'applyTagChange').mockResolvedValue(undefined);
    const viewSpy = vi.spyOn(servicePrivate, 'applyViewChange').mockResolvedValue(undefined);
    const settingSpy = vi.spyOn(servicePrivate, 'applySettingChange').mockImplementation(() => {});

    const gameChange = {
      eventId: '44',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({ igdbGameId: 'dispatch-game' }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent;
    const tagChange = {
      eventId: '45',
      entityType: 'tag',
      operation: 'upsert',
      payload: { id: 5, name: 'Priority', color: '#ff0000' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent;
    const viewChange = {
      eventId: '46',
      entityType: 'view',
      operation: 'upsert',
      payload: { id: 11, name: 'My View', listType: 'wishlist' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent;
    const settingChange = {
      eventId: '47',
      entityType: 'setting',
      operation: 'upsert',
      payload: { key: 'dispatch-setting', value: 'on' },
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent;

    await servicePrivate.applyPulledChanges([gameChange, tagChange, viewChange, settingChange]);

    expect(gameSpy).toHaveBeenCalledWith(gameChange);
    expect(tagSpy).toHaveBeenCalledWith(tagChange);
    expect(viewSpy).toHaveBeenCalledWith(viewChange);
    expect(settingSpy).toHaveBeenCalledWith(settingChange);
  });

  it('pullChanges does not advance cursor when one or more changes fail to apply', async () => {
    localStorage.removeItem('test-setting');

    await db.syncMeta.put({
      key: 'cursor',
      value: 'cursor-before',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });

    const emitChangedSpy = vi.spyOn(servicePrivate.syncEvents, 'emitChanged');
    vi.spyOn(servicePrivate, 'applySettingChange').mockImplementation(() => {
      throw new Error('forced failure');
    });
    vi.spyOn(servicePrivate.httpClient, 'post').mockReturnValue(
      of({
        cursor: 'cursor-after',
        changes: [
          {
            eventId: '43',
            entityType: 'setting',
            operation: 'upsert',
            payload: { key: 'test-setting', value: 'on' },
            serverTimestamp: '2026-01-01T00:00:00.000Z'
          }
        ]
      })
    );

    await expect(servicePrivate.pullChanges()).rejects.toThrow(
      'Failed to apply 1 pulled sync change(s).'
    );

    const cursor = await db.syncMeta.get('cursor');
    expect(cursor?.value).toBe('cursor-before');
    expect(localStorage.getItem('test-setting')).toBeNull();
    expect(emitChangedSpy).not.toHaveBeenCalled();
  });

  it('retries pulled game upsert without server id on constraint errors', async () => {
    const constraintError = Object.assign(new Error('constraint'), { name: 'ConstraintError' });
    const putSpy = vi
      .spyOn(db.games, 'put')
      .mockRejectedValueOnce(constraintError)
      .mockResolvedValueOnce(123);

    await servicePrivate.applyGameChange({
      eventId: '46',
      entityType: 'game',
      operation: 'upsert',
      payload: createBaseGame({
        id: 999,
        igdbGameId: 'retry-test',
        platformIgdbId: 130,
        title: 'Retry Game'
      }),
      serverTimestamp: '2026-01-01T00:00:00.000Z'
    } as SyncChangeEvent);

    expect(putSpy).toHaveBeenCalledTimes(2);
    const firstArg = putSpy.mock.calls[0][0] as { id?: number };
    const secondArg = putSpy.mock.calls[1][0] as { id?: number };
    expect(firstArg.id).toBe(999);
    expect(secondArg.id).toBeUndefined();
  });

  it('rethrows non-retryable put errors during pulled game upsert', async () => {
    const abortError = Object.assign(new Error('abort'), { name: 'AbortError' });
    const putSpy = vi.spyOn(db.games, 'put').mockRejectedValueOnce(abortError);

    await expect(
      servicePrivate.applyGameChange({
        eventId: '47',
        entityType: 'game',
        operation: 'upsert',
        payload: createBaseGame({
          id: 1001,
          igdbGameId: 'throw-test',
          platformIgdbId: 130,
          title: 'Throw Game'
        }),
        serverTimestamp: '2026-01-01T00:00:00.000Z'
      } as SyncChangeEvent)
    ).rejects.toThrow('abort');

    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  it('syncNow marks connectivity degraded when push fails', async () => {
    vi.spyOn(servicePrivate, 'pushOutbox').mockRejectedValue(new Error('push failed'));
    vi.spyOn(servicePrivate, 'pullChanges').mockResolvedValue(undefined);

    await service.syncNow();

    const connectivity = await db.syncMeta.get('connectivity');
    expect(connectivity?.value).toBe('degraded');
  });

  it('syncNow skips when in flight or offline', async () => {
    const pushSpy = vi.spyOn(servicePrivate, 'pushOutbox');
    const pullSpy = vi.spyOn(servicePrivate, 'pullChanges');

    servicePrivate.baseUrl = 'http://localhost:3000';
    servicePrivate.syncInFlight = true;
    await service.syncNow();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(pullSpy).not.toHaveBeenCalled();

    servicePrivate.syncInFlight = false;
    const navigatorSpy = vi.spyOn(globalThis, 'navigator', 'get').mockReturnValue({
      onLine: false
    } as Navigator);
    await service.syncNow();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(pullSpy).not.toHaveBeenCalled();
    navigatorSpy.mockRestore();
  });

  it('initialize short-circuits when already initialized', () => {
    servicePrivate.initialized = true;
    const syncNowSpy = vi.spyOn(service, 'syncNow').mockResolvedValue(undefined);

    service.initialize();

    expect(syncNowSpy).not.toHaveBeenCalled();
  });

  it('pushOutbox exits when outbox is empty', async () => {
    const postSpy = vi.spyOn(servicePrivate.httpClient, 'post');

    await servicePrivate.pushOutbox();

    expect(postSpy).not.toHaveBeenCalled();
  });
});
