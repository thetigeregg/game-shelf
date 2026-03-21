import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ionic/angular/standalone', () => {
  const Dummy = () => null;
  const AlertControllerToken = function AlertController() {
    return undefined;
  };
  const MenuControllerToken = function MenuController() {
    return undefined;
  };
  const PopoverControllerToken = function PopoverController() {
    return undefined;
  };
  const ToastControllerToken = function ToastController() {
    return undefined;
  };

  return {
    AlertController: AlertControllerToken,
    MenuController: MenuControllerToken,
    PopoverController: PopoverControllerToken,
    ToastController: ToastControllerToken,
    IonHeader: Dummy,
    IonToolbar: Dummy,
    IonButtons: Dummy,
    IonButton: Dummy,
    IonIcon: Dummy,
    IonTitle: Dummy,
    IonSearchbar: Dummy,
    IonContent: Dummy,
    IonPopover: Dummy,
    IonList: Dummy,
    IonItem: Dummy,
    IonModal: Dummy,
    IonBadge: Dummy,
    IonLoading: Dummy,
    IonFab: Dummy,
    IonFabButton: Dummy,
    IonFabList: Dummy,
    IonSplitPane: Dummy,
    IonText: Dummy,
  };
});
vi.mock('../features/game-list/game-list.component', () => ({
  GameListComponent: () => null,
}));
vi.mock('../features/game-search/game-search.component', () => ({
  GameSearchComponent: () => null,
}));
vi.mock('../features/game-filters-menu/game-filters-menu.component', () => ({
  GameFiltersMenuComponent: () => null,
}));
vi.mock('../features/game-detail/game-detail-content.component', () => ({
  GameDetailContentComponent: () => null,
}));
vi.mock('../features/game-detail/detail-shortcuts-fab.component', () => ({
  DetailShortcutsFabComponent: () => null,
}));
vi.mock('../features/game-detail/detail-videos-modal.component', () => ({
  DetailVideosModalComponent: () => null,
}));
vi.mock('../features/game-detail/detail-websites-modal.component', () => ({
  DetailWebsitesModalComponent: () => null,
}));

import { ListPageComponent } from './list-page.component';
import { IgdbProxyService } from '../core/api/igdb-proxy.service';
import { GameShelfService } from '../core/services/game-shelf.service';
import { LayoutModeService } from '../core/services/layout-mode.service';
import { AddToLibraryWorkflowService } from '../features/game-search/add-to-library-workflow.service';
import { DEFAULT_GAME_LIST_FILTERS, type GameCatalogResult } from '../core/models/game.models';
import {
  AlertController,
  MenuController,
  PopoverController,
  ToastController,
} from '@ionic/angular/standalone';
import { serializeListPagePreferences } from './list-page-preferences';

