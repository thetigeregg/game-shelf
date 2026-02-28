import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

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
    IonToggle: {}
  };
});

vi.mock('ionicons', () => ({
  addIcons: vi.fn()
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
  key: {}
}));

import { AlertController, ToastController } from '@ionic/angular/standalone';
import { SettingsPage } from './settings.page';
import { GAME_REPOSITORY } from '../core/data/game-repository';
import { GameEntry, Tag, GameListView } from '../core/models/game.models';
import { ThemeService } from '../core/services/theme.service';
import { GameShelfService } from '../core/services/game-shelf.service';
import { ImageCacheService } from '../core/services/image-cache.service';
import { PlatformOrderService } from '../core/services/platform-order.service';
import { PlatformCustomizationService } from '../core/services/platform-customization.service';
import { DebugLogService } from '../core/services/debug-log.service';
import { ClientWriteAuthService } from '../core/services/client-write-auth.service';

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
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('SettingsPage CSV review fields', () => {
  let repositoryMock: {
    listAll: ReturnType<typeof vi.fn>;
    listTags: ReturnType<typeof vi.fn>;
    listViews: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    localStorage.clear();

    repositoryMock = {
      listAll: vi.fn().mockResolvedValue([] as GameEntry[]),
      listTags: vi.fn().mockResolvedValue([] as Tag[]),
      listViews: vi.fn().mockResolvedValue([] as GameListView[])
    };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: GAME_REPOSITORY,
          useValue: repositoryMock
        },
        {
          provide: ThemeService,
          useValue: {
            getColorSchemePreference: vi.fn().mockReturnValue('system'),
            setColorSchemePreference: vi.fn()
          }
        },
        {
          provide: GameShelfService,
          useValue: {}
        },
        {
          provide: ImageCacheService,
          useValue: {
            getLimitMb: vi.fn().mockReturnValue(200),
            setLimitMb: vi.fn().mockImplementation((value: number) => value),
            getUsageBytes: vi.fn().mockResolvedValue(0)
          }
        },
        {
          provide: PlatformOrderService,
          useValue: { refreshFromStorage: vi.fn() }
        },
        {
          provide: PlatformCustomizationService,
          useValue: { refreshFromStorage: vi.fn() }
        },
        {
          provide: ToastController,
          useValue: {
            create: vi.fn().mockResolvedValue({ present: vi.fn().mockResolvedValue(undefined) })
          }
        },
        {
          provide: AlertController,
          useValue: {
            create: vi.fn().mockResolvedValue({ present: vi.fn().mockResolvedValue(undefined) })
          }
        },
        {
          provide: Router,
          useValue: {
            navigateByUrl: vi.fn().mockResolvedValue(true)
          }
        },
        {
          provide: DebugLogService,
          useValue: {
            isVerboseTracingEnabled: vi.fn().mockReturnValue(false),
            setVerboseTracingEnabled: vi.fn()
          }
        },
        {
          provide: ClientWriteAuthService,
          useValue: {
            hasToken: vi.fn().mockReturnValue(false)
          }
        }
      ]
    });
  });

  afterEach(() => {
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
      mobygamesGameId: '4501'
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
      mobyScore: ''
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

  it('rejects out-of-range mobygames score values on import', () => {
    const page = createPage();
    const record = makeGameRow({
      reviewScore: '80',
      reviewSource: 'mobygames',
      mobyScore: '12'
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
      mobyScore: '0'
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
        metacriticUrl: ''
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
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        reviewScore: 86,
        reviewUrl: 'https://www.mobygames.com/game/4501/chrono-trigger/',
        reviewSource: 'mobygames',
        mobyScore: 8.6,
        mobygamesGameId: 4501,
        metacriticScore: null,
        metacriticUrl: null
      } as GameEntry
    ]);

    const csv = await page['buildExportCsv']();
    const [headerLine, gameLine] = csv.split('\n');

    expect(headerLine).toContain('reviewSource');
    expect(headerLine).toContain('mobyScore');
    expect(headerLine).toContain('mobygamesGameId');
    expect(gameLine).toContain(',mobygames,8.6,4501,');
  });
});
