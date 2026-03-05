import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { AlertController, ToastController } from '@ionic/angular/standalone';
import { ExplorePage } from './explore.page';
import { IgdbProxyService } from '../core/api/igdb-proxy.service';
import { PlatformCustomizationService } from '../core/services/platform-customization.service';
import { AddToLibraryWorkflowService } from '../features/game-search/add-to-library-workflow.service';
import { GameShelfService } from '../core/services/game-shelf.service';

vi.mock('@ionic/angular/standalone', () => {
  const Dummy = () => null;
  const AlertControllerToken = function AlertController() {
    return undefined;
  };
  const ToastControllerToken = function ToastController() {
    return undefined;
  };
  return {
    AlertController: AlertControllerToken,
    ToastController: ToastControllerToken,
    IonContent: Dummy,
    IonHeader: Dummy,
    IonItem: Dummy,
    IonLabel: Dummy,
    IonList: Dummy,
    IonListHeader: Dummy,
    IonModal: Dummy,
    IonSelect: Dummy,
    IonSelectOption: Dummy,
    IonButton: Dummy,
    IonButtons: Dummy,
    IonLoading: Dummy,
    IonSpinner: Dummy,
    IonTitle: Dummy,
    IonToolbar: Dummy,
    IonText: Dummy,
    IonFab: Dummy,
    IonFabButton: Dummy,
    IonFabList: Dummy,
    IonIcon: Dummy,
    IonRange: Dummy,
    IonNote: Dummy,
    IonRefresher: Dummy,
    IonRefresherContent: Dummy,
    IonInfiniteScroll: Dummy,
    IonInfiniteScrollContent: Dummy,
    IonBadge: Dummy,
    IonAccordion: Dummy,
    IonAccordionGroup: Dummy,
    IonCard: Dummy,
    IonCardHeader: Dummy,
    IonCardTitle: Dummy
  };
});
vi.mock('../features/game-detail/game-detail-content.component', () => ({
  GameDetailContentComponent: () => null
}));

const mockLanesResponse = {
  target: 'BACKLOG' as const,
  runtimeMode: 'NEUTRAL' as const,
  runId: 1,
  generatedAt: '2026-03-03T12:00:00.000Z',
  lanes: {
    overall: [
      {
        rank: 1,
        igdbGameId: '100',
        platformIgdbId: 6,
        scoreTotal: 1.25,
        scoreComponents: {
          taste: 1,
          novelty: 0,
          runtimeFit: 0,
          criticBoost: 0,
          recencyBoost: 0,
          semantic: 0,
          exploration: 0,
          diversityPenalty: 0,
          repeatPenalty: 0
        },
        explanations: {
          headline: 'Fits your profile',
          bullets: [],
          matchedTokens: {
            genres: [],
            developers: [],
            publishers: [],
            franchises: [],
            collections: [],
            themes: [],
            keywords: []
          }
        }
      }
    ],
    hiddenGems: [],
    exploration: [],
    blended: [],
    popular: [],
    recent: []
  }
};

