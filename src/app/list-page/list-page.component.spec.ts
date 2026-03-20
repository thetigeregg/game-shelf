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
      'collection',
      { preferredPlatformIgdbId: 21 }
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

  it('keeps detail modal state unchanged when add-to-library is cancelled', async () => {
    const component = createComponent();
    const selectedDetail = makeResult();
    component.selectedAddGameDetail = selectedDetail;
    component.isAddGameDetailModalOpen = true;
    addToLibraryWorkflowMock.addToLibrary.mockResolvedValueOnce({ status: 'cancelled' });

    await component.addSelectedAddGameDetailToLibrary();

    expect(component.isAddGameDetailModalOpen).toBe(true);
    expect(component.selectedAddGameDetail).toBe(selectedDetail);
    expect(component.isAddGameDetailInLibrary).toBe(false);
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

  it('ignores stale add-game detail errors after the modal closes', async () => {
    const component = createComponent();
    const result = makeResult();
    let rejectExistingEntry: (error: unknown) => void = () => undefined;
    let failHydratedCatalog: (() => void) | null = null;

    gameShelfServiceMock.findGameByIdentity.mockReturnValueOnce(
      new Promise<{ id: number } | null>((_, reject) => {
        rejectExistingEntry = reject;
      })
    );
    igdbProxyServiceMock.getGameById.mockReturnValueOnce(
      new Observable<GameCatalogResult | null>((subscriber) => {
        failHydratedCatalog = () => {
          subscriber.error(new Error('late boom'));
        };
      })
    );

    const pendingRequest = component.openAddGameDetail(result);
    component.closeAddGameDetailModal();
    rejectExistingEntry(new Error('identity failed'));
    failHydratedCatalog?.();
    await pendingRequest;

    expect(component.isAddGameDetailModalOpen).toBe(false);
    expect(component.selectedAddGameDetail).toBeNull();
    expect(component.addGameDetailErrorMessage).toBe('');
    expect(component.isAddGameDetailLoading).toBe(false);
  });

  it('falls back to a generic detail error message for non-Error failures', async () => {
    const component = createComponent();
    const result = makeResult();

    gameShelfServiceMock.findGameByIdentity.mockResolvedValueOnce(null);
    igdbProxyServiceMock.getGameById.mockReturnValueOnce(throwError(() => 'bad payload'));

    await component.openAddGameDetail(result);

    expect(component.addGameDetailErrorMessage).toBe('Unable to load game details.');
    expect(component.isAddGameDetailLoading).toBe(false);
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
});