describe('ListPageComponent', () => {
  const gameShelfServiceMock = {
    watchList: vi.fn(() => of([])),
    findGameByIdentity: vi.fn(),
    getView: vi.fn(),
  };
  const igdbProxyServiceMock = {
    getGameById: vi.fn(),
  };
  const layoutModeServiceMock = {
    mode$: of<'mobile' | 'desktop'>('mobile'),
  };
  const routerMock = {
    navigate: vi.fn().mockResolvedValue(true),
  };
  const routeMock = {
    snapshot: { data: { listType: 'collection' } },
    queryParamMap: of(convertToParamMap({})),
  };
  const addToLibraryWorkflowMock = {
    addToLibrary: vi.fn(),
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    gameShelfServiceMock.watchList.mockReturnValue(of([]));
    gameShelfServiceMock.findGameByIdentity.mockResolvedValue(null);
    gameShelfServiceMock.getView.mockResolvedValue(null);
    igdbProxyServiceMock.getGameById.mockReturnValue(of(null));
    addToLibraryWorkflowMock.addToLibrary.mockResolvedValue({ status: 'added' });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: GameShelfService, useValue: gameShelfServiceMock },
        { provide: IgdbProxyService, useValue: igdbProxyServiceMock },
        { provide: LayoutModeService, useValue: layoutModeServiceMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: routeMock },
        { provide: AddToLibraryWorkflowService, useValue: addToLibraryWorkflowMock },
        { provide: AlertController, useValue: { create: vi.fn() } },
        { provide: MenuController, useValue: { open: vi.fn() } },
        { provide: PopoverController, useValue: { dismiss: vi.fn().mockResolvedValue(undefined) } },
        { provide: ToastController, useValue: { create: vi.fn() } },
      ],
    });
  });

  function createComponent(): ListPageComponent {
    return TestBed.runInInjectionContext(() => new ListPageComponent());
  }

  function makeResult(overrides: Partial<GameCatalogResult> = {}): GameCatalogResult {
    return {
      igdbGameId: '100',
      title: 'Metroid Prime',
      coverUrl: null,
      coverSource: 'igdb',
      platforms: ['GameCube'],
      platformOptions: [{ id: 21, name: 'GameCube' }],
      platform: 'GameCube',
      platformIgdbId: 21,
      releaseDate: '2002-11-17T00:00:00.000Z',
      releaseYear: 2002,
      ...overrides,
    };
  }

  async function flushAsync(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('clears loading immediately when detail hydration fails before identity lookup resolves', async () => {
    const component = createComponent();
    const result = makeResult();
    let resolveExistingEntry: (value: { id: number } | null) => void = () => undefined;
    const existingEntryPromise = new Promise<{ id: number } | null>((resolve) => {
      resolveExistingEntry = resolve;
    });

    gameShelfServiceMock.findGameByIdentity.mockReturnValueOnce(existingEntryPromise);
    igdbProxyServiceMock.getGameById.mockReturnValueOnce(throwError(() => new Error('boom')));

    await component.openAddGameDetail(result);

    expect(component.isAddGameDetailLoading).toBe(false);
    expect(component.addGameDetailErrorMessage).toBe('boom');
    expect(component.isAddGameDetailInLibrary).toBe(false);

    resolveExistingEntry({ id: 42 });
    await flushAsync();

    expect(component.isAddGameDetailLoading).toBe(false);
    expect(component.isAddGameDetailInLibrary).toBe(true);
  });

  it('loads add-game detail data and tracks library state on success', async () => {
    const component = createComponent();
    const result = makeResult();
    const hydratedCatalog = makeResult({
      platform: null,
      platformIgdbId: null,
      platformOptions: [
        { id: 21, name: 'GameCube' },
        { id: 167, name: 'Nintendo Wii U' },
      ],
    });

    gameShelfServiceMock.findGameByIdentity.mockResolvedValueOnce({ id: 7 });
    igdbProxyServiceMock.getGameById.mockReturnValueOnce(of(hydratedCatalog));

    await component.openAddGameDetail(result);

    expect(gameShelfServiceMock.findGameByIdentity).toHaveBeenCalledWith('100', 21);
    expect(igdbProxyServiceMock.getGameById).toHaveBeenCalledWith('100');
    expect(component.isAddGameDetailModalOpen).toBe(true);
    expect(component.isAddGameDetailLoading).toBe(false);
    expect(component.addGameDetailErrorMessage).toBe('');
    expect(component.isAddGameDetailInLibrary).toBe(true);
    expect(component.selectedAddGameDetail).toEqual({
      ...hydratedCatalog,
      platform: 'GameCube',
      platformIgdbId: 21,
    });
  });

  it('reports missing platform selection before requesting hydrated detail data', async () => {
    const component = createComponent();
    const result = makeResult({ platformIgdbId: null, platform: null });

    await component.openAddGameDetail(result);

    expect(gameShelfServiceMock.findGameByIdentity).not.toHaveBeenCalled();
    expect(igdbProxyServiceMock.getGameById).not.toHaveBeenCalled();
    expect(component.isAddGameDetailLoading).toBe(false);
    expect(component.addGameDetailErrorMessage).toBe('Platform selection is required.');
    expect(component.isAddGameDetailModalOpen).toBe(true);
  });

  it('ignores stale add-game detail responses after the modal closes', async () => {
    const component = createComponent();
    const result = makeResult();
    let resolveExistingEntry: (value: { id: number } | null) => void = () => undefined;
    let emitHydratedCatalog: ((value: GameCatalogResult | null) => void) | null = null;

    gameShelfServiceMock.findGameByIdentity.mockReturnValueOnce(
      new Promise<{ id: number } | null>((resolve) => {
        resolveExistingEntry = resolve;
      })
    );
    igdbProxyServiceMock.getGameById.mockReturnValueOnce(
      new Observable<GameCatalogResult | null>((subscriber) => {
        emitHydratedCatalog = (value) => {
          subscriber.next(value);
          subscriber.complete();
        };
      })
    );

    const pendingRequest = component.openAddGameDetail(result);
    component.closeAddGameDetailModal();
    resolveExistingEntry({ id: 42 });
    emitHydratedCatalog?.(makeResult({ title: 'Hydrated Title' }));
    await pendingRequest;

    expect(component.isAddGameDetailModalOpen).toBe(false);
    expect(component.selectedAddGameDetail).toBeNull();
    expect(component.isAddGameDetailLoading).toBe(false);
    expect(component.isAddGameDetailInLibrary).toBe(false);
  });

  it('adds the selected detail result to the library and closes the detail modal when added', async () => {
    const component = createComponent();
    const selectedDetail = makeResult();
    component.selectedAddGameDetail = selectedDetail;
    component.isAddGameDetailModalOpen = true;

    await component.addSelectedAddGameDetailToLibrary();

    expect(addToLibraryWorkflowMock.addToLibrary).toHaveBeenCalledWith(
      selectedDetail,
      'collection'
    );
    expect(component.isAddGameDetailModalOpen).toBe(false);
    expect(component.selectedAddGameDetail).toBeNull();
    expect(component.isAddGameDetailInLibrary).toBe(false);
    expect(component.isAddGameDetailAddLoading).toBe(false);
  });

  it('keeps the detail modal open when add-to-library resolves as duplicate', async () => {
    const component = createComponent();
    const selectedDetail = makeResult();
    component.selectedAddGameDetail = selectedDetail;
    component.isAddGameDetailModalOpen = true;
    addToLibraryWorkflowMock.addToLibrary.mockResolvedValueOnce({ status: 'duplicate' });

    await component.addSelectedAddGameDetailToLibrary();

    expect(component.isAddGameDetailModalOpen).toBe(true);
    expect(component.selectedAddGameDetail).toBe(selectedDetail);
    expect(component.isAddGameDetailInLibrary).toBe(true);
    expect(component.isAddGameDetailAddLoading).toBe(false);
  });

  it('returns early from add-to-library when there is nothing to add or the entry is already in library', async () => {
    const component = createComponent();

    await component.addSelectedAddGameDetailToLibrary();
    component.selectedAddGameDetail = makeResult();
    component.isAddGameDetailInLibrary = true;
    await component.addSelectedAddGameDetailToLibrary();

    expect(addToLibraryWorkflowMock.addToLibrary).not.toHaveBeenCalled();
  });

  it('opens the expected external shortcut URLs for the selected add-game detail', () => {
    const component = createComponent();
    const openedWindow = { opener: {} } as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(openedWindow);
    component.selectedAddGameDetail = makeResult({ title: 'Metroid Prime' });

    component.openAddGameDetailShortcutSearch('google');
    component.openAddGameDetailShortcutSearch('youtube');
    component.openAddGameDetailShortcutSearch('wikipedia');
    component.openAddGameDetailShortcutSearch('gamefaqs');

    expect(openSpy).toHaveBeenNthCalledWith(
      1,
      'https://www.google.com/search?q=Metroid%20Prime',
      '_blank',
      'noopener,noreferrer'
    );
    expect(openSpy).toHaveBeenNthCalledWith(
      2,
      'https://www.youtube.com/results?search_query=Metroid%20Prime',
      '_blank',
      'noopener,noreferrer'
    );
    expect(openSpy).toHaveBeenNthCalledWith(
      3,
      'https://en.wikipedia.org/w/index.php?search=Metroid%20Prime',
      '_blank',
      'noopener,noreferrer'
    );
    expect(openSpy).toHaveBeenNthCalledWith(
      4,
      'https://gamefaqs.gamespot.com/search?game=Metroid%20Prime',
      '_blank',
      'noopener,noreferrer'
    );
    expect(openedWindow.opener).toBeNull();
  });

  it('skips external shortcut opening when the selected title is blank', () => {
    const component = createComponent();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    component.selectedAddGameDetail = makeResult({ title: '   ' });

    component.openAddGameDetailShortcutSearch('google');

    expect(openSpy).not.toHaveBeenCalled();
  });

  it('toggles the add-game videos modal only when a valid YouTube video is present', () => {
    const component = createComponent();

    component.selectedAddGameDetail = makeResult({
      videos: [{ name: 'Trailer', videoId: 'dQw4w9WgXcQ' }],
    });

    expect(component.addGameDetailVideos).toEqual([{ name: 'Trailer', videoId: 'dQw4w9WgXcQ' }]);
    expect(component.hasAddGameDetailVideosShortcut).toBe(true);

    component.openAddGameVideosModal();
    expect(component.isAddGameVideosModalOpen).toBe(true);

    component.closeAddGameVideosModal();
    expect(component.isAddGameVideosModalOpen).toBe(false);

    component.selectedAddGameDetail = makeResult({
      videos: [{ name: 'Broken', videoId: 'bad id' }],
    });

    expect(component.hasAddGameDetailVideosShortcut).toBe(false);

    component.openAddGameVideosModal();
    expect(component.isAddGameVideosModalOpen).toBe(false);
  });

  it('closes both add-game modals and resets nested detail state', () => {
    const component = createComponent();
    component.isAddGameModalOpen = true;
    component.isAddGameDetailModalOpen = true;
    component.selectedAddGameDetail = makeResult();
    component.isAddGameDetailLoading = true;
    component.addGameDetailErrorMessage = 'failed';
    component.isAddGameDetailInLibrary = true;
    component.isAddGameDetailAddLoading = true;
    component.isAddGameVideosModalOpen = true;

    component.closeAddGameModal();

    expect(component.isAddGameModalOpen).toBe(false);
    expect(component.isAddGameDetailModalOpen).toBe(false);
    expect(component.selectedAddGameDetail).toBeNull();
    expect(component.isAddGameDetailLoading).toBe(false);
    expect(component.addGameDetailErrorMessage).toBe('');
    expect(component.isAddGameDetailInLibrary).toBe(false);
    expect(component.isAddGameDetailAddLoading).toBe(false);
    expect(component.isAddGameVideosModalOpen).toBe(false);
  });

  it('opens filters only on mobile layouts', async () => {
    const component = createComponent();
    const menuController = (
      component as unknown as {
        menuController: {
          open(menuId: string): Promise<void> | void;
        };
      }
    ).menuController;
    const menuOpenSpy = vi.spyOn(menuController, 'open');

    await component.openFiltersMenu();
    component.isDesktop = true;
    await component.openFiltersMenu();

    expect(menuOpenSpy).toHaveBeenCalledOnce();
    expect(menuOpenSpy).toHaveBeenCalledWith('collection-filters-menu');
  });

  it('applies a stored view from the query param and clears the query state afterwards', async () => {
    const component = createComponent();
    const navigateSpy = vi.spyOn(routerMock, 'navigate');
    const persistedFilters = {
      ...DEFAULT_GAME_LIST_FILTERS,
      platform: ['GameCube'],
      statuses: ['playing'],
    };

    component.listSearchQuery = 'active';
    component.listSearchQueryInput = 'active';
    gameShelfServiceMock.getView.mockResolvedValueOnce({
      id: 9,
      listType: 'collection',
      filters: persistedFilters,
      groupBy: 'platform',
    });

    await (
      component as { applyViewFromQueryParam(rawViewId: string | null): Promise<void> }
    ).applyViewFromQueryParam('9');

    expect(component.filters.platform).toEqual(['GameCube']);
    expect(component.filters.statuses).toEqual(['playing']);
    expect(component.groupBy).toBe('platform');
    expect(component.listSearchQuery).toBe('');
    expect(component.listSearchQueryInput).toBe('');
    expect(navigateSpy).toHaveBeenCalledWith([], {
      relativeTo: routeMock,
      queryParams: { applyView: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });

  it('ignores invalid or incompatible stored views', async () => {
    const component = createComponent();
    const navigateSpy = vi.spyOn(routerMock, 'navigate');

    await (
      component as { applyViewFromQueryParam(rawViewId: string | null): Promise<void> }
    ).applyViewFromQueryParam('0');
    expect(gameShelfServiceMock.getView).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();

    gameShelfServiceMock.getView.mockResolvedValueOnce({
      id: 5,
      listType: 'wishlist',
      filters: DEFAULT_GAME_LIST_FILTERS,
      groupBy: 'platform',
    });
    await (
      component as { applyViewFromQueryParam(rawViewId: string | null): Promise<void> }
    ).applyViewFromQueryParam('5');

    expect(navigateSpy).toHaveBeenCalledOnce();
  });

  it('dispatches bulk external metadata refreshes to the correct game-list action', async () => {
    const component = createComponent();
    const gameListComponentMock = {
      refreshMetadataForSelectedGames: vi.fn().mockResolvedValue(undefined),
      updateHltbForSelectedGames: vi.fn().mockResolvedValue(undefined),
      updateReviewForSelectedGames: vi.fn().mockResolvedValue(undefined),
      updatePricingForSelectedGames: vi.fn().mockResolvedValue(undefined),
    };

    (component as { gameListComponent: unknown }).gameListComponent = gameListComponentMock;

    await (
      component as {
        refreshSelectedExternalMetadataProvider(
          provider: 'igdb' | 'hltb' | 'review' | 'pricing'
        ): Promise<void>;
      }
    ).refreshSelectedExternalMetadataProvider('igdb');
    await (
      component as {
        refreshSelectedExternalMetadataProvider(
          provider: 'igdb' | 'hltb' | 'review' | 'pricing'
        ): Promise<void>;
      }
    ).refreshSelectedExternalMetadataProvider('hltb');
    await (
      component as {
        refreshSelectedExternalMetadataProvider(
          provider: 'igdb' | 'hltb' | 'review' | 'pricing'
        ): Promise<void>;
      }
    ).refreshSelectedExternalMetadataProvider('review');
    await (
      component as {
        refreshSelectedExternalMetadataProvider(
          provider: 'igdb' | 'hltb' | 'review' | 'pricing'
        ): Promise<void>;
      }
    ).refreshSelectedExternalMetadataProvider('pricing');

    expect(gameListComponentMock.refreshMetadataForSelectedGames).toHaveBeenCalledOnce();
    expect(gameListComponentMock.updateHltbForSelectedGames).toHaveBeenCalledOnce();
    expect(gameListComponentMock.updateReviewForSelectedGames).toHaveBeenCalledOnce();
    expect(gameListComponentMock.updatePricingForSelectedGames).toHaveBeenCalledOnce();
  });

  it('normalizes allowed bulk metadata providers and rejects unsupported pricing values', () => {
    const component = createComponent();
    const normalizeProvider = (value: unknown, includePricing: boolean) =>
      (
        component as {
          normalizeBulkExternalMetadataProvider(
            candidate: unknown,
            allowPricing: boolean
          ): 'igdb' | 'hltb' | 'review' | 'pricing' | null;
        }
      ).normalizeBulkExternalMetadataProvider(value, includePricing);

    expect(normalizeProvider('igdb', false)).toBe('igdb');
    expect(normalizeProvider('hltb', false)).toBe('hltb');
    expect(normalizeProvider('review', false)).toBe('review');
    expect(normalizeProvider('pricing', true)).toBe('pricing');
    expect(normalizeProvider('pricing', false)).toBeNull();
    expect(normalizeProvider('other', true)).toBeNull();
  });

  it('normalizes incoming filters and persists the cleaned preferences', () => {
    const component = createComponent();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    component.onFiltersChange({
      ...DEFAULT_GAME_LIST_FILTERS,
      platform: ['  GameCube  ', '', 'GameCube'],
      collections: [' Prime ', ''],
      developers: [' Retro Studios ', ''],
      franchises: [' Metroid ', ''],
      publishers: [' Nintendo ', ''],
      gameTypes: ['main_game', 'invalid' as never],
      genres: [' Action ', ''],
      statuses: ['playing', 'none'],
      tags: ['favorite', component.noneTagFilterValue],
      excludedPlatform: [' Wii ', ''],
      excludedGenres: [' Shooter ', ''],
      excludedStatuses: ['completed', 'none'],
      excludedTags: ['backlog', component.noneTagFilterValue],
      excludedGameTypes: ['dlc_addon', 'invalid' as never],
      ratings: [4, 9 as never],
      hltbMainHoursMin: 20,
      hltbMainHoursMax: 5,
      sortField: 'not-real' as never,
      sortDirection: 'sideways' as never,
    });

    expect(component.filters).toMatchObject({
      platform: ['GameCube'],
      collections: ['Prime'],
      developers: ['Retro Studios'],
      franchises: ['Metroid'],
      publishers: ['Nintendo'],
      gameTypes: ['main_game'],
      genres: ['Action'],
      statuses: ['playing', 'none'],
      tags: [component.noneTagFilterValue, 'favorite'],
      excludedPlatform: ['Wii'],
      excludedGenres: ['Shooter'],
      excludedStatuses: ['completed'],
      excludedTags: ['backlog'],
      excludedGameTypes: ['dlc_addon'],
      ratings: [4],
      hltbMainHoursMin: 5,
      hltbMainHoursMax: 20,
      sortField: DEFAULT_GAME_LIST_FILTERS.sortField,
      sortDirection: 'asc',
    });
    expect(setItemSpy).toHaveBeenCalledOnce();
  });

  it('accepts supported sort fields including wishlist price sorting', () => {
    routeMock.snapshot.data.listType = 'wishlist';
    const component = createComponent();

    component.onFiltersChange({
      ...DEFAULT_GAME_LIST_FILTERS,
      sortField: 'price',
      sortDirection: 'desc',
    });

    expect(component.filters.sortField).toBe('price');
    expect(component.filters.sortDirection).toBe('desc');
    routeMock.snapshot.data.listType = 'collection';
  });

  it('trims invalid option selections when platform, genre, and collection options change', () => {
    const component = createComponent();
    component.filters = {
      ...DEFAULT_GAME_LIST_FILTERS,
      platform: ['GameCube', 'Wii'],
      excludedPlatform: ['Switch'],
      genres: ['Action', 'Puzzle'],
      excludedGenres: ['Shooter'],
      collections: ['Prime', 'Fusion'],
    };

    component.onPlatformOptionsChange(['GameCube']);
    component.onGenreOptionsChange(['Action']);
    component.onCollectionOptionsChange(['Prime']);

    expect(component.filters.platform).toEqual(['GameCube']);
    expect(component.filters.excludedPlatform).toEqual([]);
    expect(component.filters.genres).toEqual(['Action']);
    expect(component.filters.excludedGenres).toEqual([]);
    expect(component.filters.collections).toEqual(['Prime']);
  });

  it('closes popovers and tolerates dismiss failures', async () => {
    const component = createComponent();
    const popoverController = (
      component as unknown as {
        popoverController: { dismiss: () => Promise<void> };
      }
    ).popoverController;

    component.bulkActionsPopoverEvent = new Event('click');
    component.isBulkActionsPopoverOpen = true;
    component.headerActionsPopoverEvent = new Event('click');
    component.isHeaderActionsPopoverOpen = true;
    vi.spyOn(popoverController, 'dismiss').mockRejectedValueOnce(new Error('dismiss failed'));

    component.closeBulkActionsPopover();
    await component.closeHeaderActionsPopover();

    expect(component.isBulkActionsPopoverOpen).toBe(false);
    expect(component.bulkActionsPopoverEvent).toBeUndefined();
    expect(component.isHeaderActionsPopoverOpen).toBe(false);
    expect(component.headerActionsPopoverEvent).toBeUndefined();
  });

  it('opens popovers and normalizes group-by selections before persisting', () => {
    const component = createComponent();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const bulkEvent = new Event('click');
    const headerEvent = new Event('contextmenu');

    component.openBulkActionsPopover(bulkEvent);
    component.openHeaderActionsPopover(headerEvent);
    component.onGroupByChange('platform');
    component.onGroupByChange('not-real' as never);

    expect(component.bulkActionsPopoverEvent).toBe(bulkEvent);
    expect(component.isBulkActionsPopoverOpen).toBe(true);
    expect(component.headerActionsPopoverEvent).toBe(headerEvent);
    expect(component.isHeaderActionsPopoverOpen).toBe(true);
    expect(component.groupBy).toBe('none');
    expect(setItemSpy).toHaveBeenCalledTimes(2);
  });

  it('restores persisted preferences and ignores storage failures', () => {
    const storedValue = serializeListPagePreferences({
      filters: {
        ...DEFAULT_GAME_LIST_FILTERS,
        platform: ['GameCube'],
        sortField: 'platform',
      },
      groupBy: 'platform',
    });

    localStorage.setItem('game-shelf:preferences:collection', storedValue);
    const restoredComponent = createComponent();

    expect(restoredComponent.filters.platform).toEqual(['GameCube']);
    expect(restoredComponent.groupBy).toBe('platform');

    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('storage unavailable');
    });
    const fallbackComponent = createComponent();

    expect(fallbackComponent.filters).toEqual(DEFAULT_GAME_LIST_FILTERS);
    expect(fallbackComponent.groupBy).toBe('none');
    localStorage.removeItem('game-shelf:preferences:collection');
  });

  it('returns display labels and tracks requested add-game detail identities', () => {
    const component = createComponent();
    component.displayedGames = [{ id: 1 } as never];

    expect(component.getDisplayedGamesLabel()).toBe('1 game');
    expect(component.getListCountSummary()).toBe('1 game');

    component.displayedGames = [{ id: 1 } as never, { id: 2 } as never];

    expect(component.getDisplayedGamesLabel()).toBe('2 games');
    expect(component.getListCountSummary()).toBe('2 games');
    expect(
      (
        component as {
          buildCatalogIdentityKey(
            result: Pick<GameCatalogResult, 'igdbGameId' | 'platformIgdbId'>
          ): string;
        }
      ).buildCatalogIdentityKey(makeResult({ platformIgdbId: null }))
    ).toBe('100::none');

    component.selectedAddGameDetail = makeResult({ igdbGameId: '100', platformIgdbId: 21 });
    expect(
      (
        component as {
          hasRequestedAddGameDetail(identityKey: string): boolean;
        }
      ).hasRequestedAddGameDetail('100::21')
    ).toBe(true);
    expect(
      (
        component as {
          hasRequestedAddGameDetail(identityKey: string): boolean;
        }
      ).hasRequestedAddGameDetail('100::999')
    ).toBe(false);

    component.selectedAddGameDetail = null;
    expect(
      (
        component as {
          hasRequestedAddGameDetail(identityKey: string): boolean;
        }
      ).hasRequestedAddGameDetail('100::21')
    ).toBe(false);
  });

  it('creates toasts and swallows storage write failures', async () => {
    const component = createComponent();
    const toastController = (
      component as unknown as {
        toastController: { create: ReturnType<typeof vi.fn> };
      }
    ).toastController;
    const toast = { present: vi.fn().mockResolvedValue(undefined) };
    toastController.create = vi.fn().mockResolvedValue(toast);

    await (
      component as {
        presentToast(message: string, color?: 'primary' | 'warning'): Promise<void>;
      }
    ).presentToast('Saved filters', 'warning');

    expect(toastController.create).toHaveBeenCalledWith({
      message: 'Saved filters',
      duration: 1500,
      position: 'bottom',
      color: 'warning',
    });
    expect(toast.present).toHaveBeenCalledOnce();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });

    expect(() => {
      component.onGroupByChange('platform');
    }).not.toThrow();
  });

  it('counts active filters and formats selection/header labels', () => {
    routeMock.snapshot.data.listType = 'wishlist';
    const component = createComponent();
    component.selectedGamesCount = 2;
    component.filters = {
      ...DEFAULT_GAME_LIST_FILTERS,
      platform: ['GameCube'],
      genres: ['Action'],
      collections: ['Prime'],
      developers: ['Retro Studios'],
      franchises: ['Metroid'],
      publishers: ['Nintendo'],
      gameTypes: ['main_game'],
      tags: ['favorite'],
      statuses: ['playing'],
      excludedPlatform: ['Wii'],
      excludedTags: ['backlog'],
      excludedGenres: ['Shooter'],
      excludedStatuses: ['completed'],
      excludedGameTypes: ['dlc_addon'],
      ratings: [4],
      hltbMainHoursMin: 1,
      hltbMainHoursMax: null,
      releaseDateFrom: '2002-11-17',
      releaseDateTo: null,
    };

    expect(component.getActiveFilterCount()).toBe(17);
    expect(component.getSelectionHeaderLabel()).toBe('2 selected');
    expect(component.getMoveTargetLabel()).toBe('Collection');
    expect(component.getHeaderActionsAriaLabel()).toBe('Open wishlist actions');
    routeMock.snapshot.data.listType = 'collection';
  });

  it('closes header actions before picking a random game and warns when none are displayed', async () => {
    const component = createComponent();
    const toastController = (
      component as unknown as {
        toastController: { create: ReturnType<typeof vi.fn> };
      }
    ).toastController;
    const toast = { present: vi.fn().mockResolvedValue(undefined) };
    const gameListComponentMock = { openGameDetail: vi.fn() };
    toastController.create = vi.fn().mockResolvedValue(toast);
    (component as { gameListComponent: unknown }).gameListComponent = gameListComponentMock;

    component.headerActionsPopoverEvent = new Event('click');
    component.isHeaderActionsPopoverOpen = true;
    await component.pickRandomGameFromPopover();

    expect(toastController.create).toHaveBeenCalledWith({
      message: 'No games available in current results.',
      duration: 1500,
      position: 'bottom',
      color: 'warning',
    });
    expect(gameListComponentMock.openGameDetail).not.toHaveBeenCalled();
    expect(component.isHeaderActionsPopoverOpen).toBe(false);

    component.displayedGames = [{ id: 1, title: 'Metroid Prime' } as never];
    vi.spyOn(Math, 'random').mockReturnValueOnce(0);
    await component.pickRandomGameFromPopover();

    expect(gameListComponentMock.openGameDetail).toHaveBeenCalledWith(component.displayedGames[0]);
  });
});