describe('ExplorePage recommendations UX', () => {
  const igdbProxyServiceMock = {
    getRecommendationLanes: vi.fn(),
    rebuildRecommendations: vi.fn(),
    getGameById: vi.fn(),
    getRecommendationSimilar: vi.fn()
  };

  const platformCustomizationMock = {
    getDisplayNameWithoutAlias: vi.fn((name: string) => name)
  };

  const addToLibraryWorkflowMock = {
    addToLibrary: vi.fn()
  };

  const gameShelfServiceMock = {
    listLibraryGames: vi.fn().mockResolvedValue([
      {
        id: 1,
        igdbGameId: '100',
        title: 'Cached Local Title',
        notes: null,
        customTitle: null,
        coverUrl: 'https://example.com/local-cover.jpg',
        customCoverUrl: null,
        coverSource: 'none',
        platform: 'PC (Microsoft Windows)',
        platformIgdbId: 6,
        releaseDate: null,
        releaseYear: 2020,
        status: 'wantToPlay',
        rating: null,
        listType: 'collection',
        createdAt: '2026-03-03T00:00:00.000Z',
        updatedAt: '2026-03-03T00:00:00.000Z'
      }
    ]),
    findGameByIdentity: vi.fn().mockResolvedValue(null),
    setGameStatus: vi.fn(),
    setGameRating: vi.fn(),
    listTags: vi.fn().mockResolvedValue([]),
    setGameTags: vi.fn()
  };

  const alertControllerMock = {
    create: vi.fn().mockResolvedValue({
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn().mockResolvedValue({ role: 'cancel' })
    })
  };

  const toastControllerMock = {
    create: vi.fn().mockResolvedValue({ present: vi.fn().mockResolvedValue(undefined) })
  };

  beforeEach(() => {
    vi.clearAllMocks();
    igdbProxyServiceMock.getRecommendationLanes.mockReturnValue(of(mockLanesResponse));
    igdbProxyServiceMock.rebuildRecommendations.mockReturnValue(
      of({ target: 'BACKLOG', runId: 2, status: 'SUCCESS' })
    );
    igdbProxyServiceMock.getGameById.mockReturnValue(of(null));
    igdbProxyServiceMock.getRecommendationSimilar.mockReturnValue(
      of({
        source: { igdbGameId: '100', platformIgdbId: 6 },
        items: []
      })
    );

    TestBed.configureTestingModule({
      providers: [
        { provide: IgdbProxyService, useValue: igdbProxyServiceMock },
        { provide: PlatformCustomizationService, useValue: platformCustomizationMock },
        { provide: AddToLibraryWorkflowService, useValue: addToLibraryWorkflowMock },
        { provide: GameShelfService, useValue: gameShelfServiceMock },
        { provide: AlertController, useValue: alertControllerMock },
        { provide: ToastController, useValue: toastControllerMock }
      ]
    });
  });

  function createPage(): ExplorePage {
    return TestBed.runInInjectionContext(() => new ExplorePage());
  }

  async function flushAsync(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('loads default recommendation lanes on init', async () => {
    const page = createPage();
    page.ngOnInit();
    await flushAsync();

    expect(igdbProxyServiceMock.getRecommendationLanes).toHaveBeenCalledWith({
      target: 'BACKLOG',
      runtimeMode: 'NEUTRAL',
      limit: 200
    });
    expect(gameShelfServiceMock.listLibraryGames).toHaveBeenCalledTimes(1);
    expect(page.getActiveLaneItems()).toHaveLength(1);
    expect(page.getDisplayTitle(page.getActiveLaneItems()[0])).toBe('Cached Local Title');
  });

  it('sets disabled state when recommendations feature flag is off', () => {
    const page = createPage();
    Object.defineProperty(page, 'recommendationFeatureEnabled', {
      value: false,
      configurable: true
    });

    page.ngOnInit();

    expect(page.recommendationErrorCode).toBe('REQUEST_FAILED');
    expect(page.recommendationError).toContain('disabled');
    expect(igdbProxyServiceMock.getRecommendationLanes).not.toHaveBeenCalled();
  });

  it('switching target/runtime triggers recommendation fetch with selected tuple', async () => {
    const page = createPage();
    page.ngOnInit();
    await flushAsync();

    await page.onTargetChange('WISHLIST');
    await page.onRuntimeModeChange('SHORT');

    expect(igdbProxyServiceMock.getRecommendationLanes).toHaveBeenLastCalledWith({
      target: 'WISHLIST',
      runtimeMode: 'SHORT',
      limit: 200
    });
  });

  it('uses cache and ignores invalid/same selection updates', async () => {
    const page = createPage();
    const privatePage = page as unknown as {
      loadRecommendationLanes: (forceRefresh: boolean) => Promise<void>;
      buildCacheKey: (target: string, runtimeMode: string) => string;
      lanesCache: Map<string, typeof mockLanesResponse>;
    };
    page.ngOnInit();
    await flushAsync();

    const firstCallCount = igdbProxyServiceMock.getRecommendationLanes.mock.calls.length;
    await page.onTargetChange('BACKLOG');
    await page.onTargetChange('invalid-target');
    await page.onRuntimeModeChange('NEUTRAL');
    await page.onRuntimeModeChange('invalid-runtime');
    page.onLaneChange('invalid-lane');
    expect(igdbProxyServiceMock.getRecommendationLanes).toHaveBeenCalledTimes(firstCallCount);

    const cacheKey = privatePage.buildCacheKey('BACKLOG', 'NEUTRAL');
    privatePage.lanesCache.set(cacheKey, mockLanesResponse);
    await privatePage.loadRecommendationLanes(false);
    expect(igdbProxyServiceMock.getRecommendationLanes).toHaveBeenCalledTimes(firstCallCount);
    expect(page.activeLanesResponse?.runId).toBe(1);
  });

  it('paginates recommendations in pages of 10', async () => {
    const page = createPage();
    const manyItems = Array.from({ length: 25 }, (_, index) => ({
      ...mockLanesResponse.lanes.overall[0],
      rank: index + 1,
      igdbGameId: String(1000 + index)
    }));
    igdbProxyServiceMock.getRecommendationLanes.mockReturnValue(
      of({
        ...mockLanesResponse,
        lanes: {
          ...mockLanesResponse.lanes,
          overall: manyItems
        }
      })
    );

    page.ngOnInit();
    await flushAsync();

    expect(page.getActiveLaneItems()).toHaveLength(10);

    const complete = vi.fn().mockResolvedValue(undefined);
    await page.loadMoreRecommendations({ target: { complete } } as unknown as Event);
    expect(page.getActiveLaneItems()).toHaveLength(20);

    await page.loadMoreRecommendations({ target: { complete } } as unknown as Event);
    expect(page.getActiveLaneItems()).toHaveLength(25);
  });

  it('paginates similar recommendations in pages of 5', async () => {
    const page = createPage();
    const similarItems = Array.from({ length: 12 }, (_, index) => ({
      igdbGameId: String(2000 + index),
      platformIgdbId: 6,
      similarity: 0.8,
      reasons: {
        summary: 'similar',
        structuredSimilarity: 0.7,
        semanticSimilarity: 0.6,
        blendedSimilarity: 0.65,
        sharedTokens: {
          genres: [],
          developers: [],
          publishers: [],
          franchises: [],
          collections: [],
          themes: [],
          keywords: []
        }
      }
    }));
    igdbProxyServiceMock.getRecommendationSimilar.mockReturnValue(
      of({
        source: { igdbGameId: '100', platformIgdbId: 6 },
        items: similarItems
      })
    );

    page.ngOnInit();
    await flushAsync();

    await page.openGameDetail(mockLanesResponse.lanes.overall[0]);
    await flushAsync();

    expect(page.getVisibleSimilarRecommendationItems()).toHaveLength(5);
    const complete = vi.fn().mockResolvedValue(undefined);
    await page.loadMoreSimilarRecommendations({ target: { complete } } as unknown as Event);
    expect(page.getVisibleSimilarRecommendationItems()).toHaveLength(10);
  });

  it('lane change is local state only and does not trigger refetch', async () => {
    const page = createPage();
    page.ngOnInit();
    await flushAsync();

    igdbProxyServiceMock.getRecommendationLanes.mockClear();
    page.onLaneChange('hiddenGems');

    expect(page.selectedLaneKey).toBe('hiddenGems');
    expect(igdbProxyServiceMock.getRecommendationLanes).not.toHaveBeenCalled();
  });

  it('maps not-found lane fetch failures into build state', async () => {
    const notFoundError = new Error('No recommendations available.');
    (notFoundError as Error & { code: string }).code = 'NOT_FOUND';
    igdbProxyServiceMock.getRecommendationLanes.mockReturnValueOnce(
      throwError(() => notFoundError)
    );

    const page = createPage();
    page.ngOnInit();
    await flushAsync();

    expect(page.recommendationErrorCode).toBe('NOT_FOUND');
  });

  it('returns lane descriptions and icons for lane/target combinations', () => {
    const page = createPage();

    page.selectedTarget = 'DISCOVERY';
    page.selectedLaneKey = 'popular';
    expect(page.getLaneDescription()).toContain('Popular');
    expect(page.getEmptyStateLaneIcon()).toBe('library');

    page.selectedLaneKey = 'recent';
    expect(page.getLaneDescription()).toContain('Recent');
    expect(page.getEmptyStateLaneIcon()).toBe('time');

    page.selectedLaneKey = 'blended';
    expect(page.getLaneDescription()).toContain('Blended');
    expect(page.getEmptyStateLaneIcon()).toBe('sparkles');

    page.selectedTarget = 'BACKLOG';
    page.selectedLaneKey = 'hiddenGems';
    expect(page.getLaneDescription()).toContain('Hidden Gems');
    expect(page.getEmptyStateLaneIcon()).toBe('sparkles');

    page.selectedLaneKey = 'exploration';
    expect(page.getLaneDescription()).toContain('Exploration');
    expect(page.getEmptyStateLaneIcon()).toBe('compass');
  });

  it('normalizes explanation bullets and headlines', () => {
    const page = createPage();
    const mapped = page.getExplanationBullets({
      ...mockLanesResponse.lanes.overall[0],
      explanations: {
        ...mockLanesResponse.lanes.overall[0].explanations,
        bullets: [
          { type: 'taste', label: 'A', evidence: [], delta: 0.5 },
          { type: 'taste', label: '', evidence: [], delta: 0.4 },
          { type: 'taste', label: 'B', evidence: [], delta: 0.001 }
        ]
      }
    });
    expect(mapped).toEqual([{ label: 'A', delta: '+0.50' }]);
    expect(page.getHeadlineLines('One • Two; Three|Four')).toEqual(['One', 'Two', 'Three', 'Four']);
    expect(page.getHeadlineLines('')).toEqual([]);
  });

  it('handles platform label resolution from catalog fallback paths', () => {
    const page = createPage() as unknown as {
      resolveCatalogPlatformLabel: (catalog: unknown, platformIgdbId: number) => string;
      withCatalogPlatformContext: (catalog: unknown, platformIgdbId: number) => unknown;
      collectPlatformIgdbIds: (catalog: unknown) => number[];
      isLibraryEntry: (value: unknown) => boolean;
    };

    const catalog = {
      igdbGameId: '200',
      title: 'Game',
      coverUrl: null,
      coverSource: 'none',
      storyline: null,
      summary: null,
      gameType: null,
      hltbMainHours: null,
      hltbMainExtraHours: null,
      hltbCompletionistHours: null,
      reviewScore: null,
      reviewUrl: null,
      reviewSource: null,
      mobyScore: null,
      mobygamesGameId: null,
      metacriticScore: null,
      metacriticUrl: null,
      similarGameIgdbIds: [],
      collections: [],
      developers: [],
      franchises: [],
      genres: [],
      themes: [],
      themeIds: [],
      keywords: [],
      keywordIds: [],
      publishers: [],
      platforms: [],
      platformOptions: [{ id: 9, name: 'PlayStation 3' }],
      platform: 'PC',
      platformIgdbId: 6,
      releaseDate: null,
      releaseYear: null
    };

    expect(page.resolveCatalogPlatformLabel(catalog, 6)).toBe('PC');
    expect(page.resolveCatalogPlatformLabel(catalog, 9)).toBe('PlayStation 3');
    expect(page.resolveCatalogPlatformLabel(catalog, 99)).toBe('PC');
    expect(
      page.resolveCatalogPlatformLabel({ ...catalog, platform: null, platformOptions: [] }, 99)
    ).toBe('Platform 99');

    const contextual = page.withCatalogPlatformContext(catalog, 9) as {
      platformIgdbId: number;
      platform: string | null;
    };
    expect(contextual.platformIgdbId).toBe(9);
    expect(contextual.platform).toBe('PlayStation 3');

    expect(page.collectPlatformIgdbIds(catalog)).toEqual([6, 9]);
    expect(page.isLibraryEntry({ ...catalog, listType: 'collection' })).toBe(true);
    expect(page.isLibraryEntry(catalog)).toBe(false);
  });

  it('handles private helper branches for refresh, count, and library checks', async () => {
    const page = createPage() as unknown as {
      activeLanesResponse: typeof mockLanesResponse | null;
      selectedLaneKey: 'overall';
      completeRefresher: (event: Event) => Promise<void>;
      getTotalActiveRecommendationCount: () => number;
      checkGameAlreadyInLibrary: (game: unknown) => Promise<boolean>;
    };

    page.activeLanesResponse = {
      ...mockLanesResponse,
      lanes: {
        ...mockLanesResponse.lanes,
        overall: [
          ...mockLanesResponse.lanes.overall,
          { ...mockLanesResponse.lanes.overall[0], rank: 2, platformIgdbId: 9 }
        ]
      }
    };
    page.selectedLaneKey = 'overall';
    expect(page.getTotalActiveRecommendationCount()).toBe(1);

    const complete = vi.fn().mockResolvedValue(undefined);
    await page.completeRefresher({ target: { complete } } as unknown as Event);
    expect(complete).toHaveBeenCalledOnce();
    await page.completeRefresher({ target: null } as unknown as Event);

    expect(
      await page.checkGameAlreadyInLibrary({
        ...mockLanesResponse.lanes.overall[0],
        igdbGameId: '500',
        platformIgdbId: 6,
        platformOptions: []
      })
    ).toBe(false);
  });

  it('routes recommendation row clicks to correct handlers', () => {
    const page = createPage() as unknown as {
      onRecommendationRowClick: (
        kind: 'recommendation' | 'similar',
        row: unknown,
        event: Event
      ) => void;
      openGameDetail: (item: unknown) => Promise<void>;
      openSimilarRecommendation: (item: unknown, event: Event) => Promise<void>;
    };
    const openGameDetail = vi.spyOn(page, 'openGameDetail').mockResolvedValue(undefined as never);
    const openSimilarRecommendation = vi
      .spyOn(page, 'openSimilarRecommendation')
      .mockResolvedValue(undefined as never);
    const event = new Event('click');

    page.onRecommendationRowClick('recommendation', mockLanesResponse.lanes.overall[0], event);
    page.onRecommendationRowClick(
      'similar',
      {
        igdbGameId: '2',
        platformIgdbId: 6,
        similarity: 0.5,
        reasons: {
          summary: '',
          structuredSimilarity: 0,
          semanticSimilarity: 0,
          blendedSimilarity: 0,
          sharedTokens: {
            genres: [],
            developers: [],
            publishers: [],
            franchises: [],
            collections: [],
            themes: [],
            keywords: []
          }
        }
      },
      event
    );

    expect(openGameDetail).toHaveBeenCalledTimes(1);
    expect(openSimilarRecommendation).toHaveBeenCalledTimes(1);
  });

  it('supports rating modal lifecycle and formatted values', () => {
    const page = createPage();
    const libraryGame = {
      igdbGameId: '100',
      platformIgdbId: 6,
      listType: 'collection' as const,
      title: 'Rated'
    };

    page.selectedGameDetail = libraryGame;
    page.openDetailRatingModal();
    expect(page.isRatingModalOpen).toBe(true);
    expect(page.formatRatingPin(4.2)).toBe('4');
    page.onRatingRangeChange({ detail: { value: 4.3 } } as unknown as Event);
    expect(page.ratingDraft).toBe(4.5);
    page.markRatingForClear();
    expect(page.clearRatingOnSave).toBe(true);
    page.closeRatingModal();
    expect(page.isRatingModalOpen).toBe(false);
  });

  it('supports shortcut URL routing and image fallback', () => {
    const page = createPage() as unknown as {
      selectedGameDetail: { title?: string | null } | null;
      openShortcutSearch: (provider: 'google' | 'youtube' | 'wikipedia' | 'gamefaqs') => void;
      onImageError: (event: Event) => void;
      openExternalUrl: (url: string) => void;
    };
    const openExternalUrl = vi.spyOn(page, 'openExternalUrl').mockImplementation(() => undefined);

    page.selectedGameDetail = { title: 'Pokemon Red' };
    page.openShortcutSearch('google');
    page.openShortcutSearch('youtube');
    page.openShortcutSearch('wikipedia');
    page.openShortcutSearch('gamefaqs');
    expect(openExternalUrl).toHaveBeenCalledTimes(4);

    const img = document.createElement('img');
    page.onImageError({ target: img } as unknown as Event);
    expect(img.src).toContain('assets/icon/placeholder.png');
  });

  it('exposes detail videos and opens/closes videos modal based on active detail game', () => {
    const page = createPage();

    expect(page.detailVideos).toEqual([]);
    expect(page.hasDetailVideosShortcut).toBe(false);

    page.openVideosModal();
    expect(page.isVideosModalOpen).toBe(false);

    page.selectedGameDetail = {
      igdbGameId: '100',
      platformIgdbId: 6,
      title: 'Game',
      coverUrl: null,
      coverSource: 'none',
      platform: 'PC',
      releaseDate: null,
      releaseYear: null,
      listType: 'collection',
      createdAt: '2026-03-03T00:00:00.000Z',
      updatedAt: '2026-03-03T00:00:00.000Z',
      videos: [{ id: 1, name: 'Trailer', videoId: 'PIF_fqFZEuk', url: '' }]
    };

    expect(page.detailVideos).toHaveLength(1);
    expect(page.hasDetailVideosShortcut).toBe(true);
    page.openVideosModal();
    expect(page.isVideosModalOpen).toBe(true);
    page.closeVideosModal();
    expect(page.isVideosModalOpen).toBe(false);
  });

  it('hides videos shortcut when all active detail videos have invalid YouTube ids', () => {
    const page = createPage();
    page.selectedGameDetail = {
      igdbGameId: '100',
      platformIgdbId: 6,
      title: 'Game',
      coverUrl: null,
      coverSource: 'none',
      platform: 'PC',
      releaseDate: null,
      releaseYear: null,
      listType: 'collection',
      createdAt: '2026-03-03T00:00:00.000Z',
      updatedAt: '2026-03-03T00:00:00.000Z',
      videos: [{ id: 1, name: 'Invalid', videoId: 'abc def', url: '' }]
    };

    expect(page.detailVideos).toHaveLength(1);
    expect(page.hasDetailVideosShortcut).toBe(false);
    page.openVideosModal();
    expect(page.isVideosModalOpen).toBe(false);
  });

  it('resets detail modal state on close', () => {
    const page = createPage();
    page.isGameDetailModalOpen = true;
    page.isRatingModalOpen = true;
    page.isLoadingDetail = true;
    page.detailErrorMessage = 'x';
    page.detailContext = 'library';
    page.isSelectedGameInLibrary = true;
    page.isAddToLibraryLoading = true;
    page.activeDetailRecommendation = mockLanesResponse.lanes.overall[0];
    page.detailNavigationStack = [mockLanesResponse.lanes.overall[0]];
    page.isLoadingSimilar = true;
    page.similarRecommendationsError = 'x';
    page.similarRecommendationItems = [
      {
        igdbGameId: '2',
        platformIgdbId: 6,
        similarity: 0.1,
        reasons: {
          summary: '',
          structuredSimilarity: 0,
          semanticSimilarity: 0,
          blendedSimilarity: 0,
          sharedTokens: {
            genres: [],
            developers: [],
            publishers: [],
            franchises: [],
            collections: [],
            themes: [],
            keywords: []
          }
        }
      }
    ];
    page.closeGameDetailModal();
    expect(page.isGameDetailModalOpen).toBe(false);
    expect(page.isRatingModalOpen).toBe(false);
    expect(page.detailContext).toBe('explore');
    expect(page.detailNavigationStack).toEqual([]);
    expect(page.similarRecommendationItems).toEqual([]);
  });

  it('covers library mutation flows for status, rating, and tags', async () => {
    const page = createPage();
    const libraryGame = {
      id: 1,
      igdbGameId: '100',
      title: 'Game',
      notes: null,
      customTitle: null,
      coverUrl: null,
      customCoverUrl: null,
      coverSource: 'none' as const,
      platform: 'PC',
      platformIgdbId: 6,
      releaseDate: null,
      releaseYear: 2020,
      status: null,
      rating: null,
      listType: 'collection' as const,
      createdAt: '2026-03-03T00:00:00.000Z',
      updatedAt: '2026-03-03T00:00:00.000Z'
    };
    page.selectedGameDetail = libraryGame;

    gameShelfServiceMock.setGameStatus.mockResolvedValue({
      ...libraryGame,
      status: 'playing'
    });
    await page.onDetailStatusChange('playing');
    expect(gameShelfServiceMock.setGameStatus).toHaveBeenCalledWith('100', 6, 'playing');

    gameShelfServiceMock.setGameStatus.mockRejectedValueOnce(new Error('failed'));
    await page.onDetailStatusChange('paused');

    gameShelfServiceMock.setGameStatus.mockResolvedValue({ ...libraryGame, status: null });
    await page.clearDetailStatus();
    expect(gameShelfServiceMock.setGameStatus).toHaveBeenCalledWith('100', 6, null);

    gameShelfServiceMock.setGameRating.mockResolvedValue({ ...libraryGame, rating: 4.5 });
    page.ratingDraft = 4.5;
    page.clearRatingOnSave = false;
    await page.saveDetailRatingFromModal();
    expect(gameShelfServiceMock.setGameRating).toHaveBeenCalledWith('100', 6, 4.5);

    gameShelfServiceMock.setGameRating.mockRejectedValueOnce(new Error('failed'));
    await page.saveDetailRatingFromModal();

    gameShelfServiceMock.listTags.mockResolvedValue([]);
    await page.openDetailTags();

    gameShelfServiceMock.listTags.mockResolvedValue([{ id: 1, name: 'A', color: '#fff' }]);
    alertControllerMock.create.mockResolvedValueOnce({
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn().mockResolvedValue({ role: 'cancel' })
    });
    await page.openDetailTags();
  });

  it('covers add-to-library flow branches', async () => {
    const page = createPage() as unknown as {
      detailContext: 'explore' | 'library';
      isSelectedGameInLibrary: boolean;
      isAddToLibraryLoading: boolean;
      selectedGameDetail: unknown;
      pickListTypeForAdd: () => Promise<'collection' | 'wishlist' | null>;
      addSelectedGameToLibrary: () => Promise<void>;
    };

    page.detailContext = 'explore';
    page.isSelectedGameInLibrary = false;
    page.isAddToLibraryLoading = false;
    page.selectedGameDetail = {
      igdbGameId: '300',
      title: 'Catalog',
      coverUrl: null,
      coverSource: 'none',
      platform: 'PC',
      platformIgdbId: 6,
      platformOptions: [{ id: 6, name: 'PC' }]
    };
    vi.spyOn(page, 'pickListTypeForAdd').mockResolvedValue('collection');
    addToLibraryWorkflowMock.addToLibrary.mockResolvedValue({
      status: 'duplicate'
    });

    await page.addSelectedGameToLibrary();
    expect(page.isSelectedGameInLibrary).toBe(true);

    page.isSelectedGameInLibrary = false;
    addToLibraryWorkflowMock.addToLibrary.mockResolvedValue({
      status: 'added',
      entry: {
        igdbGameId: '300',
        title: 'Catalog',
        coverUrl: null,
        coverSource: 'none',
        platform: 'PC',
        platformIgdbId: 6,
        listType: 'collection',
        createdAt: '2026-03-03T00:00:00.000Z',
        updatedAt: '2026-03-03T00:00:00.000Z'
      }
    });
    await page.addSelectedGameToLibrary();
    expect(page.detailContext).toBe('library');
  });

  it('covers empty-state, similar-display, and parser helper branches', () => {
    const page = createPage() as unknown as {
      activeLanesResponse: typeof mockLanesResponse | null;
      recommendationErrorCode: 'NONE' | 'NOT_FOUND' | 'RATE_LIMITED' | 'REQUEST_FAILED';
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      selectedLaneKey: 'overall' | 'hiddenGems' | 'exploration' | 'blended' | 'popular' | 'recent';
      selectedRuntimeMode: 'NEUTRAL' | 'SHORT' | 'LONG';
      getEmptyStateMessage: () => string;
      getEmptyStateHint: () => string;
      getEmptyStateTokenHint: () => string;
      getSimilarContext: (item: unknown) => string;
      getSimilarTitle: (item: unknown) => string;
      getSimilarCoverUrl: (item: unknown) => string;
      getSimilarReasonBadges: (item: unknown) => Array<{ text: string }>;
      goBackInDetailNavigation: () => void;
      detailNavigationStack: unknown[];
      openGameDetail: (item: unknown) => Promise<void>;
      parseRecommendationTarget: (value: unknown) => unknown;
      parseRuntimeMode: (value: unknown) => unknown;
      parseLaneKey: (value: unknown) => unknown;
      normalizeRecommendationError: (error: unknown) => { code: string };
    };
    page.selectedTarget = 'BACKLOG';
    page.selectedLaneKey = 'overall';
    page.selectedRuntimeMode = 'NEUTRAL';

    page.activeLanesResponse = null;
    page.recommendationErrorCode = 'NONE';
    expect(page.getEmptyStateMessage()).toContain('No recommendation items');
    expect(page.getEmptyStateHint()).toContain('Overall');
    expect(page.getEmptyStateTokenHint()).toBe('');

    page.activeLanesResponse = {
      ...mockLanesResponse,
      lanes: {
        ...mockLanesResponse.lanes,
        overall: [],
        hiddenGems: [],
        exploration: []
      }
    };
    page.recommendationErrorCode = 'NOT_FOUND';
    expect(page.getEmptyStateMessage()).toContain('No materialized recommendations');

    page.activeLanesResponse = {
      ...mockLanesResponse,
      lanes: {
        ...mockLanesResponse.lanes,
        overall: [
          {
            ...mockLanesResponse.lanes.overall[0],
            explanations: {
              ...mockLanesResponse.lanes.overall[0].explanations,
              matchedTokens: {
                ...mockLanesResponse.lanes.overall[0].explanations.matchedTokens,
                themes: ['Fantasy'],
                keywords: ['turn-based combat']
              }
            }
          }
        ]
      }
    };
    expect(page.getEmptyStateTokenHint()).toContain('Fantasy');

    const similar = {
      igdbGameId: '77',
      platformIgdbId: 6,
      similarity: 0.77,
      reasons: {
        summary: 'summary',
        structuredSimilarity: 0.6,
        semanticSimilarity: 0.7,
        blendedSimilarity: 0.77,
        sharedTokens: {
          genres: [],
          developers: [],
          publishers: [],
          franchises: [],
          collections: [],
          themes: [],
          keywords: []
        }
      }
    };
    expect(page.getSimilarContext(similar)).toContain('Platform 6');
    expect(page.getSimilarTitle(similar)).toContain('Game #77');
    expect(page.getSimilarCoverUrl(similar)).toContain('placeholder');
    expect(page.getSimilarReasonBadges(similar)[0]?.text).toContain('Blend');

    const openGameDetail = vi.spyOn(page, 'openGameDetail').mockResolvedValue(undefined as never);
    page.detailNavigationStack = [mockLanesResponse.lanes.overall[0]];
    page.goBackInDetailNavigation();
    expect(openGameDetail).toHaveBeenCalledTimes(1);

    expect(page.parseRecommendationTarget('DISCOVERY')).toBe('DISCOVERY');
    expect(page.parseRecommendationTarget('x')).toBeNull();
    expect(page.parseRuntimeMode('SHORT')).toBe('SHORT');
    expect(page.parseRuntimeMode('x')).toBeNull();
    expect(page.parseLaneKey('popular')).toBe('popular');
    expect(page.parseLaneKey('x')).toBeNull();

    expect(page.normalizeRecommendationError(new Error('x')).code).toBe('REQUEST_FAILED');
  });

  it('covers recommendation refresh and display fallback helper branches', async () => {
    const page = createPage();
    const privatePage = page as unknown as {
      refreshRecommendations: (event: Event) => Promise<void>;
      getDisplayTitle: (item: (typeof mockLanesResponse.lanes.overall)[0]) => string;
      getPlatformLabel: (item: (typeof mockLanesResponse.lanes.overall)[0]) => string;
      getReleaseYear: (item: (typeof mockLanesResponse.lanes.overall)[0]) => number | null;
      getCoverUrl: (item: (typeof mockLanesResponse.lanes.overall)[0]) => string;
      getScoreBadge: (item: (typeof mockLanesResponse.lanes.overall)[0]) => { text: string };
      getConfidenceBadge: (item: (typeof mockLanesResponse.lanes.overall)[0]) => { text: string };
      canLoadMoreRecommendations: () => boolean;
      visibleRecommendationCount: number;
      activeLanesResponse: typeof mockLanesResponse | null;
      localGameCacheByIdentity: Map<string, unknown>;
      recommendationDisplayMetadata: Map<
        string,
        {
          title: string;
          coverUrl: string | null;
          platformLabel: string;
          releaseYear: number | null;
        }
      >;
      buildIdentityKey: (igdbGameId: string, platformIgdbId: number) => string;
    };

    page.ngOnInit();
    await flushAsync();

    const complete = vi.fn().mockResolvedValue(undefined);
    await privatePage.refreshRecommendations({ target: { complete } } as unknown as Event);
    expect(complete).toHaveBeenCalledOnce();

    const row = mockLanesResponse.lanes.overall[0];
    const key = privatePage.buildIdentityKey(row.igdbGameId, row.platformIgdbId);
    privatePage.localGameCacheByIdentity.clear();
    privatePage.recommendationDisplayMetadata.set(key, {
      title: 'Catalog Fallback Title',
      coverUrl: null,
      platformLabel: 'PlayStation 2',
      releaseYear: 2002
    });

    expect(privatePage.getDisplayTitle(row)).toBe('Catalog Fallback Title');
    expect(privatePage.getPlatformLabel(row)).toBe('PlayStation 2');
    expect(privatePage.getReleaseYear(row)).toBe(2002);
    expect(privatePage.getCoverUrl(row)).toContain('placeholder');
    expect(privatePage.getScoreBadge(row).text).toContain('Score');
    expect(privatePage.getConfidenceBadge(row).text).toContain('Confidence');

    privatePage.activeLanesResponse = {
      ...mockLanesResponse,
      lanes: {
        ...mockLanesResponse.lanes,
        overall: [row, { ...row, rank: 2, igdbGameId: '200' }]
      }
    };
    privatePage.visibleRecommendationCount = 1;
    expect(privatePage.canLoadMoreRecommendations()).toBe(true);
  });

  it('covers remaining recommendation helper branches', async () => {
    const page = createPage() as unknown as {
      activeLanesResponse: typeof mockLanesResponse | null;
      selectedLaneKey: 'overall' | 'hiddenGems' | 'exploration' | 'blended' | 'popular' | 'recent';
      openGameDetail: (item: unknown, options?: unknown) => Promise<void>;
      openSimilarRecommendation: (item: unknown, event?: Event) => Promise<void>;
      normalizeRecommendationError: (error: unknown) => { code: string };
      getMergedPlatformLabels: (item: unknown) => string | null;
      getPlatformDisplayName: (name: string, platformIgdbId: number | null) => string;
      loadSimilarRecommendations: (item: unknown) => Promise<void>;
      similarRecommendationsError: string;
      similarRecommendationItems: unknown[];
    };

    page.activeLanesResponse = {
      ...mockLanesResponse,
      lanes: {
        ...mockLanesResponse.lanes,
        overall: [
          mockLanesResponse.lanes.overall[0],
          { ...mockLanesResponse.lanes.overall[0], rank: 2, platformIgdbId: 9 }
        ]
      }
    };
    page.selectedLaneKey = 'overall';
    expect(page.getMergedPlatformLabels(mockLanesResponse.lanes.overall[0])).toBeTruthy();
    expect(page.getPlatformDisplayName('', null)).toBe('Unknown platform');

    const openGameDetail = vi.spyOn(page, 'openGameDetail').mockResolvedValue(undefined as never);
    const stopPropagation = vi.fn();
    await page.openSimilarRecommendation(
      {
        igdbGameId: '300',
        platformIgdbId: 6,
        similarity: 0.55,
        reasons: {
          summary: 'x',
          structuredSimilarity: 0.2,
          semanticSimilarity: 0.4,
          blendedSimilarity: 0.55,
          sharedTokens: {
            genres: [],
            developers: [],
            publishers: [],
            franchises: [],
            collections: [],
            themes: [],
            keywords: []
          }
        }
      },
      { stopPropagation } as unknown as Event
    );
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(openGameDetail).toHaveBeenCalledOnce();

    expect(page.normalizeRecommendationError(new HttpErrorResponse({ status: 404 })).code).toBe(
      'NOT_FOUND'
    );
    expect(page.normalizeRecommendationError(new HttpErrorResponse({ status: 429 })).code).toBe(
      'RATE_LIMITED'
    );
    expect(
      page.normalizeRecommendationError(
        Object.assign(new Error('cooldown'), { code: 'RATE_LIMITED' })
      ).code
    ).toBe('RATE_LIMITED');

    igdbProxyServiceMock.getRecommendationSimilar.mockReturnValueOnce(
      throwError(() => new Error('failed'))
    );
    await page.loadSimilarRecommendations(mockLanesResponse.lanes.overall[0]);
    expect(page.similarRecommendationsError).toContain('failed');
    expect(page.similarRecommendationItems).toEqual([]);
  });

  it('opens detail modal for recommendation row without IGDB detail request', async () => {
    const page = createPage();
    const privatePage = page as unknown as {
      detailContent?: { scrollToTop: (duration: number) => Promise<void> };
    };
    const scrollToTop = vi.fn().mockResolvedValue(undefined);
    privatePage.detailContent = { scrollToTop };
    page.ngOnInit();
    await flushAsync();

    const row = page.getActiveLaneItems()[0];
    await page.openGameDetail(row);

    expect(page.isGameDetailModalOpen).toBe(true);
    expect(igdbProxyServiceMock.getGameById).not.toHaveBeenCalled();
    expect(igdbProxyServiceMock.getRecommendationSimilar).toHaveBeenCalledWith({
      target: 'BACKLOG',
      runtimeMode: 'NEUTRAL',
      igdbGameId: '100',
      platformIgdbId: 6,
      limit: 50
    });
    expect(scrollToTop).toHaveBeenCalledWith(0);
    expect(page.selectedGameDetail?.igdbGameId).toBe('100');
  });

  it('covers platform identity checks and external link opening helpers', async () => {
    const page = createPage() as unknown as {
      isLibraryEntry: (value: unknown) => boolean;
      collectPlatformIgdbIds: (value: unknown) => number[];
      checkGameAlreadyInLibrary: (value: unknown) => Promise<boolean>;
      openExternalUrl: (value: string) => void;
    };

    expect(page.isLibraryEntry(null)).toBe(false);
    expect(
      page.collectPlatformIgdbIds({
        igdbGameId: '301',
        platformIgdbId: 0,
        platformOptions: [{ id: 12 }, { id: 12 }, { id: 4.5 }, { id: -1 }, { id: 0 }]
      })
    ).toEqual([12]);
    expect(
      page.collectPlatformIgdbIds({
        igdbGameId: '302',
        platformIgdbId: 6,
        platformOptions: null
      })
    ).toEqual([6]);

    gameShelfServiceMock.findGameByIdentity.mockResolvedValueOnce({ id: 42 });
    await expect(
      page.checkGameAlreadyInLibrary({ igdbGameId: '500', platformIgdbId: 6 })
    ).resolves.toBe(true);

    await expect(
      page.checkGameAlreadyInLibrary({
        igdbGameId: '999',
        platformIgdbId: 6,
        listType: 'collection'
      })
    ).resolves.toBe(true);

    gameShelfServiceMock.findGameByIdentity.mockResolvedValue(null);
    await expect(
      page.checkGameAlreadyInLibrary({
        igdbGameId: '501',
        platformIgdbId: 0,
        platformOptions: []
      })
    ).resolves.toBe(false);

    const clickSpy = vi.fn();
    const anchor = {
      href: '',
      target: '',
      rel: '',
      click: clickSpy
    } as unknown as HTMLAnchorElement;
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    page.openExternalUrl('https://example.com/game');
    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(anchor.href).toBe('https://example.com/game');
    expect(anchor.target).toBe('_blank');
    expect(anchor.rel).toBe('noopener noreferrer external');
    expect(clickSpy).toHaveBeenCalledOnce();
    createElementSpy.mockRestore();
  });

  it('populates recommendation metadata per platform batch with title fallback', async () => {
    const page = createPage() as unknown as {
      populateRecommendationDisplayMetadata: (
        groupedPlatformIds: Map<string, Set<number>>
      ) => Promise<void>;
      recommendationDisplayMetadata: Map<
        string,
        {
          title: string;
          coverUrl: string | null;
          platformLabel: string;
          releaseYear: number | null;
        }
      >;
      buildIdentityKey: (igdbGameId: string, platformIgdbId: number) => string;
    };

    igdbProxyServiceMock.getGameById.mockReturnValueOnce(
      of({
        igdbGameId: '700',
        title: ' ',
        platform: null,
        platformIgdbId: 6,
        releaseYear: null,
        coverUrl: null,
        platformOptions: [
          { id: 6, name: 'PC' },
          { id: 48, name: 'PS4' }
        ]
      })
    );

    await page.populateRecommendationDisplayMetadata(new Map([['700', new Set([6, 48])]]));

    const first = page.recommendationDisplayMetadata.get(page.buildIdentityKey('700', 6));
    const second = page.recommendationDisplayMetadata.get(page.buildIdentityKey('700', 48));
    expect(first?.title).toBe('Game #700');
    expect(first?.platformLabel).toBe('PC');
    expect(second?.platformLabel).toBe('PS4');
  });

  it('covers list-type picker confirm/cancel branches', async () => {
    const page = createPage() as unknown as {
      pickListTypeForAdd: () => Promise<'collection' | 'wishlist' | null>;
    };

    let selectedHandler: ((value: string) => void) | undefined;
    alertControllerMock.create.mockImplementationOnce((options: { buttons?: unknown[] }) => {
      const confirmButton = (options.buttons ?? []).find(
        (button) =>
          typeof button === 'object' &&
          button !== null &&
          (button as { role?: string }).role === 'confirm'
      ) as { handler?: (value: string) => void } | undefined;
      selectedHandler = confirmButton?.handler;

      return {
        present: vi.fn().mockResolvedValue(undefined),
        onDidDismiss: vi.fn().mockResolvedValue({ role: 'confirm' })
      };
    });

    const confirmWishlistPromise = page.pickListTypeForAdd();
    selectedHandler?.('wishlist');
    await expect(confirmWishlistPromise).resolves.toBe('wishlist');

    alertControllerMock.create.mockResolvedValueOnce({
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn().mockResolvedValue({ role: 'cancel' })
    });
    await expect(page.pickListTypeForAdd()).resolves.toBeNull();
  });
});
