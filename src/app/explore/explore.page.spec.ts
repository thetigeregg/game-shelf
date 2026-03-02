import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

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
    IonContent: {},
    IonHeader: {},
    IonItem: {},
    IonLabel: {},
    IonList: {},
    IonModal: {},
    IonSelect: {},
    IonSelectOption: {},
    IonButton: {},
    IonButtons: {},
    IonLoading: {},
    IonSpinner: {},
    IonTitle: {},
    IonToolbar: {},
    IonInfiniteScroll: {},
    IonInfiniteScrollContent: {},
    IonText: {},
    IonFab: {},
    IonFabButton: {},
    IonFabList: {},
    IonIcon: {},
    IonRange: {},
    IonNote: {},
    IonGrid: {},
    IonRow: {},
    IonCol: {},
    IonBadge: {}
  };
});

vi.mock('ionicons', () => ({
  addIcons: vi.fn()
}));

vi.mock('ionicons/icons', () => ({
  search: {},
  logoGoogle: {},
  logoYoutube: {},
  star: {},
  starOutline: {}
}));

import { AlertController, ToastController } from '@ionic/angular/standalone';
import { ExplorePage } from './explore.page';
import { IgdbProxyService } from '../core/api/igdb-proxy.service';
import { PlatformCustomizationService } from '../core/services/platform-customization.service';
import { AddToLibraryWorkflowService } from '../features/game-search/add-to-library-workflow.service';
import { GameShelfService } from '../core/services/game-shelf.service';
import type { GameEntry } from '../core/models/game.models';

type PrivateExplorePage = ExplorePage & Record<string, unknown>;

