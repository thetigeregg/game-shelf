import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@ionic/angular/standalone', () => {
  class MockAlertController {
    readonly __mock = true;
  }
  class MockToastController {
    readonly __mock = true;
  }

  return {
    AlertController: MockAlertController,
    ToastController: MockToastController,
    IonHeader: {},
    IonToolbar: {},
    IonButtons: {},
    IonBackButton: {},
    IonTitle: {},
    IonContent: {},
    IonList: {},
    IonItem: {},
    IonLabel: {},
    IonSelect: {},
    IonSelectOption: {},
    IonListHeader: {},
    IonButton: {},
    IonModal: {},
    IonIcon: {},
    IonFooter: {},
    IonSearchbar: {},
    IonThumbnail: {},
    IonLoading: {},
    IonReorderGroup: {},
    IonReorder: {},
    IonInput: {},
    IonToggle: {},
    IonSpinner: {},
  };
});

vi.mock('ionicons', () => ({
  addIcons: vi.fn(),
}));

vi.mock('ionicons/icons', () => ({
  close: {},
  trash: {},
  alertCircle: {},
  download: {},
  share: {},
  fileTrayFull: {},
  swapVertical: {},
  refresh: {},
  layers: {},
  bug: {},
  key: {},
  eyeOff: {},
  server: {},
  heart: {},
  gameController: {},
}));

import { AlertController, ToastController } from '@ionic/angular/standalone';
import { SettingsPage } from './settings.page';
import { GAME_REPOSITORY } from '../core/data/game-repository';
import { SYNC_OUTBOX_WRITER } from '../core/data/sync-outbox-writer';
import { GameEntry, Tag, GameListView } from '../core/models/game.models';
import { ThemeService } from '../core/services/theme.service';
import { GameShelfService } from '../core/services/game-shelf.service';
import { ImageCacheService } from '../core/services/image-cache.service';
import { PlatformOrderService } from '../core/services/platform-order.service';
import { PlatformCustomizationService } from '../core/services/platform-customization.service';
import { DebugLogService } from '../core/services/debug-log.service';
import { GameSyncService } from '../core/services/game-sync.service';
import { ClientWriteAuthService } from '../core/services/client-write-auth.service';
import {
  RELEASE_NOTIFICATION_EVENTS_STORAGE_KEY,
  RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY,
} from '../core/services/notification.service';
import {
  PricePreferenceService,
  PRICE_PREFERENCE_STORAGE_KEY,
} from '../core/services/price-preference.service';
import {
  TimePreferenceService,
  TIME_PREFERENCE_STORAGE_KEY,
} from '../core/services/time-preference.service';
import {
  COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY,
  GameRowReleaseDateDisplayService,
  WISHLIST_RELEASE_DATE_DISPLAY_STORAGE_KEY,
} from '../core/services/game-row-release-date-display.service';
import { RECOMMENDATION_IGNORED_STORAGE_KEY } from '../core/services/recommendation-ignore.service';

type PrivateSettingsPage = SettingsPage & Record<string, (...args: unknown[]) => unknown>;

function makeGameRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    type: 'game',
    listType: 'collection',
    igdbGameId: '1234',
    platformIgdbId: '19',
    title: 'Chrono Trigger',
    customTitle: '',
    summary: '',
    storyline: '',
    notes: '',
    coverUrl: '',
    customCoverUrl: '',
    coverSource: 'igdb',
    gameType: '',
    platform: 'Super Nintendo Entertainment System',
    customPlatform: '',
    customPlatformIgdbId: '',
    collections: '[]',
    releaseDate: '1995-03-11',
    releaseYear: '1995',
    hltbMainHours: '',
    hltbMainExtraHours: '',
    hltbCompletionistHours: '',
    reviewScore: '',
    reviewUrl: '',
    reviewSource: '',
    mobyScore: '',
    mobygamesGameId: '',
    metacriticScore: '',
    metacriticUrl: '',
    similarGameIgdbIds: '[]',
    status: '',
    rating: '',
    developers: '[]',
    franchises: '[]',
    genres: '[]',
    publishers: '[]',
    tags: '[]',
    gameTagIds: '[]',
    tagId: '',
    name: '',
    color: '',
    groupBy: '',
    filters: '',
    key: '',
    value: '',
    enteredCollectionAt: '2024-01-01T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SettingsPage CSV review fields', () => {
  let repositoryMock: {
    listAll: ReturnType<typeof vi.fn>;
    listTags: ReturnType<typeof vi.fn>;
    listViews: ReturnType<typeof vi.fn>;
  };
  let timePreference = 15;
  let pricePreference = 10;
  let timePreferenceServiceMock: {
    getTimePreference: ReturnType<typeof vi.fn>;
    setTimePreference: ReturnType<typeof vi.fn>;
    refreshFromStorage: ReturnType<typeof vi.fn>;
  };
  let pricePreferenceServiceMock: {
    getPricePreference: ReturnType<typeof vi.fn>;
    setPricePreference: ReturnType<typeof vi.fn>;
    refreshFromStorage: ReturnType<typeof vi.fn>;
  };
  let collectionReleaseDateDisplay = 'year';
  let wishlistReleaseDateDisplay = 'year';
  let gameRowReleaseDateDisplayServiceMock: {
    getPreference: ReturnType<typeof vi.fn>;
    setPreference: ReturnType<typeof vi.fn>;
    refreshFromStorage: ReturnType<typeof vi.fn>;
    normalize: ReturnType<typeof vi.fn>;
  };
  let outboxWriterMock: {
    enqueueOperation: ReturnType<typeof vi.fn>;
  };
  let gameSyncServiceMock: {
    resetLocalSyncState: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    localStorage.clear();
    timePreference = 15;
    pricePreference = 10;
    collectionReleaseDateDisplay = 'year';
    wishlistReleaseDateDisplay = 'year';

    repositoryMock = {
      listAll: vi.fn().mockResolvedValue([] as GameEntry[]),
      listTags: vi.fn().mockResolvedValue([] as Tag[]),
      listViews: vi.fn().mockResolvedValue([] as GameListView[]),
    };
    timePreferenceServiceMock = {
      getTimePreference: vi.fn().mockImplementation(() => timePreference),
      setTimePreference: vi.fn().mockImplementation((value: number) => {
        timePreference = Math.max(5, Math.min(Math.round(value), 100));
      }),
      refreshFromStorage: vi.fn().mockImplementation(() => {
        const raw = localStorage.getItem(TIME_PREFERENCE_STORAGE_KEY);
        const parsed = Number.parseInt(raw ?? '', 10);

        if (Number.isFinite(parsed)) {
          timePreference = Math.max(5, Math.min(Math.round(parsed), 100));
        }
      }),
    };
    pricePreferenceServiceMock = {
      getPricePreference: vi.fn().mockImplementation(() => pricePreference),
      setPricePreference: vi.fn().mockImplementation((value: number) => {
        pricePreference = Math.max(5, Math.min(Math.round(value), 100));
      }),
      refreshFromStorage: vi.fn().mockImplementation(() => {
        const raw = localStorage.getItem(PRICE_PREFERENCE_STORAGE_KEY);
        const parsed = Number.parseInt(raw ?? '', 10);

        if (Number.isFinite(parsed)) {
          pricePreference = Math.max(5, Math.min(Math.round(parsed), 100));
        }
      }),
    };
    gameRowReleaseDateDisplayServiceMock = {
      getPreference: vi
        .fn()
        .mockImplementation((listType: 'collection' | 'wishlist') =>
          listType === 'collection' ? collectionReleaseDateDisplay : wishlistReleaseDateDisplay
        ),
      setPreference: vi
        .fn()
        .mockImplementation((listType: 'collection' | 'wishlist', value: string) => {
          const normalized = value === 'monthYear' || value === 'fullDate' ? value : 'year';

          try {
            localStorage.setItem(
              listType === 'collection'
                ? COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY
                : WISHLIST_RELEASE_DATE_DISPLAY_STORAGE_KEY,
              normalized
            );
          } catch {
            // Ignore storage failures to match the concrete service behavior.
          }

          if (listType === 'collection') {
            collectionReleaseDateDisplay = normalized;
          } else {
            wishlistReleaseDateDisplay = normalized;
          }
        }),
      refreshFromStorage: vi.fn().mockImplementation((listType?: 'collection' | 'wishlist') => {
        const refreshSingle = (target: 'collection' | 'wishlist') => {
          const key =
            target === 'collection'
              ? COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY
              : WISHLIST_RELEASE_DATE_DISPLAY_STORAGE_KEY;
          const raw = localStorage.getItem(key);
          const normalized =
            raw === 'monthYear' || raw === 'fullDate' || raw === 'year' ? raw : 'year';
          if (target === 'collection') {
            collectionReleaseDateDisplay = normalized;
          } else {
            wishlistReleaseDateDisplay = normalized;
          }
        };

        if (!listType || listType === 'collection') {
          refreshSingle('collection');
        }

        if (!listType || listType === 'wishlist') {
          refreshSingle('wishlist');
        }
      }),
      normalize: vi
        .fn()
        .mockImplementation((value: string) =>
          value === 'monthYear' || value === 'fullDate' || value === 'year' ? value : 'year'
        ),
    };
    outboxWriterMock = {
      enqueueOperation: vi.fn().mockResolvedValue(undefined),
    };
    gameSyncServiceMock = {
      resetLocalSyncState: vi.fn().mockResolvedValue(true),
    };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: GAME_REPOSITORY,
          useValue: repositoryMock,
        },
        {
          provide: ThemeService,
          useValue: {
            getColorSchemePreference: vi.fn().mockReturnValue('system'),
            setColorSchemePreference: vi.fn(),
          },
        },
        {
          provide: GameShelfService,
          useValue: {},
        },
        {
          provide: ImageCacheService,
          useValue: {
            getLimitMb: vi.fn().mockReturnValue(200),
            setLimitMb: vi.fn().mockImplementation((value: number) => value),
            getUsageBytes: vi.fn().mockResolvedValue(0),
          },
        },
        {
          provide: GameSyncService,
          useValue: gameSyncServiceMock,
        },
        {
          provide: PlatformOrderService,
          useValue: { refreshFromStorage: vi.fn() },
        },
        {
          provide: PlatformCustomizationService,
          useValue: { refreshFromStorage: vi.fn() },
        },
        {
          provide: ToastController,
          useValue: {
            create: vi.fn().mockResolvedValue({ present: vi.fn().mockResolvedValue(undefined) }),
          },
        },
        {
          provide: AlertController,
          useValue: {
            create: vi.fn().mockResolvedValue({ present: vi.fn().mockResolvedValue(undefined) }),
          },
        },
        {
          provide: Router,
          useValue: {
            navigateByUrl: vi.fn().mockResolvedValue(true),
          },
        },
        {
          provide: DebugLogService,
          useValue: {
            isVerboseTracingEnabled: vi.fn().mockReturnValue(false),
            setVerboseTracingEnabled: vi.fn(),
            info: vi.fn(),
            error: vi.fn(),
          },
        },
        {
          provide: ClientWriteAuthService,
          useValue: {
            hasToken: vi.fn().mockReturnValue(false),
          },
        },
        {
          provide: PricePreferenceService,
          useValue: pricePreferenceServiceMock,
        },
        {
          provide: TimePreferenceService,
          useValue: timePreferenceServiceMock,
        },
        {
          provide: GameRowReleaseDateDisplayService,
          useValue: gameRowReleaseDateDisplayServiceMock,
        },
        {
          provide: SYNC_OUTBOX_WRITER,
          useValue: outboxWriterMock,
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function createPage(): PrivateSettingsPage {
    return TestBed.runInInjectionContext(
      () => new SettingsPage()
    ) as unknown as PrivateSettingsPage;
  }

  it('imports source-native mobygames fields from game rows', () => {
    const page = createPage();
    const record = makeGameRow({
      reviewScore: '86',
      reviewUrl: 'https://www.mobygames.com/game/4501/chrono-trigger/',
      reviewSource: 'mobygames',
      mobyScore: '8.6',
      mobygamesGameId: '4501',
    });

    const preview = page['validateImportRecord'](
      record,
      2,
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>()
    ) as {
      error: string | null;
      parsed: { kind: string; catalog: Record<string, unknown> } | null;
    };

    expect(preview.error).toBeNull();
    expect(preview.parsed).not.toBeNull();
    if (!preview.parsed) {
      return;
    }
    expect(preview.parsed.kind).toBe('game');
    expect(preview.parsed.catalog.reviewSource).toBe('mobygames');
    expect(preview.parsed.catalog.reviewScore).toBe(86);
    expect(preview.parsed.catalog.mobyScore).toBe(8.6);
    expect(preview.parsed.catalog.mobygamesGameId).toBe(4501);
    expect(preview.parsed.catalog.metacriticScore).toBeNull();
    expect(preview.parsed.catalog.metacriticUrl).toBeNull();
  });

  it('normalizes mobygames reviewScore from 0-10 to 0-100 on import', () => {
    const page = createPage();
    const record = makeGameRow({
      reviewScore: '8.6',
      reviewSource: 'mobygames',
      mobyScore: '',
    });

    const preview = page['validateImportRecord'](
      record,
      2,
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>()
    ) as {
      error: string | null;
      parsed: { kind: string; catalog: Record<string, unknown> } | null;
    };

    expect(preview.error).toBeNull();
    expect(preview.parsed).not.toBeNull();
    if (!preview.parsed) {
      return;
    }
    expect(preview.parsed.kind).toBe('game');
    expect(preview.parsed.catalog.reviewScore).toBe(86);
    expect(preview.parsed.catalog.mobyScore).toBe(8.6);
  });

  it('preserves low mobygames reviewScore (e.g. 0.5) as mobyScore on import', () => {
    const page = createPage();
    const record = makeGameRow({
      reviewScore: '0.5',
      reviewSource: 'mobygames',
      mobyScore: '',
    });

    const preview = page['validateImportRecord'](
      record,
      2,
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>()
    ) as {
      error: string | null;
      parsed: { kind: string; catalog: Record<string, unknown> } | null;
    };

    expect(preview.error).toBeNull();
    expect(preview.parsed).not.toBeNull();
    if (!preview.parsed) {
      return;
    }
    expect(preview.parsed.kind).toBe('game');
    expect(preview.parsed.catalog.reviewScore).toBe(5);
    expect(preview.parsed.catalog.mobyScore).toBe(0.5);
  });

  it('rejects out-of-range mobygames score values on import', () => {
    const page = createPage();
    const record = makeGameRow({
      reviewScore: '80',
      reviewSource: 'mobygames',
      mobyScore: '12',
    });

    const preview = page['validateImportRecord'](
      record,
      2,
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>()
    ) as { error: string | null };

    expect(preview.error).toBe('Moby score must be greater than 0 and at most 10.');
  });

  it('rejects zero mobygames score values on import', () => {
    const page = createPage();
    const record = makeGameRow({
      reviewScore: '80',
      reviewSource: 'mobygames',
      mobyScore: '0',
    });

    const preview = page['validateImportRecord'](
      record,
      2,
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>()
    ) as { error: string | null };

    expect(preview.error).toBe('Moby score must be greater than 0 and at most 10.');
  });

  it('rejects credentialed custom cover urls with a sanitizer-aligned import error', () => {
    const page = createPage();
    const record = makeGameRow({
      customCoverUrl: 'https://user:pass@images.example.com/custom-cover.jpg',
    });

    const preview = page['validateImportRecord'](
      record,
      2,
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>()
    ) as { error: string | null };

    expect(preview.error).toBe(
      'Custom cover image must be a data URL or http/https URL without embedded credentials.'
    );
  });

  it('maps reviewSource/mobyScore/mobygamesGameId columns from CSV records', () => {
    const page = createPage();
    const headers = Object.keys(
      makeGameRow({
        reviewScore: '',
        reviewUrl: '',
        reviewSource: '',
        mobyScore: '',
        mobygamesGameId: '',
        metacriticScore: '',
        metacriticUrl: '',
      })
    );
    const values = headers.map((header) => {
      if (header === 'reviewSource') {
        return 'mobygames';
      }
      if (header === 'mobyScore') {
        return '8.6';
      }
      if (header === 'mobygamesGameId') {
        return '4501';
      }
      if (header === 'metacriticScore') {
        return '91';
      }
      return '';
    });

    const mapped = page['mapCsvRecord'](headers, values) as Record<string, string>;

    expect(mapped.reviewSource).toBe('mobygames');
    expect(mapped.mobyScore).toBe('8.6');
    expect(mapped.mobygamesGameId).toBe('4501');
    expect(mapped.reviewScore).toBe('91');
  });

  it('exports source-native review columns for game rows', async () => {
    const page = createPage();
    repositoryMock.listAll.mockResolvedValue([
      {
        igdbGameId: '1234',
        platformIgdbId: 19,
        title: 'Chrono Trigger',
        coverUrl: null,
        coverSource: 'igdb',
        platform: 'Super Nintendo Entertainment System',
        releaseDate: '1995-03-11',
        releaseYear: 1995,
        listType: 'collection',
        enteredCollectionAt: '2025-08-05T00:00:00.000Z',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        reviewScore: 86,
        reviewUrl: 'https://www.mobygames.com/game/4501/chrono-trigger/',
        reviewSource: 'mobygames',
        mobyScore: 8.6,
        mobygamesGameId: 4501,
        metacriticScore: null,
        metacriticUrl: null,
      } as GameEntry,
    ]);

    const csv = await page['buildExportCsv']();
    const [headerLine, gameLine] = csv.split('\n');

    expect(headerLine).toContain('reviewSource');
    expect(headerLine).toContain('mobyScore');
    expect(headerLine).toContain('mobygamesGameId');
    expect(headerLine).toContain('enteredCollectionAt');
    expect(gameLine).toContain(',mobygames,8.6,4501,');
    expect(gameLine).toContain('2025-08-05T00:00:00.000Z');
  });

  it('accepts legacy CSV imports without enteredCollectionAt and backfills it from createdAt', async () => {
    const page = createPage();
    const legacyRow = makeGameRow();
    const headers = Object.keys(legacyRow).filter((header) => header !== 'enteredCollectionAt');
    const values = headers.map((header) => legacyRow[header] ?? '');
    const csv = [headers.join(','), values.join(',')].join('\n');

    const preview = (await page['parseImportCsv'](csv)) as Array<{
      error: string | null;
      parsed: { kind: string; enteredCollectionAt: string | null; createdAt: string | null } | null;
    }>;

    expect(preview).toHaveLength(1);
    expect(preview[0]?.error).toBeNull();
    expect(preview[0]?.parsed).toMatchObject({
      kind: 'game',
      createdAt: '2024-01-01T00:00:00.000Z',
      enteredCollectionAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('includes release date display settings in exported settings even when defaults are not stored', () => {
    const page = createPage();

    const entries = page['readExportableSettings']();

    expect(entries).toContainEqual([COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY, 'year']);
    expect(entries).toContainEqual([WISHLIST_RELEASE_DATE_DISPLAY_STORAGE_KEY, 'year']);
  });

  it('loads time preference from service and persists updates', () => {
    vi.useFakeTimers();
    const page = createPage();
    expect(page.timePreference).toBe(15);

    page.onTimePreferenceChange('42');
    expect(timePreferenceServiceMock.setTimePreference).toHaveBeenCalledWith(42);
    expect(page.timePreference).toBe(42);
    expect(outboxWriterMock.enqueueOperation).not.toHaveBeenCalled();
    vi.advanceTimersByTime(450);
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledWith({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: TIME_PREFERENCE_STORAGE_KEY,
        value: '42',
      },
    });

    page.onTimePreferenceChange('bad');
    expect(page.timePreference).toBe(42);
  });

  it('loads price preference from service and persists updates', () => {
    vi.useFakeTimers();
    const page = createPage();
    expect(page.pricePreference).toBe(10);

    page.onPricePreferenceChange('24');
    expect(pricePreferenceServiceMock.setPricePreference).toHaveBeenCalledWith(24);
    expect(page.pricePreference).toBe(24);
    expect(outboxWriterMock.enqueueOperation).not.toHaveBeenCalled();
    vi.advanceTimersByTime(450);
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledWith({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: PRICE_PREFERENCE_STORAGE_KEY,
        value: '24',
      },
    });

    page.onPricePreferenceChange('bad');
    expect(page.pricePreference).toBe(24);
  });

  it('accepts decimal and scientific numeric input for time preference', () => {
    vi.useFakeTimers();
    const page = createPage();

    page.onTimePreferenceChange('42.9');
    expect(page.timePreference).toBe(43);

    page.onTimePreferenceChange('1e2');
    expect(page.timePreference).toBe(100);
  });

  it('loads release date display preferences from service and persists collection updates', () => {
    collectionReleaseDateDisplay = 'monthYear';
    wishlistReleaseDateDisplay = 'fullDate';
    const page = createPage();

    expect(page.collectionReleaseDateDisplay).toBe('monthYear');
    expect(page.wishlistReleaseDateDisplay).toBe('fullDate');

    page.onCollectionReleaseDateDisplayChange('fullDate');

    expect(gameRowReleaseDateDisplayServiceMock.setPreference).toHaveBeenCalledWith(
      'collection',
      'fullDate'
    );
    expect(page.collectionReleaseDateDisplay).toBe('fullDate');
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledWith({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY,
        value: 'fullDate',
      },
    });
  });

  it('uses distinct release date display labels in the settings template', () => {
    const template = readFileSync(
      resolve(process.cwd(), 'src/app/settings/settings.page.html'),
      'utf8'
    );

    expect(template).toContain('label="Collection Display"');
    expect(template).toContain('label="Wishlist Display"');
    expect(template).not.toContain('label="Release Date Display"');
  });

  it('includes a reset local sync state action in the settings template', () => {
    const template = readFileSync(
      resolve(process.cwd(), 'src/app/settings/settings.page.html'),
      'utf8'
    );

    expect(template).toContain('Reset Local Sync State');
    expect(template).toContain('[disabled]="isResettingLocalSyncState"');
    expect(template).toContain('<ion-spinner slot="end" name="crescent"></ion-spinner>');
  });

  it('resets local sync state after confirmation', async () => {
    const page = createPage();
    const presentToastSpy = vi.spyOn(page, 'presentToast').mockResolvedValue(undefined);
    const alert = {
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn().mockResolvedValue({ role: 'confirm' }),
    };
    const alertCreateSpy = vi
      .spyOn(TestBed.inject(AlertController), 'create')
      .mockResolvedValue(alert as never);

    await page.resetLocalSyncState();

    expect(alertCreateSpy).toHaveBeenCalled();
    expect(gameSyncServiceMock.resetLocalSyncState).toHaveBeenCalledTimes(1);
    expect(presentToastSpy).toHaveBeenCalledWith('Local sync state reset. Fresh sync started.');
    expect(page.isResettingLocalSyncState).toBe(false);
  });

  it('shows a deferred sync message when a fresh sync cannot start immediately', async () => {
    gameSyncServiceMock.resetLocalSyncState.mockResolvedValueOnce(false);

    const page = createPage();
    const presentToastSpy = vi.spyOn(page, 'presentToast').mockResolvedValue(undefined);
    const alert = {
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn().mockResolvedValue({ role: 'confirm' }),
    };
    vi.spyOn(TestBed.inject(AlertController), 'create').mockResolvedValue(alert as never);

    await page.resetLocalSyncState();

    expect(presentToastSpy).toHaveBeenCalledWith(
      'Local sync state reset. Fresh sync will run when available.'
    );
    expect(page.isResettingLocalSyncState).toBe(false);
  });

  it('does not reset local sync state when confirmation is canceled', async () => {
    const page = createPage();
    const alert = {
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn().mockResolvedValue({ role: 'cancel' }),
    };
    vi.spyOn(TestBed.inject(AlertController), 'create').mockResolvedValue(alert as never);

    await page.resetLocalSyncState();

    expect(gameSyncServiceMock.resetLocalSyncState).not.toHaveBeenCalled();
    expect(page.isResettingLocalSyncState).toBe(false);
  });

  it('tracks loading state while resetting local sync state', async () => {
    let resolveReset: (() => void) | null = null;
    const resetPromise = new Promise<boolean>((resolve) => {
      resolveReset = () => {
        resolve(true);
      };
    });
    gameSyncServiceMock.resetLocalSyncState.mockReturnValueOnce(resetPromise);

    const page = createPage();
    vi.spyOn(page, 'presentToast').mockResolvedValue(undefined);
    const alert = {
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn().mockResolvedValue({ role: 'confirm' }),
    };
    vi.spyOn(TestBed.inject(AlertController), 'create').mockResolvedValue(alert as never);

    const pageResetPromise = page.resetLocalSyncState();

    await vi.waitFor(() => {
      expect(page.isResettingLocalSyncState).toBe(true);
    });

    resolveReset?.();
    await pageResetPromise;

    expect(page.isResettingLocalSyncState).toBe(false);
  });

  it('normalizes invalid wishlist release date display changes before persisting', () => {
    const page = createPage();

    page.onWishlistReleaseDateDisplayChange('bad-value');

    expect(gameRowReleaseDateDisplayServiceMock.normalize).toHaveBeenCalledWith('bad-value');
    expect(page.wishlistReleaseDateDisplay).toBe('year');
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledWith({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: WISHLIST_RELEASE_DATE_DISPLAY_STORAGE_KEY,
        value: 'year',
      },
    });
  });

  it('debounces outbox writes while typing time preference', () => {
    vi.useFakeTimers();
    const page = createPage();

    page.onTimePreferenceChange('1');
    page.onTimePreferenceChange('10');
    page.onTimePreferenceChange('100');

    expect(outboxWriterMock.enqueueOperation).not.toHaveBeenCalled();
    vi.advanceTimersByTime(450);
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledTimes(1);
    expect(outboxWriterMock.enqueueOperation).toHaveBeenLastCalledWith({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: TIME_PREFERENCE_STORAGE_KEY,
        value: '100',
      },
    });
  });

  it('debounces outbox writes while typing price preference', () => {
    vi.useFakeTimers();
    const page = createPage();

    page.onPricePreferenceChange('6');
    page.onPricePreferenceChange('12');
    page.onPricePreferenceChange('30');

    expect(outboxWriterMock.enqueueOperation).not.toHaveBeenCalled();
    vi.advanceTimersByTime(450);
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledTimes(1);
    expect(outboxWriterMock.enqueueOperation).toHaveBeenLastCalledWith({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: PRICE_PREFERENCE_STORAGE_KEY,
        value: '30',
      },
    });
  });

  it('refreshes and queues time preference when imported as a setting row', async () => {
    const page = createPage();
    localStorage.removeItem(TIME_PREFERENCE_STORAGE_KEY);
    expect(page.timePreference).toBe(15);

    await page['applyImportedSettings']([
      {
        kind: 'setting',
        key: TIME_PREFERENCE_STORAGE_KEY,
        value: '27',
      },
    ]);

    expect(timePreferenceServiceMock.refreshFromStorage).toHaveBeenCalled();
    expect(page.timePreference).toBe(27);
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledWith({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: TIME_PREFERENCE_STORAGE_KEY,
        value: '27',
      },
    });
  });

  it('refreshes and queues price preference when imported as a setting row', async () => {
    const page = createPage();
    localStorage.removeItem(PRICE_PREFERENCE_STORAGE_KEY);
    expect(page.pricePreference).toBe(10);

    await page['applyImportedSettings']([
      {
        kind: 'setting',
        key: PRICE_PREFERENCE_STORAGE_KEY,
        value: '31',
      },
    ]);

    expect(pricePreferenceServiceMock.refreshFromStorage).toHaveBeenCalled();
    expect(page.pricePreference).toBe(31);
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledWith({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: PRICE_PREFERENCE_STORAGE_KEY,
        value: '31',
      },
    });
  });

  it('refreshes and queues collection release date display when imported as a setting row', async () => {
    const page = createPage();
    localStorage.removeItem(COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY);
    expect(page.collectionReleaseDateDisplay).toBe('year');

    await page['applyImportedSettings']([
      {
        kind: 'setting',
        key: COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY,
        value: 'monthYear',
      },
    ]);

    expect(gameRowReleaseDateDisplayServiceMock.normalize).toHaveBeenCalledWith('monthYear');
    expect(gameRowReleaseDateDisplayServiceMock.setPreference).toHaveBeenCalledWith(
      'collection',
      'monthYear'
    );
    expect(page.collectionReleaseDateDisplay).toBe('monthYear');
    expect(localStorage.getItem(COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY)).toBe('monthYear');
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledWith({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY,
        value: 'monthYear',
      },
    });
  });

  it('normalizes invalid imported wishlist release date display before persisting and syncing', async () => {
    const page = createPage();
    localStorage.removeItem(WISHLIST_RELEASE_DATE_DISPLAY_STORAGE_KEY);
    expect(page.wishlistReleaseDateDisplay).toBe('year');

    await page['applyImportedSettings']([
      {
        kind: 'setting',
        key: WISHLIST_RELEASE_DATE_DISPLAY_STORAGE_KEY,
        value: 'nope',
      },
    ]);

    expect(gameRowReleaseDateDisplayServiceMock.normalize).toHaveBeenCalledWith('nope');
    expect(gameRowReleaseDateDisplayServiceMock.setPreference).toHaveBeenCalledWith(
      'wishlist',
      'year'
    );
    expect(page.wishlistReleaseDateDisplay).toBe('year');
    expect(localStorage.getItem(WISHLIST_RELEASE_DATE_DISPLAY_STORAGE_KEY)).toBe('year');
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledWith({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: WISHLIST_RELEASE_DATE_DISPLAY_STORAGE_KEY,
        value: 'year',
      },
    });
  });

  it('keeps imported collection release date display in memory when storage writes fail', async () => {
    const page = createPage();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    await page['applyImportedSettings']([
      {
        kind: 'setting',
        key: COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY,
        value: 'fullDate',
      },
    ]);

    expect(gameRowReleaseDateDisplayServiceMock.normalize).toHaveBeenCalledWith('fullDate');
    expect(gameRowReleaseDateDisplayServiceMock.setPreference).toHaveBeenCalledWith(
      'collection',
      'fullDate'
    );
    expect(page.collectionReleaseDateDisplay).toBe('fullDate');
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledWith({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY,
        value: 'fullDate',
      },
    });

    setItemSpy.mockRestore();
  });

  it('normalizes invalid imported time preference before persisting and syncing', async () => {
    const page = createPage();
    localStorage.removeItem(TIME_PREFERENCE_STORAGE_KEY);
    expect(page.timePreference).toBe(15);

    await page['applyImportedSettings']([
      {
        kind: 'setting',
        key: TIME_PREFERENCE_STORAGE_KEY,
        value: 'not-a-number',
      },
    ]);

    expect(timePreferenceServiceMock.refreshFromStorage).toHaveBeenCalled();
    expect(page.timePreference).toBe(15);
    expect(localStorage.getItem(TIME_PREFERENCE_STORAGE_KEY)).toBe('15');
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledWith({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: TIME_PREFERENCE_STORAGE_KEY,
        value: '15',
      },
    });
  });

  it('continues processing later rows when legacy primary color key is present', async () => {
    const page = createPage();

    await page['applyImportedSettings']([
      {
        kind: 'setting',
        key: 'game-shelf-primary-color',
        value: '#ff0000',
      },
      {
        kind: 'setting',
        key: TIME_PREFERENCE_STORAGE_KEY,
        value: '33',
      },
    ]);

    expect(localStorage.getItem('game-shelf-primary-color')).toBeNull();
    expect(timePreferenceServiceMock.refreshFromStorage).toHaveBeenCalled();
    expect(page.timePreference).toBe(33);
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledWith({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: TIME_PREFERENCE_STORAGE_KEY,
        value: '33',
      },
    });
  });

  it('normalizes imported ignored recommendations before persisting and syncing', async () => {
    const page = createPage();
    const importedValue = JSON.stringify({
      version: 1,
      entries: [
        { igdbGameId: '9', title: 'Alpha', ignoredAt: '2025-01-01T00:00:00.000Z' },
        { igdbGameId: '9', title: 'Alpha Updated', ignoredAt: '2025-02-01T00:00:00.000Z' },
        { igdbGameId: 'not-an-id', title: 'Invalid', ignoredAt: '2025-01-01T00:00:00.000Z' },
        { igdbGameId: '10', title: 'Beta', ignoredAt: '2025-03-01T00:00:00.000Z' },
      ],
    });

    await page['applyImportedSettings']([
      {
        kind: 'setting',
        key: RECOMMENDATION_IGNORED_STORAGE_KEY,
        value: importedValue,
      },
    ]);

    const persisted = localStorage.getItem(RECOMMENDATION_IGNORED_STORAGE_KEY);
    expect(typeof persisted).toBe('string');
    expect(persisted).not.toBe(importedValue);

    const parsedPersisted = JSON.parse(persisted ?? '{}') as {
      version: number;
      entries: Array<{ igdbGameId: string; title: string; ignoredAt: string }>;
    };
    expect(parsedPersisted.version).toBe(1);
    expect(parsedPersisted.entries).toEqual([
      { igdbGameId: '9', title: 'Alpha Updated', ignoredAt: '2025-02-01T00:00:00.000Z' },
      { igdbGameId: '10', title: 'Beta', ignoredAt: '2025-03-01T00:00:00.000Z' },
    ]);
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledWith({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: RECOMMENDATION_IGNORED_STORAGE_KEY,
        value: persisted,
      },
    });
  });

  it('deletes ignored recommendations setting when imported payload is malformed', async () => {
    const page = createPage();

    await page['applyImportedSettings']([
      {
        kind: 'setting',
        key: RECOMMENDATION_IGNORED_STORAGE_KEY,
        value: '{bad json',
      },
    ]);

    expect(localStorage.getItem(RECOMMENDATION_IGNORED_STORAGE_KEY)).toBeNull();
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledWith({
      entityType: 'setting',
      operation: 'delete',
      payload: {
        key: RECOMMENDATION_IGNORED_STORAGE_KEY,
      },
    });
  });

  it('registers device when imported release notifications setting is enabled', async () => {
    const page = createPage();
    const notificationService = page['notificationService'];
    const registerSpy = vi
      .spyOn(notificationService, 'registerCurrentDeviceIfPermitted')
      .mockResolvedValue({ ok: true, message: 'ok' });
    const unregisterSpy = vi
      .spyOn(notificationService, 'unregisterCurrentDevice')
      .mockResolvedValue({ ok: true, message: 'ok' });
    const setEnabledSpy = vi.spyOn(notificationService, 'setReleaseNotificationsEnabled');

    await page['applyImportedSettings']([
      {
        kind: 'setting',
        key: RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY,
        value: 'true',
      },
    ]);

    expect(registerSpy).toHaveBeenCalledOnce();
    expect(unregisterSpy).not.toHaveBeenCalled();
    expect(setEnabledSpy).toHaveBeenCalledWith(true);
    expect(localStorage.getItem(RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY)).toBe('true');
  });

  it('does not register device when imported release notifications setting is disabled', async () => {
    const page = createPage();
    const notificationService = page['notificationService'];
    const registerSpy = vi
      .spyOn(notificationService, 'registerCurrentDeviceIfPermitted')
      .mockResolvedValue({ ok: true, message: 'ok' });
    const unregisterSpy = vi
      .spyOn(notificationService, 'unregisterCurrentDevice')
      .mockResolvedValue({ ok: true, message: 'ok' });

    await page['applyImportedSettings']([
      {
        kind: 'setting',
        key: RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY,
        value: 'false',
      },
    ]);

    expect(registerSpy).not.toHaveBeenCalled();
    expect(unregisterSpy).toHaveBeenCalledOnce();
    expect(localStorage.getItem(RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY)).toBe('false');
  });

  it('does not persist disabled import state when unregister fails', async () => {
    const page = createPage();
    const notificationService = page['notificationService'];
    localStorage.setItem(RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY, 'true');

    const registerSpy = vi
      .spyOn(notificationService, 'registerCurrentDeviceIfPermitted')
      .mockResolvedValue({ ok: true, message: 'ok' });
    const unregisterSpy = vi
      .spyOn(notificationService, 'unregisterCurrentDevice')
      .mockResolvedValue({ ok: false, message: 'failed' });
    const setEnabledSpy = vi.spyOn(notificationService, 'setReleaseNotificationsEnabled');

    await page['applyImportedSettings']([
      {
        kind: 'setting',
        key: RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY,
        value: 'false',
      },
    ]);

    expect(registerSpy).not.toHaveBeenCalled();
    expect(unregisterSpy).toHaveBeenCalledOnce();
    expect(setEnabledSpy).not.toHaveBeenCalledWith(false);
    expect(localStorage.getItem(RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY)).toBe('true');
    expect(page.releaseNotificationsEnabled).toBe(true);
  });

  it('normalizes imported release notification events before applying and syncing', async () => {
    const page = createPage();

    await page['applyImportedSettings']([
      {
        kind: 'setting',
        key: RELEASE_NOTIFICATION_EVENTS_STORAGE_KEY,
        value: JSON.stringify({
          set: false,
          changed: 'yes',
          removed: null,
          day: 1,
          sale: 0,
        }),
      },
    ]);

    expect(page.releaseNotificationEvents).toEqual({
      set: false,
      changed: true,
      removed: true,
      day: true,
      sale: false,
    });
    expect(localStorage.getItem(RELEASE_NOTIFICATION_EVENTS_STORAGE_KEY)).toBe(
      '{"set":false,"changed":true,"removed":true,"day":true,"sale":false}'
    );
    expect(outboxWriterMock.enqueueOperation).toHaveBeenCalledWith({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: RELEASE_NOTIFICATION_EVENTS_STORAGE_KEY,
        value: '{"set":false,"changed":true,"removed":true,"day":true,"sale":false}',
      },
    });
  });

  it('treats string falsey imported release event values as disabled', async () => {
    const page = createPage();

    await page['applyImportedSettings']([
      {
        kind: 'setting',
        key: RELEASE_NOTIFICATION_EVENTS_STORAGE_KEY,
        value: JSON.stringify({
          set: 'false',
          changed: '0',
          removed: 'no',
          day: 'false',
          sale: '0',
        }),
      },
    ]);

    expect(page.releaseNotificationEvents).toEqual({
      set: false,
      changed: false,
      removed: false,
      day: false,
      sale: false,
    });
    expect(localStorage.getItem(RELEASE_NOTIFICATION_EVENTS_STORAGE_KEY)).toBe(
      '{"set":false,"changed":false,"removed":false,"day":false,"sale":false}'
    );
  });

  it('keeps release notifications disabled when disable succeeds', async () => {
    const page = createPage();
    const notificationService = page['notificationService'];
    const disableSpy = vi
      .spyOn(notificationService, 'disableReleaseNotifications')
      .mockResolvedValue({
        ok: true,
        message: 'disabled',
      });
    const setEnabledSpy = vi.spyOn(notificationService, 'setReleaseNotificationsEnabled');
    page.releaseNotificationsEnabled = true;

    await page.onReleaseNotificationsEnabledChange(false);

    expect(disableSpy).toHaveBeenCalledOnce();
    expect(page.releaseNotificationsEnabled).toBe(false);
    expect(setEnabledSpy).not.toHaveBeenCalled();
  });

  it('rolls release notifications toggle back when disable fails', async () => {
    const page = createPage();
    const notificationService = page['notificationService'];
    const disableSpy = vi
      .spyOn(notificationService, 'disableReleaseNotifications')
      .mockResolvedValue({
        ok: false,
        message: 'failed',
      });
    const setEnabledSpy = vi.spyOn(notificationService, 'setReleaseNotificationsEnabled');
    page.releaseNotificationsEnabled = true;

    await page.onReleaseNotificationsEnabledChange(false);

    expect(disableSpy).toHaveBeenCalledOnce();
    expect(page.releaseNotificationsEnabled).toBe(true);
    expect(setEnabledSpy).not.toHaveBeenCalled();
  });
});