function makeLibraryGame(overrides: Partial<GameEntry> = {}): GameEntry {
  return {
    igdbGameId: '123',
    title: 'Chrono Trigger',
    coverUrl: null,
    coverSource: 'none',
    platform: 'SNES',
    platformIgdbId: 130,
    releaseDate: null,
    releaseYear: 1995,
    listType: 'collection',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('ExplorePage rating modal', () => {
  let igdbProxyMock: {
    listPopularityTypes: ReturnType<typeof vi.fn>;
    listPopularityGames: ReturnType<typeof vi.fn>;
    getGameById: ReturnType<typeof vi.fn>;
  };
  let platformCustomizationMock: {
    getDisplayNameWithoutAlias: ReturnType<typeof vi.fn>;
  };
  let addToLibraryMock: {
    addToLibrary: ReturnType<typeof vi.fn>;
  };
  let alertControllerMock: {
    create: ReturnType<typeof vi.fn>;
  };
  let toastControllerMock: {
    create: ReturnType<typeof vi.fn>;
  };
  let gameShelfServiceMock: {
    setGameRating: ReturnType<typeof vi.fn>;
    setGameStatus: ReturnType<typeof vi.fn>;
    setGameTags: ReturnType<typeof vi.fn>;
    listTags: ReturnType<typeof vi.fn>;
    findGameByIdentity: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    igdbProxyMock = {
      listPopularityTypes: vi.fn().mockReturnValue(of([])),
      listPopularityGames: vi.fn().mockReturnValue(of([])),
      getGameById: vi.fn().mockReturnValue(of(null))
    };
    platformCustomizationMock = {
      getDisplayNameWithoutAlias: vi.fn((name: string) => name)
    };
    addToLibraryMock = {
      addToLibrary: vi.fn().mockResolvedValue({ status: 'added' })
    };
    alertControllerMock = {
      create: vi.fn()
    };
    toastControllerMock = {
      create: vi.fn().mockResolvedValue({ present: vi.fn().mockResolvedValue(undefined) })
    };
    gameShelfServiceMock = {
      setGameRating: vi.fn(),
      setGameStatus: vi.fn(),
      setGameTags: vi.fn(),
      listTags: vi.fn().mockResolvedValue([]),
      findGameByIdentity: vi.fn().mockResolvedValue(null)
    };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: IgdbProxyService,
          useValue: igdbProxyMock
        },
        {
          provide: PlatformCustomizationService,
          useValue: platformCustomizationMock
        },
        {
          provide: AddToLibraryWorkflowService,
          useValue: addToLibraryMock
        },
        {
          provide: GameShelfService,
          useValue: gameShelfServiceMock
        },
        {
          provide: AlertController,
          useValue: alertControllerMock
        },
        {
          provide: ToastController,
          useValue: toastControllerMock
        }
      ]
    });
  });

  function createPage(): PrivateExplorePage {
    return TestBed.runInInjectionContext(() => new ExplorePage()) as unknown as PrivateExplorePage;
  }

  it('opens rating modal with current game rating and resets clear state', () => {
    const page = createPage();
    page.selectedGameDetail = makeLibraryGame({ rating: 4.5 });
    page.clearRatingOnSave = true;
    page.isRatingModalOpen = false;
    page.ratingDraft = 1;

    page.openDetailRatingModal();

    expect(page.isRatingModalOpen).toBe(true);
    expect(page.ratingDraft).toBe(4.5);
    expect(page.clearRatingOnSave).toBe(false);
  });

  it('snaps slider values to half steps', () => {
    const page = createPage();
    page.ratingDraft = 3;
    page.clearRatingOnSave = true;

    page.onRatingRangeChange({
      detail: { value: 4.74 }
    } as unknown as Event);
    expect(page.ratingDraft).toBe(4.5);
    expect(page.clearRatingOnSave).toBe(false);

    page.onRatingRangeChange({
      detail: { value: 4.76 }
    } as unknown as Event);
    expect(page.ratingDraft).toBe(5);
  });

  it('saves rating from modal and closes it', async () => {
    const page = createPage();
    const selected = makeLibraryGame({ rating: 3 });
    const updated = makeLibraryGame({ rating: 3.5 });
    page.selectedGameDetail = selected;
    page.isRatingModalOpen = true;
    page.ratingDraft = 3.5;
    gameShelfServiceMock.setGameRating.mockResolvedValue(updated);

    await page.saveDetailRatingFromModal();

    expect(gameShelfServiceMock.setGameRating).toHaveBeenCalledWith('123', 130, 3.5);
    expect(page.selectedGameDetail).toEqual(updated);
    expect(page.isRatingModalOpen).toBe(false);
  });

  it('clears rating from modal when clear is marked', async () => {
    const page = createPage();
    const selected = makeLibraryGame({ rating: 4.5 });
    const updated = makeLibraryGame({ rating: null });
    page.selectedGameDetail = selected;
    page.isRatingModalOpen = true;
    page.ratingDraft = 4.5;
    page.markRatingForClear();
    gameShelfServiceMock.setGameRating.mockResolvedValue(updated);

    await page.saveDetailRatingFromModal();

    expect(gameShelfServiceMock.setGameRating).toHaveBeenCalledWith('123', 130, null);
    expect(page.selectedGameDetail).toEqual(updated);
    expect(page.isRatingModalOpen).toBe(false);
  });

  it('formats rating pin without trailing zeroes', () => {
    const page = createPage();

    expect(page.formatRatingPin(3.01)).toBe('3');
    expect(page.formatRatingPin(3.51)).toBe('3.5');
  });

  it('resets rating modal state when closing game detail modal', () => {
    const page = createPage();
    page.isGameDetailModalOpen = true;
    page.isRatingModalOpen = true;
    page.ratingDraft = 4.5;
    page.clearRatingOnSave = true;
    page.selectedGameDetail = makeLibraryGame();

    page.closeGameDetailModal();

    expect(page.isGameDetailModalOpen).toBe(false);
    expect(page.isRatingModalOpen).toBe(false);
    expect(page.ratingDraft).toBe(3);
    expect(page.clearRatingOnSave).toBe(false);
    expect(page.selectedGameDetail).toBeNull();
  });

  it('guards status/rating updates when selected detail is not a library entry', async () => {
    const page = createPage();
    page.selectedGameDetail = null;

    await page.onDetailStatusChange('playing');
    page.openDetailRatingModal();
    await page.saveDetailRatingFromModal();

    expect(gameShelfServiceMock.setGameStatus).not.toHaveBeenCalled();
    expect(gameShelfServiceMock.setGameRating).not.toHaveBeenCalled();
    expect(page.isRatingModalOpen).toBe(false);
  });

  it('ignores invalid range values and keeps draft unchanged', () => {
    const page = createPage();
    page.ratingDraft = 4;
    page.clearRatingOnSave = true;

    page.onRatingRangeChange({
      detail: { value: null }
    } as unknown as Event);

    expect(page.ratingDraft).toBe(4);
    expect(page.clearRatingOnSave).toBe(true);
  });

  it('handles detail status update failure', async () => {
    const page = createPage();
    page.selectedGameDetail = makeLibraryGame();
    gameShelfServiceMock.setGameStatus.mockRejectedValueOnce(new Error('down'));

    await page.onDetailStatusChange('playing');

    expect(gameShelfServiceMock.setGameStatus).toHaveBeenCalledWith('123', 130, 'playing');
  });

  it('clears status and reports success', async () => {
    const page = createPage();
    const updated = makeLibraryGame({ status: null });
    page.selectedGameDetail = makeLibraryGame({ status: 'playing' });
    gameShelfServiceMock.setGameStatus.mockResolvedValue(updated);

    await page.clearDetailStatus();

    expect(gameShelfServiceMock.setGameStatus).toHaveBeenCalledWith('123', 130, null);
    expect(page.selectedGameDetail).toEqual(updated);
  });

  it('supports tag update flow: no tags and then confirmed apply', async () => {
    const page = createPage();
    page.selectedGameDetail = makeLibraryGame({ tagIds: [1] });

    gameShelfServiceMock.listTags.mockResolvedValueOnce([]);
    await page.openDetailTags();
    expect(gameShelfServiceMock.setGameTags).not.toHaveBeenCalled();

    gameShelfServiceMock.listTags.mockResolvedValueOnce([
      { id: 1, name: 'Backlog', color: '#111111', createdAt: 'x', updatedAt: 'x' }
    ]);
    const updated = makeLibraryGame({ tagIds: [1] });
    gameShelfServiceMock.setGameTags.mockResolvedValue(updated);
    let applyHandler: ((value: string[] | string | null | undefined) => void) | null = null;
    alertControllerMock.create.mockImplementationOnce((options: Record<string, unknown>) => {
      const buttons = options['buttons'] as Array<Record<string, unknown>>;
      const applyButton = buttons.find((button) => button['role'] === 'confirm');
      applyHandler = applyButton?.['handler'] as
        | ((value: string[] | string | null | undefined) => void)
        | null;
      return {
        present: vi.fn().mockResolvedValue(undefined),
        onDidDismiss: vi.fn().mockResolvedValue({ role: 'confirm' })
      };
    });

    await page.openDetailTags();
    expect(applyHandler).not.toBeNull();
    applyHandler?.(['1']);

    expect(gameShelfServiceMock.setGameTags).toHaveBeenCalledWith('123', 130, [1]);
    expect(page.selectedGameDetail).toEqual(updated);
  });

  it('keeps modal open when saving rating fails', async () => {
    const page = createPage();
    page.selectedGameDetail = makeLibraryGame({ rating: 3 });
    page.isRatingModalOpen = true;
    page.ratingDraft = 3.5;
    gameShelfServiceMock.setGameRating.mockRejectedValueOnce(new Error('down'));

    await page.saveDetailRatingFromModal();

    expect(gameShelfServiceMock.setGameRating).toHaveBeenCalledWith('123', 130, 3.5);
    expect(page.isRatingModalOpen).toBe(true);
  });

  it('handles popularity selection parsing and load-more guard', async () => {
    const page = createPage();
    const loadGamesPageSpy = vi
      .spyOn(
        page as unknown as { loadGamesPage: (append: boolean) => Promise<void> },
        'loadGamesPage'
      )
      .mockResolvedValue(undefined);
    const completeSpy = vi.fn().mockResolvedValue(undefined);

    await page.onPopularityTypeChange('42');
    expect(page.selectedPopularityTypeId).toBe(42);
    expect(loadGamesPageSpy).toHaveBeenCalledWith(false);

    await page.onPopularityTypeChange('bad');
    expect(page.selectedPopularityTypeId).toBeNull();

    await page.loadMore({ target: { complete: completeSpy } } as unknown as Event);
    expect(completeSpy).toHaveBeenCalled();
  });

  it('formats platform labels for none/single/multiple platform games', () => {
    const page = createPage();
    const noPlatformItem = {
      game: {
        igdbGameId: '1',
        title: 'NoPlatform',
        coverUrl: null,
        coverSource: 'none',
        platform: '',
        platformIgdbId: 0,
        platforms: [],
        releaseDate: null,
        releaseYear: null
      }
    } as unknown as { game: GameEntry };
    expect(page.getPlatformLabel(noPlatformItem as unknown as never)).toBe('Unknown platform');

    const singlePlatformItem = {
      game: {
        ...makeLibraryGame(),
        platforms: ['SNES'],
        platformOptions: [{ id: 130, name: 'SNES' }]
      }
    } as unknown as never;
    expect(page.getPlatformLabel(singlePlatformItem)).toBe('SNES');

    const multiPlatformItem = {
      game: {
        ...makeLibraryGame(),
        platformOptions: [
          { id: 130, name: 'SNES' },
          { id: 6, name: 'PC' }
        ]
      }
    } as unknown as never;
    expect(page.getPlatformLabel(multiPlatformItem)).toBe('2 platforms');
  });

  it('builds external search URLs only when title is present', () => {
    const page = createPage();
    const openExternalUrlSpy = vi.spyOn(
      page as unknown as { openExternalUrl: (url: string) => void },
      'openExternalUrl'
    );

    page.selectedGameDetail = null;
    page.openShortcutSearch('google');
    expect(openExternalUrlSpy).not.toHaveBeenCalled();

    page.selectedGameDetail = makeLibraryGame({ title: 'Chrono Trigger' });
    page.openShortcutSearch('google');
    page.openShortcutSearch('youtube');
    page.openShortcutSearch('wikipedia');
    page.openShortcutSearch('gamefaqs');

    expect(openExternalUrlSpy).toHaveBeenNthCalledWith(
      1,
      'https://www.google.com/search?q=Chrono%20Trigger'
    );
    expect(openExternalUrlSpy).toHaveBeenNthCalledWith(
      2,
      'https://www.youtube.com/results?search_query=Chrono%20Trigger'
    );
    expect(openExternalUrlSpy).toHaveBeenNthCalledWith(
      3,
      'https://en.wikipedia.org/w/index.php?search=Chrono%20Trigger'
    );
    expect(openExternalUrlSpy).toHaveBeenNthCalledWith(
      4,
      'https://gamefaqs.gamespot.com/search?game=Chrono%20Trigger'
    );
  });
});
