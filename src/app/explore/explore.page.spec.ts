import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { AlertController, PopoverController, ToastController } from '@ionic/angular/standalone';
import { ExplorePage } from './explore.page';
import { IgdbProxyService } from '../core/api/igdb-proxy.service';
import type { GameCatalogResult } from '../core/models/game.models';
import { PlatformCustomizationService } from '../core/services/platform-customization.service';
import { DebugLogService } from '../core/services/debug-log.service';
import { AddToLibraryWorkflowService } from '../features/game-search/add-to-library-workflow.service';
import { GameShelfService } from '../core/services/game-shelf.service';
import { RecommendationIgnoreService } from '../core/services/recommendation-ignore.service';

const swiperConstructorMock = vi.hoisted(() => vi.fn());

vi.mock('@ionic/angular/standalone', () => {
  const Dummy = () => null;
  const AlertControllerToken = function AlertController() {
    return undefined;
  };
  const ToastControllerToken = function ToastController() {
    return undefined;
  };
  const PopoverControllerToken = function PopoverController() {
    return undefined;
  };
  return {
    AlertController: AlertControllerToken,
    ToastController: ToastControllerToken,
    PopoverController: PopoverControllerToken,
    IonContent: Dummy,
    IonHeader: Dummy,
    IonGrid: Dummy,
    IonItem: Dummy,
    IonLabel: Dummy,
    IonList: Dummy,
    IonListHeader: Dummy,
    IonModal: Dummy,
    IonSelect: Dummy,
    IonSelectOption: Dummy,
    IonButton: Dummy,
    IonButtons: Dummy,
    IonCol: Dummy,
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
    IonPopover: Dummy,
    IonRow: Dummy,
    IonSegment: Dummy,
    IonSegmentButton: Dummy,
    IonCard: Dummy,
    IonCardHeader: Dummy,
    IonCardTitle: Dummy,
  };
});
vi.mock('swiper', () => ({
  default: function SwiperMock(this: unknown, ...args: unknown[]) {
    return swiperConstructorMock(...args) as SwiperInstanceMock;
  },
}));
vi.mock('swiper/modules', () => ({
  Pagination: {},
  Zoom: {},
}));
vi.mock('../features/game-detail/game-detail-content.component', () => ({
  GameDetailContentComponent: () => null,
}));

type ResizeObserverMockInstance = {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  callback: ResizeObserverCallback;
};

type SwiperInstanceMock = {
  allowTouchMove: boolean;
  update: ReturnType<typeof vi.fn>;
  pagination: {
    render: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  destroy: ReturnType<typeof vi.fn>;
};

type DetailTextMeasurementState = {
  clientHeight: number;
  scrollHeight: number;
};

const mockLaneItem = {
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
    repeatPenalty: 0,
  },
  explanations: {
    headline: 'Fits your profile',
    bullets: [],
    matchedTokens: {
      genres: [] as string[],
      developers: [] as string[],
      publishers: [] as string[],
      franchises: [] as string[],
      collections: [] as string[],
      themes: [] as string[],
      keywords: [] as string[],
    },
  },
};

type MockLaneItem = typeof mockLaneItem;
type MockLanesResponse = {
  target: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
  runtimeMode: 'NEUTRAL' | 'SHORT' | 'LONG';
  runId: number;
  generatedAt: string;
  lane: 'overall' | 'hiddenGems' | 'exploration' | 'blended' | 'popular' | 'recent';
  items: MockLaneItem[];
  page: {
    offset: number;
    limit: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
};

const mockLanesResponse: MockLanesResponse = {
  target: 'BACKLOG' as const,
  runtimeMode: 'NEUTRAL' as const,
  runId: 1,
  generatedAt: '2026-03-03T12:00:00.000Z',
  lane: 'overall',
  items: [mockLaneItem],
  page: {
    offset: 0,
    limit: 10,
    hasMore: false,
    nextOffset: null,
  },
};

const mockPopularityFeedItem = {
  id: '500',
  name: 'Popular Game',
  platformIgdbId: 6,
  popularityScore: 144.2,
  coverUrl: 'https://example.com/pop-cover.jpg',
  rating: 88,
  firstReleaseDate: 1_700_100_000,
  platforms: [{ id: 6, name: 'PC (Microsoft Windows)' }],
};

const mockPopularityFeedResponse = {
  items: [mockPopularityFeedItem],
  page: {
    offset: 0,
    limit: 10,
    hasMore: false,
    nextOffset: null,
  },
};

function createLaneResponse(
  overrides: Partial<MockLanesResponse> = {},
  itemOverrides: Partial<MockLaneItem>[] = []
): MockLanesResponse {
  return {
    ...mockLanesResponse,
    items:
      itemOverrides.length > 0
        ? itemOverrides.map((item, index) => ({
            ...mockLaneItem,
            rank: index + 1,
            igdbGameId: String(100 + index),
            ...item,
          }))
        : mockLanesResponse.items.map((item) => ({ ...item })),
    page: { ...mockLanesResponse.page, ...(overrides.page ?? {}) },
    ...overrides,
  };
}

function createSwiperInstance(): SwiperInstanceMock {
  return {
    allowTouchMove: false,
    update: vi.fn(),
    pagination: {
      render: vi.fn(),
      update: vi.fn(),
    },
    destroy: vi.fn(),
  };
}

function createCatalogResult(
  igdbGameId: string,
  platformIgdbId: number,
  overrides: Partial<GameCatalogResult> = {}
): GameCatalogResult {
  return {
    igdbGameId,
    title: `Game ${igdbGameId}`,
    coverUrl: null,
    coverSource: 'igdb',
    summary: null,
    storyline: null,
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
    websites: [],
    screenshots: [],
    videos: [],
    publishers: [],
    platforms: ['PC (Microsoft Windows)'],
    platformOptions: [{ id: platformIgdbId, name: 'PC (Microsoft Windows)' }],
    platform: 'PC (Microsoft Windows)',
    platformIgdbId,
    releaseDate: '2025-01-01T00:00:00.000Z',
    releaseYear: 2025,
    ...overrides,
  };
}

function triggerResizeObserver(resizeObservers: ResizeObserverMockInstance[]): void {
  const observer = resizeObservers[0];

  expect(observer).toBeDefined();
  observer.callback([], {} as ResizeObserver);
}

function createDetailTextMeasurementElement(
  expandedState: DetailTextMeasurementState,
  collapsedState: DetailTextMeasurementState,
  initiallyCollapsed = false
): HTMLElement {
  const collapsedClass = 'detail-long-text-collapsed';
  let isCollapsed = initiallyCollapsed;

  return {
    classList: {
      contains: (value: string) => value === collapsedClass && isCollapsed,
      add: (value: string) => {
        if (value === collapsedClass) {
          isCollapsed = true;
        }
      },
      remove: (value: string) => {
        if (value === collapsedClass) {
          isCollapsed = false;
        }
      },
    },
    get clientHeight() {
      return isCollapsed ? collapsedState.clientHeight : expandedState.clientHeight;
    },
    get scrollHeight() {
      return isCollapsed ? collapsedState.scrollHeight : expandedState.scrollHeight;
    },
  } as HTMLElement;
}

function makeSimpleGameChange(currentValue: GameCatalogResult) {
  return {
    game: {
      currentValue,
      previousValue: undefined,
      firstChange: true,
      isFirstChange: () => true,
    },
  };
}

async function createExploreDetailComponentHarness(page: ExplorePage): Promise<{
  component: import('../features/game-detail/game-detail-content.component').GameDetailContentComponent;
  resizeObservers: ResizeObserverMockInstance[];
  summaryCollapsedState: DetailTextMeasurementState;
  storylineCollapsedState: DetailTextMeasurementState;
}> {
  const { GameDetailContentComponent: ActualGameDetailContentComponent } = await vi.importActual<
    typeof import('../features/game-detail/game-detail-content.component')
  >('../features/game-detail/game-detail-content.component');

  const resizeObservers: ResizeObserverMockInstance[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserverMock {
      observe = vi.fn();
      disconnect = vi.fn();

      constructor(callback: ResizeObserverCallback) {
        resizeObservers.push({
          observe: this.observe,
          disconnect: this.disconnect,
          callback,
        });
      }
    }
  );
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    })
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  const component = TestBed.runInInjectionContext(() => new ActualGameDetailContentComponent());
  const summaryCollapsedState = { clientHeight: 90, scrollHeight: 90 };
  const storylineCollapsedState = { clientHeight: 90, scrollHeight: 90 };
  const summaryExpandedState = { clientHeight: 120, scrollHeight: 120 };
  const storylineExpandedState = { clientHeight: 120, scrollHeight: 120 };

  component.context = page.detailContext;
  component.game = page.selectedGameDetail as GameCatalogResult;
  (
    component as unknown as {
      summaryTextRef: { nativeElement: HTMLElement };
      storylineTextRef: { nativeElement: HTMLElement };
    }
  ).summaryTextRef = {
    nativeElement: createDetailTextMeasurementElement(summaryExpandedState, summaryCollapsedState),
  };
  (
    component as unknown as {
      summaryTextRef: { nativeElement: HTMLElement };
      storylineTextRef: { nativeElement: HTMLElement };
    }
  ).storylineTextRef = {
    nativeElement: createDetailTextMeasurementElement(
      storylineExpandedState,
      storylineCollapsedState
    ),
  };

  component.ngOnChanges(makeSimpleGameChange(component.game) as never);
  component.ngAfterViewInit();

  return {
    component,
    resizeObservers,
    summaryCollapsedState,
    storylineCollapsedState,
  };
}

describe('ExplorePage explore modes UX', () => {
  const igdbProxyServiceMock = {
    getRecommendationLanes: vi.fn(),
    getPopularityFeed: vi.fn(),
    rebuildRecommendations: vi.fn(),
    getGameById: vi.fn(),
    getRecommendationSimilar: vi.fn(),
    lookupSteamPrice: vi.fn(),
    lookupPsPrices: vi.fn(),
  };

  const platformCustomizationMock = {
    getDisplayNameWithoutAlias: vi.fn((name: string) => name),
  };

  const debugLogServiceMock = {
    trace: vi.fn(),
  };

  const addToLibraryWorkflowMock = {
    addToLibrary: vi.fn(),
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
        updatedAt: '2026-03-03T00:00:00.000Z',
      },
    ]),
    findGameByIdentity: vi.fn().mockResolvedValue(null),
    setGameStatus: vi.fn(),
    setGameRating: vi.fn(),
    listTags: vi.fn().mockResolvedValue([]),
    setGameTags: vi.fn(),
    isGameOnDiscount: vi.fn().mockReturnValue(false),
  };

  const recommendationIgnoreServiceMock = {
    ignoredIds$: of(new Set<string>()),
    ignoreGame: vi.fn(),
  };

  const alertControllerMock = {
    create: vi.fn().mockResolvedValue({
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn().mockResolvedValue({ role: 'cancel' }),
    }),
  };

  const toastControllerMock = {
    create: vi.fn().mockResolvedValue({ present: vi.fn().mockResolvedValue(undefined) }),
  };
  const popoverControllerMock = {
    dismiss: vi.fn().mockResolvedValue(true),
  };
  const routerMock = {
    navigateByUrl: vi.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    swiperConstructorMock.mockReset();
    swiperConstructorMock.mockImplementation(() => createSwiperInstance());
    recommendationIgnoreServiceMock.ignoredIds$ = of(new Set<string>());
    igdbProxyServiceMock.getRecommendationLanes.mockReturnValue(of(mockLanesResponse));
    igdbProxyServiceMock.getPopularityFeed.mockReturnValue(of(mockPopularityFeedResponse));
    igdbProxyServiceMock.rebuildRecommendations.mockReturnValue(
      of({ target: 'BACKLOG', runId: 2, status: 'SUCCESS' })
    );
    igdbProxyServiceMock.getGameById.mockReturnValue(of(null));
    igdbProxyServiceMock.getRecommendationSimilar.mockReturnValue(
      of({
        source: { igdbGameId: '100', platformIgdbId: 6 },
        items: [],
        page: { offset: 0, limit: 5, hasMore: false, nextOffset: null },
      })
    );
    igdbProxyServiceMock.lookupSteamPrice.mockReturnValue(of({ status: 'unavailable' }));
    igdbProxyServiceMock.lookupPsPrices.mockReturnValue(of({ status: 'unavailable' }));
    popoverControllerMock.dismiss.mockResolvedValue(true);
    routerMock.navigateByUrl.mockResolvedValue(true);
    debugLogServiceMock.trace.mockReset();

    TestBed.configureTestingModule({
      providers: [
        { provide: IgdbProxyService, useValue: igdbProxyServiceMock },
        { provide: PlatformCustomizationService, useValue: platformCustomizationMock },
        { provide: DebugLogService, useValue: debugLogServiceMock },
        { provide: AddToLibraryWorkflowService, useValue: addToLibraryWorkflowMock },
        { provide: GameShelfService, useValue: gameShelfServiceMock },
        { provide: RecommendationIgnoreService, useValue: recommendationIgnoreServiceMock },
        { provide: AlertController, useValue: alertControllerMock },
        { provide: PopoverController, useValue: popoverControllerMock },
        { provide: ToastController, useValue: toastControllerMock },
        { provide: Router, useValue: routerMock },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
      lane: 'overall',
      runtimeMode: 'NEUTRAL',
      offset: 0,
      limit: 10,
    });
    expect(gameShelfServiceMock.listLibraryGames).toHaveBeenCalledTimes(1);
    expect(page.getActiveLaneItems()).toHaveLength(1);
    expect(page.getDisplayTitle(page.getActiveLaneItems()[0])).toBe('Cached Local Title');
  });

  it('sets disabled state when recommendations feature flag is off', () => {
    const page = createPage();
    Object.defineProperty(page, 'exploreEnabled', {
      value: false,
      configurable: true,
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
      lane: 'overall',
      runtimeMode: 'SHORT',
      offset: 0,
      limit: 10,
    });
  });

  it('switches to popularity mode and fetches selected feed types', async () => {
    const page = createPage();
    page.ngOnInit();
    await flushAsync();

    await page.onExploreModeChange('popularity');

    expect(page.selectedExploreMode).toBe('popularity');
    expect(igdbProxyServiceMock.getPopularityFeed).toHaveBeenCalledWith({
      feedType: 'trending',
      offset: 0,
      limit: 10,
    });
    expect(page.getActivePopularityItems()).toHaveLength(1);

    await page.onPopularityFeedChange('upcoming');
    expect(page.selectedPopularityFeed).toBe('upcoming');
    expect(igdbProxyServiceMock.getPopularityFeed).toHaveBeenLastCalledWith({
      feedType: 'upcoming',
      offset: 0,
      limit: 10,
    });
  });

  it('reuses empty and derived detail modal collections while the selected detail stays the same', () => {
    const page = createPage();

    expect(page.detailVideos).toBe(page.detailVideos);
    expect(page.detailWebsites).toBe(page.detailWebsites);
    expect(page.detailWebsiteItems).toBe(page.detailWebsiteItems);

    page.selectedGameDetail = {
      igdbGameId: '501',
      title: 'Trace Test',
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
      platformOptions: [],
      platform: null,
      platformIgdbId: 6,
      releaseDate: null,
      releaseYear: null,
      websites: [{ category: 'official', trusted: true, url: 'https://example.com' }],
      videos: [{ name: 'Trailer', videoId: 'abc123xyz09' }],
    } as GameCatalogResult;

    expect(page.detailVideos).toBe(page.detailVideos);
    expect(page.detailWebsites).toBe(page.detailWebsites);
    expect(page.detailWebsiteItems).toBe(page.detailWebsiteItems);
  });

  it('emits trace logs around discover detail open and similar loading', async () => {
    const page = createPage();

    await page.openGameDetail(mockLaneItem);
    await flushAsync();

    expect(debugLogServiceMock.trace).toHaveBeenCalledWith(
      'explore.detail.open',
      expect.objectContaining({
        igdbGameId: mockLaneItem.igdbGameId,
        platformIgdbId: mockLaneItem.platformIgdbId,
        pushedToStack: false,
      })
    );
    expect(debugLogServiceMock.trace).toHaveBeenCalledWith(
      'explore.detail.similar.load_start',
      expect.objectContaining({
        igdbGameId: mockLaneItem.igdbGameId,
        platformIgdbId: mockLaneItem.platformIgdbId,
      })
    );
    expect(debugLogServiceMock.trace).toHaveBeenCalledWith(
      'explore.detail.similar.load_complete',
      expect.objectContaining({
        igdbGameId: mockLaneItem.igdbGameId,
        platformIgdbId: mockLaneItem.platformIgdbId,
      })
    );
  });

  it('logs when a detail navigation stack push actually occurs', async () => {
    const page = createPage() as unknown as {
      activeDetailRecommendation: MockLaneItem | null;
      openGameDetail: (
        item: MockLaneItem,
        options?: { pushCurrentToStack?: boolean }
      ) => Promise<void>;
    };
    const nextItem = {
      ...mockLaneItem,
      igdbGameId: '101',
      platformIgdbId: 48,
    };

    page.activeDetailRecommendation = mockLaneItem;

    await page.openGameDetail(nextItem, { pushCurrentToStack: true });
    await flushAsync();

    expect(debugLogServiceMock.trace).toHaveBeenCalledWith(
      'explore.detail.open',
      expect.objectContaining({
        igdbGameId: nextItem.igdbGameId,
        platformIgdbId: nextItem.platformIgdbId,
        pushedToStack: true,
        activeStackDepth: 1,
      })
    );
  });

  it('does not block popularity mode load while catalog hydration runs', async () => {
    const page = createPage() as unknown as {
      ngOnInit: () => void;
      onExploreModeChange: (mode: 'recommendations' | 'popularity') => Promise<void>;
      ensureVisiblePopularityCatalogHydrated: () => Promise<void>;
      getActivePopularityItems: () => Array<{ id: string }>;
      isLoadingPopularity: boolean;
    };
    page.ngOnInit();
    await flushAsync();

    let resolveHydration: () => void = () => undefined;
    const hydrationPromise = new Promise<void>((resolve) => {
      resolveHydration = resolve;
    });
    const hydrateSpy = vi
      .spyOn(page, 'ensureVisiblePopularityCatalogHydrated')
      .mockReturnValue(hydrationPromise);

    const modeChangePromise = page.onExploreModeChange('popularity');

    let modeChangeSettled = false;
    void modeChangePromise.then(() => {
      modeChangeSettled = true;
    });

    await flushAsync();

    expect(hydrateSpy).toHaveBeenCalledTimes(1);
    expect(modeChangeSettled).toBe(true);
    expect(page.isLoadingPopularity).toBe(false);
    expect(page.getActivePopularityItems()).toHaveLength(1);

    resolveHydration();
    await hydrationPromise;
  });

  it('does not block similar detail load while visible metadata hydration runs', async () => {
    const page = createPage() as unknown as {
      ngOnInit: () => void;
      openGameDetail: (item: RecommendationItem) => Promise<void>;
      ensureVisibleSimilarDisplayMetadata: () => Promise<void>;
      getVisibleSimilarRecommendationItems: () => Array<{ igdbGameId: string }>;
      isGameDetailModalOpen: boolean;
      isLoadingSimilar: boolean;
    };
    page.ngOnInit();
    await flushAsync();

    let resolveHydration: () => void = () => undefined;
    const hydrationPromise = new Promise<void>((resolve) => {
      resolveHydration = resolve;
    });
    const hydrateSpy = vi
      .spyOn(page, 'ensureVisibleSimilarDisplayMetadata')
      .mockReturnValue(hydrationPromise);

    const openPromise = page.openGameDetail(mockLanesResponse.items[0]);

    let openSettled = false;
    void openPromise.then(() => {
      openSettled = true;
    });

    await flushAsync();

    expect(hydrateSpy).toHaveBeenCalledTimes(1);
    expect(openSettled).toBe(true);
    expect(page.isGameDetailModalOpen).toBe(true);
    expect(page.isLoadingSimilar).toBe(false);

    resolveHydration();
    await hydrationPromise;
  });

  it('exposes popularity empty-state conditions when feed returns no items', async () => {
    igdbProxyServiceMock.getPopularityFeed.mockReturnValueOnce(
      of({
        items: [],
        page: { offset: 0, limit: 10, hasMore: false, nextOffset: null },
      })
    );

    const page = createPage();
    page.ngOnInit();
    await flushAsync();

    await page.onExploreModeChange('popularity');

    expect(page.isLoadingPopularity).toBe(false);
    expect(page.popularityError).toBe('');
    expect(page.getActivePopularityItems()).toHaveLength(0);
    expect(page.canLoadMorePopularity()).toBe(false);
  });

  it('exposes popularity error-state conditions when feed request fails', async () => {
    igdbProxyServiceMock.getPopularityFeed.mockReturnValueOnce(
      throwError(() => new Error('Popularity feed unavailable'))
    );

    const page = createPage();
    page.ngOnInit();
    await flushAsync();

    await page.onExploreModeChange('popularity');

    expect(page.isLoadingPopularity).toBe(false);
    expect(page.popularityError).toBe('Popularity feed unavailable');
    expect(page.getActivePopularityItems()).toHaveLength(0);
  });

  it('keeps the latest popularity detail selection when earlier catalog fetch resolves late', async () => {
    const page = createPage() as unknown as {
      openPopularityGameDetail: (item: {
        id: string;
        name: string;
        platformIgdbId: number;
        popularityScore: number;
        coverUrl: string | null;
        rating: number | null;
        firstReleaseDate: number | null;
        platforms: Array<{ id: number; name: string }>;
      }) => Promise<void>;
      fetchCatalogResult: (igdbGameId: string) => Promise<unknown>;
      selectedGameDetail: { igdbGameId: string } | null;
    };

    const deferredResolves = new Map<string, (value: unknown) => void>();
    vi.spyOn(page, 'fetchCatalogResult').mockImplementation(
      (igdbGameId: string) =>
        new Promise((resolve) => {
          deferredResolves.set(igdbGameId, resolve);
        })
    );

    const firstCall = page.openPopularityGameDetail({
      id: '910',
      name: 'First',
      platformIgdbId: 6,
      popularityScore: 120,
      coverUrl: null,
      rating: null,
      firstReleaseDate: null,
      platforms: [{ id: 6, name: 'PC' }],
    });
    const secondCall = page.openPopularityGameDetail({
      id: '920',
      name: 'Second',
      platformIgdbId: 6,
      popularityScore: 121,
      coverUrl: null,
      rating: null,
      firstReleaseDate: null,
      platforms: [{ id: 6, name: 'PC' }],
    });

    deferredResolves.get('920')?.({ igdbGameId: '920', platformIgdbId: 6, platform: 'PC' });
    await secondCall;
    expect(page.selectedGameDetail?.igdbGameId).toBe('920');

    deferredResolves.get('910')?.({ igdbGameId: '910', platformIgdbId: 6, platform: 'PC' });
    await firstCall;
    expect(page.selectedGameDetail?.igdbGameId).toBe('920');
  });

  it('clears similar recommendation paging when opening popularity detail', async () => {
    const page = createPage() as unknown as {
      openPopularityGameDetail: (item: {
        id: string;
        name: string;
        platformIgdbId: number;
        popularityScore: number;
        coverUrl: string | null;
        rating: number | null;
        firstReleaseDate: number | null;
        platforms: Array<{ id: number; name: string }>;
      }) => Promise<void>;
      fetchCatalogResult: (igdbGameId: string) => Promise<unknown>;
      similarRecommendationsPage: {
        offset: number;
        limit: number;
        hasMore: boolean;
        nextOffset: number | null;
      } | null;
    };

    page.similarRecommendationsPage = {
      offset: 5,
      limit: 5,
      hasMore: true,
      nextOffset: 10,
    };
    vi.spyOn(page, 'fetchCatalogResult').mockResolvedValue({
      igdbGameId: '930',
      platformIgdbId: 6,
      platform: 'PC',
    });

    await page.openPopularityGameDetail({
      id: '930',
      name: 'Popular Reset',
      platformIgdbId: 6,
      popularityScore: 99,
      coverUrl: null,
      rating: null,
      firstReleaseDate: null,
      platforms: [{ id: 6, name: 'PC' }],
    });

    expect(page.similarRecommendationsPage).toBeNull();
  });

  it('uses cache and ignores invalid/same selection updates', async () => {
    const page = createPage();
    const privatePage = page as unknown as {
      loadRecommendationLanes: (forceRefresh: boolean) => Promise<void>;
      buildCacheKey: (target: string, runtimeMode: string, lane: string) => string;
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

    const cacheKey = privatePage.buildCacheKey('BACKLOG', 'NEUTRAL', 'overall');
    privatePage.lanesCache.set(cacheKey, mockLanesResponse);
    await privatePage.loadRecommendationLanes(false);
    expect(igdbProxyServiceMock.getRecommendationLanes).toHaveBeenCalledTimes(firstCallCount);
    expect(page.activeLanesResponse?.runId).toBe(1);
  });

  it('does not block cached recommendation loads on metadata hydration', async () => {
    const page = createPage();
    const privatePage = page as unknown as {
      loadRecommendationLanes: (forceRefresh: boolean) => Promise<void>;
      buildCacheKey: (target: string, runtimeMode: string, lane: string) => string;
      lanesCache: Map<string, typeof mockLanesResponse>;
      ensureActiveRecommendationPageFilled: () => Promise<void>;
      ensureVisibleRecommendationDisplayMetadata: () => Promise<void>;
      ensureVisibleDiscoveryPricingHydrated: () => Promise<void>;
    };

    const cacheKey = privatePage.buildCacheKey('BACKLOG', 'NEUTRAL', 'overall');
    privatePage.lanesCache.set(cacheKey, mockLanesResponse);

    const pageFillSpy = vi
      .spyOn(privatePage, 'ensureActiveRecommendationPageFilled')
      .mockResolvedValue(undefined);
    let resolveMetadata: () => void = () => undefined;
    const metadataPromise = new Promise<void>((resolve) => {
      resolveMetadata = resolve;
    });
    const metadataSpy = vi
      .spyOn(privatePage, 'ensureVisibleRecommendationDisplayMetadata')
      .mockReturnValue(metadataPromise);
    const pricingSpy = vi
      .spyOn(privatePage, 'ensureVisibleDiscoveryPricingHydrated')
      .mockResolvedValue(undefined);

    const loadPromise = privatePage.loadRecommendationLanes(false);
    const settled = vi.fn();
    void loadPromise.then(settled);

    await flushAsync();

    expect(pageFillSpy).toHaveBeenCalledTimes(1);
    expect(metadataSpy).toHaveBeenCalledTimes(1);
    expect(pricingSpy).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledTimes(1);

    resolveMetadata();
    await metadataPromise;
  });

  it('does not block fresh recommendation loads while discovery pricing hydration runs', async () => {
    const page = createPage() as unknown as {
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      selectedLaneKey: 'overall' | 'hiddenGems' | 'exploration' | 'blended' | 'popular' | 'recent';
      ensureActiveRecommendationPageFilled: () => Promise<void>;
      ensureVisibleRecommendationDisplayMetadata: () => Promise<void>;
      ensureVisibleDiscoveryPricingHydrated: () => Promise<void>;
      loadRecommendationLanes: (forceRefresh: boolean) => Promise<void>;
      isLoadingRecommendations: boolean;
    };

    page.selectedTarget = 'DISCOVERY';
    page.selectedLaneKey = 'blended';
    const pageFillSpy = vi
      .spyOn(page, 'ensureActiveRecommendationPageFilled')
      .mockResolvedValue(undefined);
    const metadataSpy = vi
      .spyOn(page, 'ensureVisibleRecommendationDisplayMetadata')
      .mockResolvedValue(undefined);
    let resolvePricing: () => void = () => undefined;
    const pricingPromise = new Promise<void>((resolve) => {
      resolvePricing = resolve;
    });
    const pricingSpy = vi
      .spyOn(page, 'ensureVisibleDiscoveryPricingHydrated')
      .mockReturnValue(pricingPromise);

    const loadPromise = page.loadRecommendationLanes(false);

    let loadSettled = false;
    void loadPromise.then(() => {
      loadSettled = true;
    });

    await flushAsync();
    await loadPromise;
    await flushAsync();

    expect(pageFillSpy).toHaveBeenCalledTimes(1);
    expect(metadataSpy).toHaveBeenCalledTimes(1);
    expect(pricingSpy).toHaveBeenCalledTimes(1);
    expect(loadSettled).toBe(true);
    expect(page.isLoadingRecommendations).toBe(false);

    resolvePricing();
    await pricingPromise;
  });

  it('paginates recommendations in pages of 10', async () => {
    const page = createPage();
    const manyItems = Array.from({ length: 25 }, (_, index) => ({
      ...mockLanesResponse.items[0],
      rank: index + 1,
      igdbGameId: String(1000 + index),
    }));
    igdbProxyServiceMock.getRecommendationLanes
      .mockReturnValueOnce(
        of(
          createLaneResponse({
            items: manyItems.slice(0, 10),
            page: { offset: 0, limit: 10, hasMore: true, nextOffset: 10 },
          })
        )
      )
      .mockReturnValueOnce(
        of(
          createLaneResponse({
            items: manyItems.slice(10, 20),
            page: { offset: 10, limit: 10, hasMore: true, nextOffset: 20 },
          })
        )
      )
      .mockReturnValueOnce(
        of(
          createLaneResponse({
            items: manyItems.slice(20),
            page: { offset: 20, limit: 10, hasMore: false, nextOffset: null },
          })
        )
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

  it('does not merge a stale recommendation page after the selected tuple changes', async () => {
    const page = createPage();
    const privatePage = page as unknown as {
      buildCacheKey: (target: string, runtimeMode: string, lane: string) => string;
      lanesCache: Map<string, MockLanesResponse>;
    };

    let resolveNextPage: (value: MockLanesResponse) => void = () => undefined;
    const nextPagePromise = new Promise<MockLanesResponse>((resolve) => {
      resolveNextPage = resolve;
    });

    igdbProxyServiceMock.getRecommendationLanes
      .mockReturnValueOnce(
        of(
          createLaneResponse({
            items: Array.from({ length: 10 }, (_, index) => ({
              ...mockLaneItem,
              rank: index + 1,
              igdbGameId: String(2000 + index),
            })),
            page: { offset: 0, limit: 10, hasMore: true, nextOffset: 10 },
          })
        )
      )
      .mockReturnValueOnce(
        new Observable((subscriber) => {
          void nextPagePromise.then((value) => {
            subscriber.next(value);
            subscriber.complete();
          });
        })
      )
      .mockReturnValueOnce(
        of(
          createLaneResponse({
            runtimeMode: 'SHORT',
            items: [{ ...mockLaneItem, igdbGameId: 'short-1' }],
            page: { offset: 0, limit: 10, hasMore: false, nextOffset: null },
          })
        )
      );

    page.ngOnInit();
    await flushAsync();

    const complete = vi.fn().mockResolvedValue(undefined);
    const loadMorePromise = page.loadMoreRecommendations({
      target: { complete },
    } as unknown as Event);
    await flushAsync();

    await page.onRuntimeModeChange('SHORT');
    await flushAsync();

    resolveNextPage(
      createLaneResponse({
        items: [{ ...mockLaneItem, rank: 11, igdbGameId: 'stale-page' }],
        page: { offset: 10, limit: 10, hasMore: false, nextOffset: null },
      })
    );
    await loadMorePromise;

    expect(page.selectedRuntimeMode).toBe('SHORT');
    expect(page.activeLanesResponse?.runtimeMode).toBe('SHORT');
    expect(page.getActiveLaneItems().map((item) => item.igdbGameId)).toEqual(['short-1']);
    expect(
      privatePage.lanesCache.get(privatePage.buildCacheKey('BACKLOG', 'NEUTRAL', 'overall'))?.items
        .length
    ).toBe(10);
  });

  it('sets recommendation error state when loading another recommendation page fails', async () => {
    const page = createPage();

    igdbProxyServiceMock.getRecommendationLanes
      .mockReturnValueOnce(
        of(
          createLaneResponse({
            items: Array.from({ length: 10 }, (_, index) => ({
              ...mockLaneItem,
              rank: index + 1,
              igdbGameId: String(3000 + index),
            })),
            page: { offset: 0, limit: 10, hasMore: true, nextOffset: 10 },
          })
        )
      )
      .mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 429, statusText: 'Too Many Requests' }))
      );

    page.ngOnInit();
    await flushAsync();

    const complete = vi.fn().mockResolvedValue(undefined);
    await page.loadMoreRecommendations({ target: { complete } } as unknown as Event);

    expect(page.recommendationErrorCode).toBe('RATE_LIMITED');
    expect(page.recommendationError).toBe('Recommendations are in cooldown. Try again later.');
    expect(page.activeLanesResponse?.page.hasMore).toBe(false);
    expect(page.activeLanesResponse?.page.nextOffset).toBeNull();
    expect(page.getActiveLaneItems()).toHaveLength(10);
  });

  it('does not block recommendation load-more while metadata hydration runs', async () => {
    const page = createPage() as unknown as {
      ensureVisibleRecommendationDisplayMetadata: () => Promise<void>;
      ensureVisibleDiscoveryPricingHydrated: () => Promise<void>;
      loadMoreRecommendations: (event: Event) => Promise<void>;
    };

    let resolveMetadata: () => void = () => undefined;
    const metadataPromise = new Promise<void>((resolve) => {
      resolveMetadata = resolve;
    });
    const metadataSpy = vi
      .spyOn(page, 'ensureVisibleRecommendationDisplayMetadata')
      .mockReturnValue(metadataPromise);
    const pricingSpy = vi
      .spyOn(page, 'ensureVisibleDiscoveryPricingHydrated')
      .mockResolvedValue(undefined);
    const complete = vi.fn().mockResolvedValue(undefined);

    const loadMorePromise = page.loadMoreRecommendations({
      target: { complete },
    } as unknown as Event);

    await flushAsync();

    expect(metadataSpy).toHaveBeenCalledTimes(1);
    expect(pricingSpy).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    await loadMorePromise;

    resolveMetadata();
    await metadataPromise;
  });

  it('does not merge a stale popularity page after the selected feed changes', async () => {
    const page = createPage();

    let resolveNextPage: (value: typeof mockPopularityFeedResponse) => void = () => undefined;
    const nextPagePromise = new Promise<typeof mockPopularityFeedResponse>((resolve) => {
      resolveNextPage = resolve;
    });

    igdbProxyServiceMock.getPopularityFeed
      .mockReturnValueOnce(
        of({
          items: Array.from({ length: 10 }, (_, index) => ({
            ...mockPopularityFeedItem,
            id: `trend-${String(index)}`,
          })),
          page: { offset: 0, limit: 10, hasMore: true, nextOffset: 10 },
        })
      )
      .mockReturnValueOnce(
        new Observable((subscriber) => {
          void nextPagePromise.then((value) => {
            subscriber.next(value);
            subscriber.complete();
          });
        })
      )
      .mockReturnValueOnce(
        of({
          items: [{ ...mockPopularityFeedItem, id: 'upcoming-1', name: 'Upcoming Game' }],
          page: { offset: 0, limit: 10, hasMore: false, nextOffset: null },
        })
      );

    await page.onExploreModeChange('popularity');
    await flushAsync();

    const complete = vi.fn().mockResolvedValue(undefined);
    const loadMorePromise = page.loadMorePopularity({
      target: { complete },
    } as unknown as Event);
    await flushAsync();

    await page.onPopularityFeedChange('upcoming');
    await flushAsync();

    resolveNextPage({
      items: [{ ...mockPopularityFeedItem, id: 'stale-popularity', name: 'Stale Trend' }],
      page: { offset: 10, limit: 10, hasMore: false, nextOffset: null },
    });
    await loadMorePromise;

    expect(page.selectedPopularityFeed).toBe('upcoming');
    expect(page.getActivePopularityItems().map((item) => item.id)).toEqual(['upcoming-1']);
  });

  it('sets popularity error state when loading another popularity page fails', async () => {
    const page = createPage();

    igdbProxyServiceMock.getPopularityFeed
      .mockReturnValueOnce(
        of({
          items: Array.from({ length: 10 }, (_, index) => ({
            ...mockPopularityFeedItem,
            id: `trend-${String(index)}`,
          })),
          page: { offset: 0, limit: 10, hasMore: true, nextOffset: 10 },
        })
      )
      .mockReturnValueOnce(throwError(() => new Error('Popularity page unavailable')));

    await page.onExploreModeChange('popularity');
    await flushAsync();

    const complete = vi.fn().mockResolvedValue(undefined);
    await page.loadMorePopularity({ target: { complete } } as unknown as Event);

    expect(page.popularityError).toBe('Popularity page unavailable');
    expect(page.activePopularityResponse?.page.hasMore).toBe(false);
    expect(page.activePopularityResponse?.page.nextOffset).toBeNull();
    expect(page.getActivePopularityItems()).toHaveLength(10);
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
          keywords: [],
        },
      },
    }));
    igdbProxyServiceMock.getRecommendationSimilar
      .mockReturnValueOnce(
        of({
          source: { igdbGameId: '100', platformIgdbId: 6 },
          items: similarItems.slice(0, 5),
          page: { offset: 0, limit: 5, hasMore: true, nextOffset: 5 },
        })
      )
      .mockReturnValueOnce(
        of({
          source: { igdbGameId: '100', platformIgdbId: 6 },
          items: similarItems.slice(5, 10),
          page: { offset: 5, limit: 5, hasMore: true, nextOffset: 10 },
        })
      );

    page.ngOnInit();
    await flushAsync();

    await page.openGameDetail(mockLanesResponse.items[0]);
    await flushAsync();

    expect(page.getVisibleSimilarRecommendationItems()).toHaveLength(5);
    expect(igdbProxyServiceMock.getRecommendationSimilar).toHaveBeenNthCalledWith(1, {
      target: 'BACKLOG',
      runtimeMode: 'NEUTRAL',
      igdbGameId: '100',
      platformIgdbId: 6,
      offset: 0,
      limit: 5,
    });
    const complete = vi.fn().mockResolvedValue(undefined);
    await page.loadMoreSimilarRecommendations({ target: { complete } } as unknown as Event);
    expect(page.getVisibleSimilarRecommendationItems()).toHaveLength(10);
    expect(igdbProxyServiceMock.getRecommendationSimilar).toHaveBeenNthCalledWith(2, {
      target: 'BACKLOG',
      runtimeMode: 'NEUTRAL',
      igdbGameId: '100',
      platformIgdbId: 6,
      offset: 5,
      limit: 5,
    });
  });

  it('disables similar load-more when page metadata is missing nextOffset', () => {
    const page = createPage() as unknown as {
      canLoadMoreSimilarRecommendations: () => boolean;
      similarRecommendationsPage: {
        offset: number;
        limit: number;
        hasMore: boolean;
        nextOffset: number | null;
      } | null;
    };

    page.similarRecommendationsPage = {
      offset: 0,
      limit: 5,
      hasMore: true,
      nextOffset: null,
    };

    expect(page.canLoadMoreSimilarRecommendations()).toBe(false);
  });

  it('auto-loads another similar page when the fetched rows are all filtered out', async () => {
    const page = createPage() as unknown as {
      ignoredRecommendationGameIds: Set<string>;
      getVisibleSimilarRecommendationItems: () => Array<{ igdbGameId: string }>;
      openGameDetail: (item: MockLaneItem) => Promise<void>;
    };

    page.ignoredRecommendationGameIds = new Set(['2000']);
    igdbProxyServiceMock.getRecommendationSimilar
      .mockReturnValueOnce(
        of({
          source: { igdbGameId: '100', platformIgdbId: 6 },
          items: [
            {
              igdbGameId: '2000',
              platformIgdbId: 6,
              similarity: 0.8,
              reasons: {
                summary: 'filtered',
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
                  keywords: [],
                },
              },
            },
          ],
          page: { offset: 0, limit: 5, hasMore: true, nextOffset: 5 },
        })
      )
      .mockReturnValueOnce(
        of({
          source: { igdbGameId: '100', platformIgdbId: 6 },
          items: [
            {
              igdbGameId: '2001',
              platformIgdbId: 6,
              similarity: 0.75,
              reasons: {
                summary: 'visible',
                structuredSimilarity: 0.6,
                semanticSimilarity: 0.7,
                blendedSimilarity: 0.68,
                sharedTokens: {
                  genres: [],
                  developers: [],
                  publishers: [],
                  franchises: [],
                  collections: [],
                  themes: [],
                  keywords: [],
                },
              },
            },
          ],
          page: { offset: 5, limit: 5, hasMore: false, nextOffset: null },
        })
      );

    await page.openGameDetail(mockLanesResponse.items[0]);
    await flushAsync();

    expect(igdbProxyServiceMock.getRecommendationSimilar).toHaveBeenNthCalledWith(1, {
      target: 'BACKLOG',
      runtimeMode: 'NEUTRAL',
      igdbGameId: '100',
      platformIgdbId: 6,
      offset: 0,
      limit: 5,
    });
    expect(igdbProxyServiceMock.getRecommendationSimilar).toHaveBeenNthCalledWith(2, {
      target: 'BACKLOG',
      runtimeMode: 'NEUTRAL',
      igdbGameId: '100',
      platformIgdbId: 6,
      offset: 5,
      limit: 5,
    });
    expect(page.getVisibleSimilarRecommendationItems().map((item) => item.igdbGameId)).toEqual([
      '2001',
    ]);
  });

  it('clears similar items when every fetched page is filtered out', async () => {
    const page = createPage() as unknown as {
      ignoredRecommendationGameIds: Set<string>;
      similarRecommendationItems: Array<{ igdbGameId: string }>;
      similarRecommendationsPage: {
        offset: number;
        limit: number;
        hasMore: boolean;
        nextOffset: number | null;
      } | null;
      getVisibleSimilarRecommendationItems: () => Array<{ igdbGameId: string }>;
      openGameDetail: (item: MockLaneItem) => Promise<void>;
    };

    page.ignoredRecommendationGameIds = new Set(['2100', '2101']);
    igdbProxyServiceMock.getRecommendationSimilar
      .mockReturnValueOnce(
        of({
          source: { igdbGameId: '100', platformIgdbId: 6 },
          items: [
            {
              igdbGameId: '2100',
              platformIgdbId: 6,
              similarity: 0.8,
              reasons: {
                summary: 'filtered',
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
                  keywords: [],
                },
              },
            },
          ],
          page: { offset: 0, limit: 5, hasMore: true, nextOffset: 5 },
        })
      )
      .mockReturnValueOnce(
        of({
          source: { igdbGameId: '100', platformIgdbId: 6 },
          items: [
            {
              igdbGameId: '2101',
              platformIgdbId: 6,
              similarity: 0.75,
              reasons: {
                summary: 'still filtered',
                structuredSimilarity: 0.6,
                semanticSimilarity: 0.7,
                blendedSimilarity: 0.68,
                sharedTokens: {
                  genres: [],
                  developers: [],
                  publishers: [],
                  franchises: [],
                  collections: [],
                  themes: [],
                  keywords: [],
                },
              },
            },
          ],
          page: { offset: 5, limit: 5, hasMore: false, nextOffset: null },
        })
      );

    await page.openGameDetail(mockLanesResponse.items[0]);
    await flushAsync();

    expect(page.getVisibleSimilarRecommendationItems()).toEqual([]);
    expect(page.similarRecommendationItems).toEqual([]);
    expect(page.similarRecommendationsPage).toEqual({
      offset: 5,
      limit: 5,
      hasMore: false,
      nextOffset: null,
    });
  });

  it('lane change fetches the selected lane when it is not cached', async () => {
    const page = createPage();
    page.ngOnInit();
    await flushAsync();

    igdbProxyServiceMock.getRecommendationLanes.mockClear();
    page.onLaneChange('hiddenGems');
    await flushAsync();

    expect(page.selectedLaneKey).toBe('hiddenGems');
    expect(igdbProxyServiceMock.getRecommendationLanes).toHaveBeenCalledWith({
      target: 'BACKLOG',
      lane: 'hiddenGems',
      runtimeMode: 'NEUTRAL',
      offset: 0,
      limit: 10,
    });
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
      ...mockLanesResponse.items[0],
      explanations: {
        ...mockLanesResponse.items[0].explanations,
        bullets: [
          { type: 'taste', label: 'A', evidence: [], delta: 0.5 },
          { type: 'taste', label: '', evidence: [], delta: 0.4 },
          { type: 'taste', label: 'B', evidence: [], delta: 0.001 },
        ],
      },
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
      releaseYear: null,
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
      activeLanesResponse: unknown;
      selectedLaneKey: 'overall';
      completeRefresher: (event: Event) => Promise<void>;
      getTotalActiveRecommendationCount: () => number;
      checkGameAlreadyInLibrary: (game: unknown) => Promise<boolean>;
    };

    page.activeLanesResponse = {
      ...mockLanesResponse,
      items: [
        ...mockLanesResponse.items,
        { ...mockLanesResponse.items[0], rank: 2, platformIgdbId: 9 },
      ],
    };
    page.selectedLaneKey = 'overall';
    expect(page.getTotalActiveRecommendationCount()).toBe(1);

    const complete = vi.fn().mockResolvedValue(undefined);
    await page.completeRefresher({ target: { complete } } as unknown as Event);
    expect(complete).toHaveBeenCalledOnce();
    await page.completeRefresher({ target: null } as unknown as Event);

    expect(
      await page.checkGameAlreadyInLibrary({
        ...mockLanesResponse.items[0],
        igdbGameId: '500',
        platformIgdbId: 6,
        platformOptions: [],
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

    page.onRecommendationRowClick('recommendation', mockLanesResponse.items[0], event);
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
            keywords: [],
          },
        },
      },
      event
    );

    expect(openGameDetail).toHaveBeenCalledTimes(1);
    expect(openSimilarRecommendation).toHaveBeenCalledTimes(1);
  });

  it('blocks hidden recommendation rows and no-id ignore flows', async () => {
    const page = createPage() as unknown as {
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      activeDetailRecommendation: { igdbGameId: string; platformIgdbId: number } | null;
      ignoredRecommendationGameIds: Set<string>;
      libraryOwnedGameIds: Set<string>;
      isGameDetailModalOpen: boolean;
      onRecommendationRowClick: (
        kind: 'recommendation' | 'similar',
        row: { igdbGameId: string; platformIgdbId: number },
        event: Event
      ) => void;
      openGameDetail: (item: { igdbGameId: string; platformIgdbId: number }) => Promise<void>;
      openSimilarRecommendation: (
        item: { igdbGameId: string; platformIgdbId: number },
        event: Event
      ) => Promise<void>;
      confirmIgnoreSelectedGameRecommendation: () => Promise<void>;
      ignoreSelectedGameRecommendation: (params?: { igdbGameId: string; title: string }) => void;
      isActiveDetailIgnored: boolean;
      selectedGameDetail: { igdbGameId: string; title?: string; platformIgdbId: number } | null;
    };
    page.selectedTarget = 'DISCOVERY';
    page.ignoredRecommendationGameIds = new Set(['200']);
    page.libraryOwnedGameIds.clear();
    page.libraryOwnedGameIds.add('100');
    page.activeDetailRecommendation = { igdbGameId: '200', platformIgdbId: 6 };

    const openGameDetail = vi.spyOn(page, 'openGameDetail').mockResolvedValue(undefined as never);
    const openSimilarRecommendation = vi
      .spyOn(page, 'openSimilarRecommendation')
      .mockResolvedValue(undefined as never);
    const event = new Event('click');
    page.onRecommendationRowClick(
      'recommendation',
      { igdbGameId: '100', platformIgdbId: 6 },
      event
    );
    page.onRecommendationRowClick('similar', { igdbGameId: '200', platformIgdbId: 6 }, event);

    expect(openGameDetail).not.toHaveBeenCalled();
    expect(openSimilarRecommendation).not.toHaveBeenCalled();
    expect(page.isActiveDetailIgnored).toBe(true);

    page.isGameDetailModalOpen = false;
    await page.openGameDetail({ igdbGameId: '200', platformIgdbId: 6 } as never);
    expect(page.isGameDetailModalOpen).toBe(false);

    page.activeDetailRecommendation = null;
    page.selectedGameDetail = null;
    await page.confirmIgnoreSelectedGameRecommendation();
    expect(alertControllerMock.create).not.toHaveBeenCalled();
    page.ignoreSelectedGameRecommendation();
    expect(recommendationIgnoreServiceMock.ignoreGame).not.toHaveBeenCalled();
  });

  it('supports rating modal lifecycle and formatted values', () => {
    const page = createPage();
    const libraryGame = {
      igdbGameId: '100',
      platformIgdbId: 6,
      listType: 'collection' as const,
      title: 'Rated',
    };

    page.selectedGameDetail = libraryGame as never;
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

  it('supports shortcut URL routing, websites modal fallbacks, and image fallback', () => {
    const page = createPage() as unknown as {
      selectedGameDetail: { title?: string | null; websites?: unknown[] } | null;
      openWebsitesModal: () => void;
      closeWebsitesModal: () => void;
      openDetailWebsite: (item: { url: string }) => void;
      isWebsitesModalOpen: boolean;
      detailWebsiteItems: Array<{ label: string; url: string }>;
      onImageError: (event: Event) => void;
      openExternalUrl: (url: string) => void;
    };
    const openExternalUrl = vi.spyOn(page, 'openExternalUrl').mockImplementation(() => undefined);

    page.selectedGameDetail = {
      title: 'Pokemon Red',
      websites: [
        { url: 'https://en.wikipedia.org/wiki/Pokemon_Red', typeId: 3, typeName: 'Wikipedia' },
      ],
    };

    expect(page.detailWebsiteItems.map((item) => item.label)).toEqual([
      'Wikipedia',
      'GameFAQs',
      'YouTube',
      'Google',
    ]);
    expect(page.detailWebsiteItems.find((item) => item.label === 'Wikipedia')?.url).toBe(
      'https://en.wikipedia.org/wiki/Pokemon_Red'
    );
    expect(page.detailWebsiteItems.find((item) => item.label === 'YouTube')?.url).toContain(
      'youtube.com/results?search_query='
    );
    page.detailWebsiteItems.forEach((item) => {
      page.openDetailWebsite(item);
    });
    expect(openExternalUrl).toHaveBeenCalledTimes(4);

    page.openWebsitesModal();
    expect(page.isWebsitesModalOpen).toBe(true);
    page.openDetailWebsite({ url: 'https://example.com' });
    expect(page.isWebsitesModalOpen).toBe(false);
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com');
    page.closeWebsitesModal();
    expect(page.isWebsitesModalOpen).toBe(false);

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
      videos: [{ id: 1, name: 'Trailer', videoId: 'PIF_fqFZEuk', url: '' }],
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
      videos: [{ id: 1, name: 'Invalid', videoId: 'abc def', url: '' }],
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
    page.activeDetailRecommendation = mockLanesResponse.items[0];
    page.detailNavigationStack = [mockLanesResponse.items[0]];
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
            keywords: [],
          },
        },
      },
    ];
    page.similarRecommendationsPage = {
      offset: 5,
      limit: 5,
      hasMore: true,
      nextOffset: 10,
    };
    page.closeGameDetailModal();
    expect(page.isGameDetailModalOpen).toBe(false);
    expect(page.isRatingModalOpen).toBe(false);
    expect(page.detailContext).toBe('explore');
    expect(page.detailNavigationStack).toEqual([]);
    expect(page.similarRecommendationItems).toEqual([]);
    expect(page.similarRecommendationsPage).toBeNull();
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
      updatedAt: '2026-03-03T00:00:00.000Z',
    };
    page.selectedGameDetail = libraryGame;

    gameShelfServiceMock.setGameStatus.mockResolvedValue({
      ...libraryGame,
      status: 'playing',
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
      onDidDismiss: vi.fn().mockResolvedValue({ role: 'cancel' }),
    });
    await page.openDetailTags();
  });

  it('covers add-to-library flow branches', async () => {
    const page = createPage() as unknown as {
      detailContext: 'explore' | 'library';
      isSelectedGameInLibrary: boolean;
      isAddToLibraryLoading: boolean;
      selectedGameDetail: unknown;
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      selectedLaneKey: 'overall' | 'hiddenGems' | 'exploration' | 'blended' | 'popular' | 'recent';
      activeLanesResponse: typeof mockLanesResponse | null;
      activePopularityItems: Array<{ id: string }>;
      getActivePopularityItems: () => Array<{ id: string }>;
      getActiveLaneItems: () => Array<{ igdbGameId: string }>;
      localGameCacheByIdentity: Map<string, unknown>;
      libraryOwnedGameIds: Set<string>;
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
      platformOptions: [{ id: 6, name: 'PC' }],
    };
    vi.spyOn(page, 'pickListTypeForAdd').mockResolvedValue('collection');
    addToLibraryWorkflowMock.addToLibrary.mockResolvedValue({
      status: 'duplicate',
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
        updatedAt: '2026-03-03T00:00:00.000Z',
      },
    });
    await page.addSelectedGameToLibrary();
    expect(page.detailContext).toBe('library');

    page.selectedTarget = 'DISCOVERY';
    page.selectedLaneKey = 'blended';
    page.activeLanesResponse = createLaneResponse({
      target: 'DISCOVERY',
      lane: 'blended',
      items: [{ ...mockLanesResponse.items[0], igdbGameId: '300', platformIgdbId: 6 }],
    });
    page.localGameCacheByIdentity.clear();
    page.libraryOwnedGameIds.clear();
    expect(page.getActiveLaneItems().some((item) => item.igdbGameId === '300')).toBe(true);

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
      platformOptions: [{ id: 6, name: 'PC' }],
    };
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
        updatedAt: '2026-03-03T00:00:00.000Z',
      },
    });
    await page.addSelectedGameToLibrary();
    expect(page.getActiveLaneItems().some((item) => item.igdbGameId === '300')).toBe(false);

    page.activePopularityItems = [{ id: '300' }, { id: '301' }];
    expect(page.getActivePopularityItems()).toEqual([{ id: '301' }]);
  });

  it('caches visible popularity items until ownership or feed data changes', () => {
    const page = createPage() as unknown as {
      activePopularityItems: Array<{ id: string }>;
      getVisiblePopularityItems: () => Array<{ id: string }>;
      markGameIdAsOwned: (igdbGameId: string) => void;
    };

    page.activePopularityItems = [{ id: '300' }, { id: '301' }];

    const firstVisibleItems = page.getVisiblePopularityItems();
    const secondVisibleItems = page.getVisiblePopularityItems();

    expect(secondVisibleItems).toBe(firstVisibleItems);

    page.markGameIdAsOwned('300');

    const filteredVisibleItems = page.getVisiblePopularityItems();
    expect(filteredVisibleItems).toEqual([{ id: '301' }]);
    expect(filteredVisibleItems).not.toBe(firstVisibleItems);

    page.activePopularityItems = [{ id: '302' }];

    const refreshedVisibleItems = page.getVisiblePopularityItems();
    expect(refreshedVisibleItems).toEqual([{ id: '302' }]);
    expect(refreshedVisibleItems).not.toBe(filteredVisibleItems);
  });

  it('covers recommendation visibility helpers and hidden-stack navigation branches', () => {
    const page = createPage() as unknown as {
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      detailNavigationStack: Array<{ igdbGameId: string; platformIgdbId: number }>;
      activeLanesResponse: typeof mockLanesResponse | null;
      ignoredRecommendationGameIds: Set<string>;
      libraryOwnedGameIds: Set<string>;
      similarRecommendationItems: Array<{ igdbGameId: string; platformIgdbId: number }>;
      filterAlreadyInLibrarySimilarItems: (
        items: Array<{ igdbGameId: string }>
      ) => Array<{ igdbGameId: string }>;
      markGameIdAsOwned: (igdbGameId: string) => void;
      goBackInDetailNavigation: () => void;
      openGameDetail: (item: unknown) => Promise<void>;
    };

    page.selectedTarget = 'DISCOVERY';
    page.libraryOwnedGameIds.clear();
    page.libraryOwnedGameIds.add('100');
    page.ignoredRecommendationGameIds = new Set(['200']);
    page.similarRecommendationItems = [
      { igdbGameId: '100', platformIgdbId: 6 },
      { igdbGameId: '200', platformIgdbId: 6 },
      { igdbGameId: '300', platformIgdbId: 6 },
    ] as never;

    expect(
      page.filterAlreadyInLibrarySimilarItems([
        { igdbGameId: '100' },
        { igdbGameId: '300' },
      ] as never)
    ).toEqual([{ igdbGameId: '300' }]);

    page.selectedTarget = 'BACKLOG';
    const unfiltered = [{ igdbGameId: '100' }];
    expect(page.filterAlreadyInLibrarySimilarItems(unfiltered as never)).toBe(unfiltered);

    const beforeOwnedSize = page.libraryOwnedGameIds.size;
    page.markGameIdAsOwned('   ');
    expect(page.libraryOwnedGameIds.size).toBe(beforeOwnedSize);

    const openGameDetail = vi.spyOn(page, 'openGameDetail').mockResolvedValue(undefined as never);
    page.selectedTarget = 'DISCOVERY';
    page.detailNavigationStack = [
      { igdbGameId: '100', platformIgdbId: 6 },
      { igdbGameId: '200', platformIgdbId: 6 },
    ];
    page.goBackInDetailNavigation();
    expect(openGameDetail).not.toHaveBeenCalled();

    page.selectedTarget = 'BACKLOG';
    page.detailNavigationStack = [{ igdbGameId: '300', platformIgdbId: 6 }];
    page.goBackInDetailNavigation();
    expect(openGameDetail).toHaveBeenCalledTimes(1);
  });

  it('covers ignored and library filters for recommendation and similar lists', () => {
    const page = createPage() as unknown as {
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      ignoredRecommendationGameIds: Set<string>;
      libraryOwnedGameIds: Set<string>;
      filterAlreadyInLibrarySimilarItems: (
        items: Array<{ igdbGameId: string }>
      ) => Array<{ igdbGameId: string }>;
      filterIgnoredRecommendationItems: (
        items: Array<{ igdbGameId: string }>
      ) => Array<{ igdbGameId: string }>;
      filterIgnoredSimilarItems: (
        items: Array<{ igdbGameId: string }>
      ) => Array<{ igdbGameId: string }>;
    };

    page.selectedTarget = 'DISCOVERY';
    page.libraryOwnedGameIds.clear();
    expect(page.filterAlreadyInLibrarySimilarItems([{ igdbGameId: '1' }] as never)).toEqual([
      { igdbGameId: '1' },
    ]);

    page.ignoredRecommendationGameIds = new Set(['2']);
    expect(
      page.filterIgnoredRecommendationItems([{ igdbGameId: '1' }, { igdbGameId: '2' }] as never)
    ).toEqual([{ igdbGameId: '1' }]);
    expect(
      page.filterIgnoredSimilarItems([{ igdbGameId: '2' }, { igdbGameId: '3' }] as never)
    ).toEqual([{ igdbGameId: '3' }]);
  });

  it('filters duplicate add-to-library game even if local cache refresh fails', async () => {
    const page = createPage() as unknown as {
      detailContext: 'explore' | 'library';
      isSelectedGameInLibrary: boolean;
      isAddToLibraryLoading: boolean;
      selectedGameDetail: {
        igdbGameId: string;
        title: string;
        coverUrl: null;
        coverSource: 'none';
        platform: string;
        platformIgdbId: number;
        platformOptions: Array<{ id: number; name: string }>;
      } | null;
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      selectedLaneKey: 'overall' | 'hiddenGems' | 'exploration' | 'blended' | 'popular' | 'recent';
      activeLanesResponse: typeof mockLanesResponse | null;
      localGameCacheByIdentity: Map<string, unknown>;
      libraryOwnedGameIds: Set<string>;
      getActiveLaneItems: () => Array<{ igdbGameId: string }>;
      pickListTypeForAdd: () => Promise<'collection' | 'wishlist' | null>;
      addSelectedGameToLibrary: () => Promise<void>;
    };

    page.selectedTarget = 'DISCOVERY';
    page.selectedLaneKey = 'blended';
    page.activeLanesResponse = createLaneResponse({
      target: 'DISCOVERY',
      lane: 'blended',
      items: [{ ...mockLanesResponse.items[0], igdbGameId: '300', platformIgdbId: 6 }],
    });
    page.localGameCacheByIdentity.clear();
    page.libraryOwnedGameIds.clear();
    expect(page.getActiveLaneItems().some((item) => item.igdbGameId === '300')).toBe(true);

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
      platformOptions: [{ id: 6, name: 'PC' }],
    };
    vi.spyOn(page, 'pickListTypeForAdd').mockResolvedValue('collection');
    addToLibraryWorkflowMock.addToLibrary.mockResolvedValueOnce({ status: 'duplicate' });
    gameShelfServiceMock.listLibraryGames.mockRejectedValueOnce(new Error('refresh failed'));

    await page.addSelectedGameToLibrary();

    expect(page.isSelectedGameInLibrary).toBe(true);
    expect(page.libraryOwnedGameIds.has('300')).toBe(true);
    expect(page.getActiveLaneItems().some((item) => item.igdbGameId === '300')).toBe(false);
  });

  it('opens discover header popover and routes settings action', async () => {
    const page = createPage() as unknown as {
      isHeaderActionsPopoverOpen: boolean;
      headerActionsPopoverEvent: Event | undefined;
      openHeaderActionsPopover: (event: Event) => void;
      openSettingsFromPopover: () => Promise<void>;
    };
    const event = { type: 'click' } as unknown as Event;
    let resolveDismiss: ((value: boolean) => void) | undefined;

    popoverControllerMock.dismiss.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveDismiss = resolve;
        })
    );

    page.openHeaderActionsPopover(event);
    expect(page.isHeaderActionsPopoverOpen).toBe(true);
    expect(page.headerActionsPopoverEvent).toBe(event);

    const openSettingsPromise = page.openSettingsFromPopover();

    await Promise.resolve();

    expect(popoverControllerMock.dismiss).toHaveBeenCalled();
    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();

    resolveDismiss?.(true);
    await openSettingsPromise;

    expect(popoverControllerMock.dismiss).toHaveBeenCalled();
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/settings');
    expect(popoverControllerMock.dismiss.mock.invocationCallOrder[0]).toBeLessThan(
      routerMock.navigateByUrl.mock.invocationCallOrder[0]
    );
    expect(page.isHeaderActionsPopoverOpen).toBe(false);
    expect(page.headerActionsPopoverEvent).toBeUndefined();
  });

  it('routes settings even when header popover dismissal rejects', async () => {
    const page = createPage() as unknown as {
      isHeaderActionsPopoverOpen: boolean;
      headerActionsPopoverEvent: Event | undefined;
      openHeaderActionsPopover: (event: Event) => void;
      openSettingsFromPopover: () => Promise<void>;
    };
    const event = { type: 'click' } as unknown as Event;

    popoverControllerMock.dismiss.mockRejectedValueOnce(new Error('dismiss failed'));

    page.openHeaderActionsPopover(event);
    await page.openSettingsFromPopover();

    expect(popoverControllerMock.dismiss).toHaveBeenCalled();
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/settings');
    expect(page.isHeaderActionsPopoverOpen).toBe(false);
    expect(page.headerActionsPopoverEvent).toBeUndefined();
  });

  it('confirms ignore with captured game identity even if selection changes before confirm', async () => {
    const page = createPage() as unknown as {
      activeDetailRecommendation: { igdbGameId: string; platformIgdbId: number } | null;
      selectedGameDetail: { igdbGameId: string; title: string; platformIgdbId: number } | null;
      confirmIgnoreSelectedGameRecommendation: () => Promise<void>;
    };
    page.activeDetailRecommendation = { igdbGameId: '100', platformIgdbId: 6 };
    page.selectedGameDetail = { igdbGameId: '100', title: 'Alpha', platformIgdbId: 6 };

    alertControllerMock.create.mockResolvedValueOnce({
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn().mockImplementation(() => {
        page.activeDetailRecommendation = { igdbGameId: '200', platformIgdbId: 48 };
        page.selectedGameDetail = { igdbGameId: '200', title: 'Beta', platformIgdbId: 48 };
        return Promise.resolve({ role: 'confirm' });
      }),
    });

    await page.confirmIgnoreSelectedGameRecommendation();

    expect(recommendationIgnoreServiceMock.ignoreGame).toHaveBeenCalledWith({
      igdbGameId: '100',
      title: 'Alpha',
    });
  });

  it('navigates to the previous non-ignored detail item when the active detail becomes ignored', () => {
    const ignoredIds$ = new Subject<Set<string>>();
    recommendationIgnoreServiceMock.ignoredIds$ = ignoredIds$;

    const page = createPage() as unknown as {
      activeDetailRecommendation: MockLaneItem | null;
      detailNavigationStack: MockLaneItem[];
      openGameDetail: (item: MockLaneItem) => Promise<void>;
    };
    const previousItem = {
      ...mockLaneItem,
      igdbGameId: '200',
    };
    const activeItem = {
      ...mockLaneItem,
      igdbGameId: '300',
    };
    const openGameDetail = vi.spyOn(page, 'openGameDetail').mockResolvedValue(undefined as never);

    page.detailNavigationStack = [previousItem];
    page.activeDetailRecommendation = activeItem;

    ignoredIds$.next(new Set(['300']));

    expect(openGameDetail).toHaveBeenCalledWith(previousItem);
  });

  it('closes the detail modal when the active detail becomes ignored without a fallback item', () => {
    const ignoredIds$ = new Subject<Set<string>>();
    recommendationIgnoreServiceMock.ignoredIds$ = ignoredIds$;

    const page = createPage() as unknown as {
      activeDetailRecommendation: MockLaneItem | null;
      detailNavigationStack: MockLaneItem[];
      closeGameDetailModal: () => void;
    };
    const closeGameDetailModal = vi.spyOn(page, 'closeGameDetailModal');

    page.detailNavigationStack = [];
    page.activeDetailRecommendation = {
      ...mockLaneItem,
      igdbGameId: '301',
    };

    ignoredIds$.next(new Set(['301']));

    expect(closeGameDetailModal).toHaveBeenCalledTimes(1);
  });

  it('shows the lane-specific empty-state message when filtering removes selected lane items', () => {
    const page = createPage() as unknown as {
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      selectedLaneKey: 'overall' | 'hiddenGems' | 'exploration' | 'blended' | 'popular' | 'recent';
      activeLanesResponse: typeof mockLanesResponse | null;
      upsertLocalGameCache: (entry: {
        igdbGameId: string;
        platformIgdbId: number;
        title: string;
      }) => void;
      getActiveLaneItems: () => Array<{ igdbGameId: string }>;
      getEmptyStateMessage: () => string;
    };

    page.selectedTarget = 'DISCOVERY';
    page.selectedLaneKey = 'blended';
    page.activeLanesResponse = createLaneResponse({
      target: 'DISCOVERY',
      lane: 'blended',
      items: [{ ...mockLanesResponse.items[0], igdbGameId: '900', platformIgdbId: 6 }],
    });
    page.upsertLocalGameCache({
      igdbGameId: '900',
      platformIgdbId: 6,
      title: 'Owned',
    });

    expect(page.getActiveLaneItems()).toHaveLength(0);
    expect(page.getEmptyStateMessage()).toBe(
      'This lane has no items for the current target and runtime mode.'
    );
  });

  it('shows the general empty-state message when the active lane has no items', () => {
    const page = createPage() as unknown as {
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      selectedLaneKey: 'overall' | 'hiddenGems' | 'exploration' | 'blended' | 'popular' | 'recent';
      activeLanesResponse: typeof mockLanesResponse | null;
      getActiveLaneItems: () => Array<{ igdbGameId: string }>;
      getEmptyStateMessage: () => string;
    };

    page.selectedTarget = 'DISCOVERY';
    page.selectedLaneKey = 'blended';
    page.activeLanesResponse = createLaneResponse({
      target: 'DISCOVERY',
      lane: 'blended',
      items: [],
    });

    expect(page.getActiveLaneItems()).toHaveLength(0);
    expect(page.getEmptyStateMessage()).toBe('No recommendation items available right now.');
  });

  it('covers empty-state, similar-display, and parser helper branches', () => {
    const page = createPage() as unknown as {
      activeLanesResponse: typeof mockLanesResponse | null;
      recommendationErrorCode: 'NONE' | 'NOT_FOUND' | 'RATE_LIMITED' | 'REQUEST_FAILED';
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      selectedLaneKey: 'overall' | 'hiddenGems' | 'exploration' | 'blended' | 'popular' | 'recent';
      selectedRuntimeMode: 'NEUTRAL' | 'SHORT' | 'LONG';
      hasLoadedSelectedLaneItems: () => boolean;
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
      items: [],
    };
    page.recommendationErrorCode = 'NOT_FOUND';
    expect(page.getEmptyStateMessage()).toContain('No materialized recommendations');
    expect(page.hasLoadedSelectedLaneItems()).toBe(false);

    page.activeLanesResponse = {
      ...mockLanesResponse,
      items: [
        {
          ...mockLanesResponse.items[0],
          explanations: {
            ...mockLanesResponse.items[0].explanations,
            matchedTokens: {
              ...mockLanesResponse.items[0].explanations.matchedTokens,
              themes: ['Fantasy'],
              keywords: ['turn-based combat'],
            },
          },
        },
      ],
    };
    expect(page.hasLoadedSelectedLaneItems()).toBe(true);
    expect(page.getEmptyStateTokenHint()).toContain('Fantasy');

    page.selectedLaneKey = 'popular';
    expect(page.hasLoadedSelectedLaneItems()).toBe(false);
    expect(page.getEmptyStateTokenHint()).toBe('');

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
          keywords: [],
        },
      },
    };
    expect(page.getSimilarContext(similar)).toContain('Platform 6');
    expect(page.getSimilarTitle(similar)).toContain('Game #77');
    expect(page.getSimilarCoverUrl(similar)).toContain('placeholder');
    expect(page.getSimilarReasonBadges(similar)[0]?.text).toContain('Blend');

    const openGameDetail = vi.spyOn(page, 'openGameDetail').mockResolvedValue(undefined as never);
    page.detailNavigationStack = [mockLanesResponse.items[0]];
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
      refreshExplore: (event: Event) => Promise<void>;
      getDisplayTitle: (item: (typeof mockLanesResponse.items)[0]) => string;
      getPlatformLabel: (item: (typeof mockLanesResponse.items)[0]) => string;
      getReleaseYear: (item: (typeof mockLanesResponse.items)[0]) => number | null;
      getCoverUrl: (item: (typeof mockLanesResponse.items)[0]) => string;
      getScoreBadge: (item: (typeof mockLanesResponse.items)[0]) => { text: string };
      getConfidenceBadge: (item: (typeof mockLanesResponse.items)[0]) => { text: string };
      canLoadMoreRecommendations: () => boolean;
      visibleRecommendationCount: number;
      activeLanesResponse: typeof mockLanesResponse | null;
      invalidateRecommendationVisibility: () => void;
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
    await privatePage.refreshExplore({ target: { complete } } as unknown as Event);
    expect(complete).toHaveBeenCalledOnce();

    const row = mockLanesResponse.items[0];
    const key = privatePage.buildIdentityKey(row.igdbGameId, row.platformIgdbId);
    privatePage.localGameCacheByIdentity.clear();
    privatePage.recommendationDisplayMetadata.set(key, {
      title: 'Catalog Fallback Title',
      coverUrl: null,
      platformLabel: 'PlayStation 2',
      releaseYear: 2002,
    });

    expect(privatePage.getDisplayTitle(row)).toBe('Catalog Fallback Title');
    expect(privatePage.getPlatformLabel(row)).toBe('PlayStation 2');
    expect(privatePage.getReleaseYear(row)).toBe(2002);
    expect(privatePage.getCoverUrl(row)).toContain('placeholder');
    expect(privatePage.getScoreBadge(row).text).toContain('Score');
    expect(privatePage.getConfidenceBadge(row).text).toContain('Confidence');

    privatePage.activeLanesResponse = {
      ...mockLanesResponse,
      items: [
        { ...row, igdbGameId: '200' },
        { ...row, rank: 2, igdbGameId: '201' },
      ],
    };
    privatePage.invalidateRecommendationVisibility();
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
      items: [
        mockLanesResponse.items[0],
        { ...mockLanesResponse.items[0], rank: 2, platformIgdbId: 9 },
      ],
    };
    page.selectedLaneKey = 'overall';
    expect(page.getMergedPlatformLabels(mockLanesResponse.items[0])).toBeTruthy();
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
            keywords: [],
          },
        },
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
    await page.loadSimilarRecommendations(mockLanesResponse.items[0]);
    expect(page.similarRecommendationsError).toBe('');
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
      offset: 0,
      limit: 5,
    });
    expect(scrollToTop).toHaveBeenCalledWith(0);
    expect(page.selectedGameDetail?.igdbGameId).toBe('100');
  });

  it('keeps summary expansion available for recommendation detail opened from cached catalog data', async () => {
    const page = createPage() as unknown as {
      catalogCache: Map<string, GameCatalogResult>;
      openGameDetail: (item: MockLaneItem) => Promise<void>;
    };
    const row = {
      ...mockLaneItem,
      igdbGameId: '701',
      platformIgdbId: 48,
    };
    page.catalogCache.set(
      '701',
      createCatalogResult('701', 48, {
        summary:
          'This queued discover summary is long enough to overflow once the modal width settles.',
      })
    );

    await page.openGameDetail(row);

    const harness = await createExploreDetailComponentHarness(page);

    expect(harness.component.canToggleDetailText('summary')).toBe(false);
    harness.summaryCollapsedState.scrollHeight = 170;
    triggerResizeObserver(harness.resizeObservers);

    expect(harness.component.canToggleDetailText('summary')).toBe(true);
    expect(harness.component.canToggleDetailText('storyline')).toBe(false);
    harness.component.ngOnDestroy();
  });

  it('keeps summary expansion available for recommendation detail loaded from IGDB after open', async () => {
    const page = createPage();
    const row = {
      ...mockLaneItem,
      igdbGameId: '702',
      platformIgdbId: 6,
    };
    igdbProxyServiceMock.getGameById.mockReturnValueOnce(
      of(
        createCatalogResult('702', 6, {
          summary:
            'This fetched discover summary becomes expandable after the modal content resizes.',
        })
      )
    );

    await page.openGameDetail(row);

    const harness = await createExploreDetailComponentHarness(page);

    expect(harness.component.canToggleDetailText('summary')).toBe(false);
    harness.summaryCollapsedState.scrollHeight = 168;
    triggerResizeObserver(harness.resizeObservers);

    expect(harness.component.canToggleDetailText('summary')).toBe(true);
    expect(harness.component.canToggleDetailText('storyline')).toBe(false);
    harness.component.ngOnDestroy();
  });

  it('keeps storyline expansion available for popularity detail opened from cached catalog data', async () => {
    const page = createPage() as unknown as {
      catalogCache: Map<string, GameCatalogResult>;
      openPopularityGameDetail: (item: typeof mockPopularityFeedItem) => Promise<void>;
    };
    page.catalogCache.set(
      '801',
      createCatalogResult('801', 6, {
        storyline:
          'This popularity storyline should still expose the toggle after the modal reflows.',
      })
    );

    await page.openPopularityGameDetail({
      ...mockPopularityFeedItem,
      id: '801',
      platformIgdbId: 6,
      name: 'Popularity Cached',
    });

    const harness = await createExploreDetailComponentHarness(page);

    expect(harness.component.canToggleDetailText('storyline')).toBe(false);
    harness.storylineCollapsedState.scrollHeight = 166;
    triggerResizeObserver(harness.resizeObservers);

    expect(harness.component.canToggleDetailText('storyline')).toBe(true);
    expect(harness.component.canToggleDetailText('summary')).toBe(false);
    harness.component.ngOnDestroy();
  });

  it('keeps storyline expansion available for popularity detail loaded from IGDB after open', async () => {
    const page = createPage();
    igdbProxyServiceMock.getGameById.mockReturnValueOnce(
      of(
        createCatalogResult('802', 167, {
          platform: 'PlayStation 5',
          platforms: ['PlayStation 5'],
          platformOptions: [{ id: 167, name: 'PlayStation 5' }],
          storyline:
            'This fetched popularity storyline becomes expandable once the modal width is final.',
        })
      )
    );

    await page.openPopularityGameDetail({
      ...mockPopularityFeedItem,
      id: '802',
      platformIgdbId: 167,
      name: 'Popularity Fetched',
      platforms: [{ id: 167, name: 'PlayStation 5' }],
    });

    const harness = await createExploreDetailComponentHarness(page);

    expect(harness.component.canToggleDetailText('storyline')).toBe(false);
    harness.storylineCollapsedState.scrollHeight = 172;
    triggerResizeObserver(harness.resizeObservers);

    expect(harness.component.canToggleDetailText('storyline')).toBe(true);
    expect(harness.component.canToggleDetailText('summary')).toBe(false);
    harness.component.ngOnDestroy();
  });

  it('ignores similar responses after the detail modal closes', async () => {
    const page = createPage();
    let emitResponse:
      | ((response: {
          source: { igdbGameId: string; platformIgdbId: number };
          page: { offset: number; limit: number; hasMore: boolean; nextOffset: number | null };
          items: Array<{
            igdbGameId: string;
            platformIgdbId: number;
            similarity: number;
            reasons: {
              summary: string;
              structuredSimilarity: number;
              semanticSimilarity: number;
              blendedSimilarity: number;
              sharedTokens: {
                genres: string[];
                developers: string[];
                publishers: string[];
                franchises: string[];
                collections: string[];
                themes: string[];
                keywords: string[];
              };
            };
          }>;
        }) => void)
      | null = null;

    igdbProxyServiceMock.getRecommendationSimilar.mockReturnValueOnce(
      new Observable((subscriber) => {
        emitResponse = (response) => {
          subscriber.next(response);
          subscriber.complete();
        };
      })
    );

    await page.openGameDetail(mockLanesResponse.items[0]);
    page.closeGameDetailModal();
    emitResponse?.({
      source: { igdbGameId: '100', platformIgdbId: 6 },
      page: { offset: 0, limit: 5, hasMore: true, nextOffset: 5 },
      items: [
        {
          igdbGameId: '200',
          platformIgdbId: 6,
          similarity: 0.8,
          reasons: {
            summary: 'late result',
            structuredSimilarity: 0.5,
            semanticSimilarity: 0.8,
            blendedSimilarity: 0.8,
            sharedTokens: {
              genres: [],
              developers: [],
              publishers: [],
              franchises: [],
              collections: [],
              themes: [],
              keywords: [],
            },
          },
        },
      ],
    });
    await flushAsync();

    expect(page.similarRecommendationItems).toEqual([]);
    expect(page.similarRecommendationsPage).toBeNull();
    expect(page.similarRecommendationsError).toBe('');
    expect(page.isLoadingSimilar).toBe(false);
  });

  it('ignores similar errors after the detail modal closes', async () => {
    const page = createPage();
    let failRequest: ((error: unknown) => void) | null = null;

    igdbProxyServiceMock.getRecommendationSimilar.mockReturnValueOnce(
      new Observable((subscriber) => {
        failRequest = (error) => {
          subscriber.error(error);
        };
      })
    );

    await page.openGameDetail(mockLanesResponse.items[0]);
    page.closeGameDetailModal();
    failRequest?.(new Error('late failure'));
    await flushAsync();

    expect(page.similarRecommendationItems).toEqual([]);
    expect(page.similarRecommendationsPage).toBeNull();
    expect(page.similarRecommendationsError).toBe('');
    expect(page.isLoadingSimilar).toBe(false);
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
        platformOptions: [{ id: 12 }, { id: 12 }, { id: 4.5 }, { id: -1 }, { id: 0 }],
      })
    ).toEqual([12]);
    expect(
      page.collectPlatformIgdbIds({
        igdbGameId: '302',
        platformIgdbId: 6,
        platformOptions: null,
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
        listType: 'collection',
      })
    ).resolves.toBe(true);

    gameShelfServiceMock.findGameByIdentity.mockResolvedValue(null);
    await expect(
      page.checkGameAlreadyInLibrary({
        igdbGameId: '501',
        platformIgdbId: 0,
        platformOptions: [],
      })
    ).resolves.toBe(false);

    const openedWindow = { opener: {} } as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(openedWindow);
    page.openExternalUrl('https://example.com/game');
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/game',
      '_blank',
      'noopener,noreferrer'
    );
    expect(openedWindow.opener).toBeNull();
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
          { id: 48, name: 'PS4' },
        ],
      })
    );

    await page.populateRecommendationDisplayMetadata(new Map([['700', new Set([6, 48])]]));

    const first = page.recommendationDisplayMetadata.get(page.buildIdentityKey('700', 6));
    const second = page.recommendationDisplayMetadata.get(page.buildIdentityKey('700', 48));
    expect(first?.title).toBe('Game #700');
    expect(first?.platformLabel).toBe('PC');
    expect(second?.platformLabel).toBe('PS4');
  });

  it('formats discovery row pricing from cached recommendation metadata', () => {
    const page = createPage() as unknown as {
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      recommendationDisplayMetadata: Map<
        string,
        {
          title: string;
          coverUrl: string | null;
          platformLabel: string;
          releaseYear: number | null;
          priceCurrency?: string | null;
          priceAmount?: number | null;
          priceRegularAmount?: number | null;
          priceDiscountPercent?: number | null;
          priceIsFree?: boolean | null;
        }
      >;
      buildIdentityKey: (igdbGameId: string, platformIgdbId: number) => string;
      getRecommendationRowPriceLabel: (item: {
        igdbGameId: string;
        platformIgdbId: number;
      }) => string | null;
      isRecommendationRowPriceOnDiscount: (item: {
        igdbGameId: string;
        platformIgdbId: number;
      }) => boolean;
    };

    page.selectedTarget = 'DISCOVERY';
    page.recommendationDisplayMetadata.set(page.buildIdentityKey('700', 167), {
      title: 'Sample',
      coverUrl: null,
      platformLabel: 'PS5',
      releaseYear: 2025,
      priceCurrency: 'EUR',
      priceAmount: 19.99,
      priceRegularAmount: 39.99,
      priceDiscountPercent: 50,
      priceIsFree: false,
    });
    gameShelfServiceMock.isGameOnDiscount.mockReturnValueOnce(true);

    expect(page.getRecommendationRowPriceLabel({ igdbGameId: '700', platformIgdbId: 167 })).toBe(
      'EUR\xa019.99'
    );
    expect(
      page.isRecommendationRowPriceOnDiscount({ igdbGameId: '700', platformIgdbId: 167 })
    ).toBe(true);
  });

  it('hides recommendation row pricing outside discovery target', () => {
    const page = createPage() as unknown as {
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      recommendationDisplayMetadata: Map<
        string,
        {
          title: string;
          coverUrl: string | null;
          platformLabel: string;
          releaseYear: number | null;
          priceAmount?: number | null;
        }
      >;
      buildIdentityKey: (igdbGameId: string, platformIgdbId: number) => string;
      getRecommendationRowPriceLabel: (item: {
        igdbGameId: string;
        platformIgdbId: number;
      }) => string | null;
    };

    page.selectedTarget = 'BACKLOG';
    page.recommendationDisplayMetadata.set(page.buildIdentityKey('700', 6), {
      title: 'Sample',
      coverUrl: null,
      platformLabel: 'PC',
      releaseYear: 2025,
      priceAmount: 9.99,
    });

    expect(
      page.getRecommendationRowPriceLabel({ igdbGameId: '700', platformIgdbId: 6 })
    ).toBeNull();
  });

  it('hydrates discovery row pricing via PSPrices when metadata lacks price fields', async () => {
    const page = createPage() as unknown as {
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      selectedLaneKey: 'overall' | 'hiddenGems' | 'exploration' | 'blended' | 'popular' | 'recent';
      loadRecommendationLanes: (forceRefresh: boolean) => Promise<void>;
      ensureVisibleDiscoveryPricingHydrated: () => Promise<void>;
      getRecommendationRowPriceLabel: (item: {
        igdbGameId: string;
        platformIgdbId: number;
      }) => string | null;
    };

    page.selectedTarget = 'DISCOVERY';
    page.selectedLaneKey = 'blended';
    igdbProxyServiceMock.getRecommendationLanes.mockReturnValueOnce(
      of(
        createLaneResponse({
          target: 'DISCOVERY',
          lane: 'blended',
          runId: 99,
          generatedAt: '2026-03-11T00:00:00.000Z',
          items: [
            {
              ...mockLaneItem,
              igdbGameId: '700',
              platformIgdbId: 167,
              scoreTotal: 1.2,
              scoreComponents: {
                taste: 0.1,
                novelty: 0.1,
                runtimeFit: 0.1,
                criticBoost: 0.1,
                recencyBoost: 0.1,
                semantic: 0.1,
                exploration: 0.1,
                diversityPenalty: 0,
                repeatPenalty: 0,
              },
              explanations: {
                headline: '',
                bullets: [],
                matchedTokens: {
                  genres: [],
                  developers: [],
                  publishers: [],
                  franchises: [],
                  collections: [],
                  themes: [],
                  keywords: [],
                },
              },
            },
          ],
        })
      )
    );
    igdbProxyServiceMock.getGameById.mockReturnValueOnce(of(null));
    igdbProxyServiceMock.lookupPsPrices.mockReturnValueOnce(
      of({
        status: 'ok',
        bestPrice: {
          currency: 'EUR',
          amount: 39.9,
          regularAmount: 79.9,
          discountPercent: 50,
          isFree: false,
        },
      })
    );

    await page.loadRecommendationLanes(true);
    await page.ensureVisibleDiscoveryPricingHydrated();

    expect(igdbProxyServiceMock.lookupPsPrices).toHaveBeenCalledWith('700', 167, {
      title: null,
    });
    expect(page.getRecommendationRowPriceLabel({ igdbGameId: '700', platformIgdbId: 167 })).toBe(
      'EUR\xa039.90'
    );
  });

  it('hydrates discovery row pricing via Steam and skips unsupported platforms', async () => {
    const page = createPage() as unknown as {
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      selectedLaneKey: 'overall' | 'hiddenGems' | 'exploration' | 'blended' | 'popular' | 'recent';
      loadRecommendationLanes: (forceRefresh: boolean) => Promise<void>;
      ensureVisibleDiscoveryPricingHydrated: () => Promise<void>;
      getRecommendationRowPriceLabel: (item: {
        igdbGameId: string;
        platformIgdbId: number;
      }) => string | null;
    };

    page.selectedTarget = 'DISCOVERY';
    page.selectedLaneKey = 'blended';
    igdbProxyServiceMock.getRecommendationLanes.mockReturnValueOnce(
      of(
        createLaneResponse({
          target: 'DISCOVERY',
          lane: 'blended',
          runId: 100,
          generatedAt: '2026-03-11T00:00:00.000Z',
          items: [
            {
              ...mockLaneItem,
              rank: 1,
              igdbGameId: '800',
              platformIgdbId: 6,
              scoreTotal: 1.2,
              scoreComponents: {
                taste: 0.1,
                novelty: 0.1,
                runtimeFit: 0.1,
                criticBoost: 0.1,
                recencyBoost: 0.1,
                semantic: 0.1,
                exploration: 0.1,
                diversityPenalty: 0,
                repeatPenalty: 0,
              },
            },
            {
              ...mockLaneItem,
              rank: 2,
              igdbGameId: '801',
              platformIgdbId: 3,
              scoreTotal: 1.1,
              scoreComponents: {
                taste: 0.1,
                novelty: 0.1,
                runtimeFit: 0.1,
                criticBoost: 0.1,
                recencyBoost: 0.1,
                semantic: 0.1,
                exploration: 0.1,
                diversityPenalty: 0,
                repeatPenalty: 0,
              },
            },
          ],
        })
      )
    );
    igdbProxyServiceMock.getGameById.mockReturnValue(of(null));
    igdbProxyServiceMock.lookupSteamPrice.mockReturnValueOnce(
      of({
        status: 'ok',
        bestPrice: {
          currency: 'USD',
          amount: 27.99,
          initialAmount: 39.99,
          cut: 30,
          isFree: false,
        },
      })
    );

    await page.loadRecommendationLanes(true);
    await page.ensureVisibleDiscoveryPricingHydrated();

    expect(igdbProxyServiceMock.lookupSteamPrice).toHaveBeenCalledWith('800', 6);
    expect(igdbProxyServiceMock.lookupPsPrices).not.toHaveBeenCalled();
    expect(page.getRecommendationRowPriceLabel({ igdbGameId: '800', platformIgdbId: 6 })).toBe(
      '$\xa027.99'
    );
    expect(
      page.getRecommendationRowPriceLabel({ igdbGameId: '801', platformIgdbId: 3 })
    ).toBeNull();
  });

  it('covers discovery pricing parser guard branches', () => {
    const page = createPage() as unknown as {
      parseSteamPriceLookupResponse: (value: unknown) => unknown;
      parsePsPricesLookupResponse: (value: unknown) => unknown;
      normalizePriceBoolean: (value: unknown) => boolean | null;
      normalizePriceNumber: (value: unknown) => number | null;
    };

    expect(page.parseSteamPriceLookupResponse(null)).toBeNull();
    expect(page.parseSteamPriceLookupResponse({ status: 'unavailable' })).toBeNull();
    expect(
      page.parseSteamPriceLookupResponse({
        status: 'ok',
        bestPrice: { amount: null, isFree: false },
      })
    ).toBeNull();
    expect(
      page.parsePsPricesLookupResponse({ status: 'ok', bestPrice: { amount: 0, isFree: true } })
    ).toEqual({
      currency: null,
      amount: 0,
      regularAmount: null,
      discountPercent: null,
      isFree: true,
    });
    expect(page.normalizePriceBoolean('true')).toBe(true);
    expect(page.normalizePriceBoolean('false')).toBe(false);
    expect(page.normalizePriceBoolean('x')).toBeNull();
    expect(page.normalizePriceNumber('19.995')).toBe(20);
    expect(page.normalizePriceNumber(-1)).toBeNull();
  });

  it('covers remaining PSPrices parser guard and catalog fetch failure branches', async () => {
    const page = createPage() as unknown as {
      parsePsPricesLookupResponse: (value: unknown) => unknown;
      fetchCatalogResult: (igdbGameId: string) => Promise<unknown>;
    };

    expect(page.parsePsPricesLookupResponse({ status: 'not_ok', bestPrice: {} })).toBeNull();
    expect(
      page.parsePsPricesLookupResponse({ status: 'ok', bestPrice: { amount: null, isFree: false } })
    ).toBeNull();

    igdbProxyServiceMock.getGameById.mockReturnValueOnce(throwError(() => new Error('boom')));
    await expect(page.fetchCatalogResult('999')).resolves.toBeNull();
  });

  it('covers title hint and local pricing helper branches', () => {
    const page = createPage() as unknown as {
      localGameCacheByIdentity: Map<
        string,
        {
          title: string;
          priceAmount: number | null;
          priceRegularAmount: number | null;
          priceDiscountPercent: number | null;
          priceIsFree: boolean | null;
        }
      >;
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
      getRecommendationTitleHint: (item: {
        igdbGameId: string;
        platformIgdbId: number;
      }) => string | null;
      getRecommendationPricing: (item: { igdbGameId: string; platformIgdbId: number }) => {
        priceAmount: number | null;
        priceRegularAmount: number | null;
        priceDiscountPercent: number | null;
        priceIsFree: boolean | null;
      } | null;
      parsePsPricesLookupResponse: (value: unknown) => unknown;
    };

    const key = page.buildIdentityKey('900', 6);
    page.recommendationDisplayMetadata.set(key, {
      title: 'Metadata Title',
      coverUrl: null,
      platformLabel: 'PC',
      releaseYear: null,
    });
    expect(page.getRecommendationTitleHint({ igdbGameId: '900', platformIgdbId: 6 })).toBe(
      'Metadata Title'
    );

    page.localGameCacheByIdentity.set(key, {
      title: 'Local Title',
      priceAmount: 12.5,
      priceRegularAmount: 20,
      priceDiscountPercent: 37.5,
      priceIsFree: false,
    });
    const localPricing = page.getRecommendationPricing({ igdbGameId: '900', platformIgdbId: 6 });
    expect(localPricing?.priceAmount).toBe(12.5);
    expect(page.getRecommendationTitleHint({ igdbGameId: '900', platformIgdbId: 6 })).toBe(
      'Local Title'
    );

    expect(page.parsePsPricesLookupResponse('bad-payload')).toBeNull();
  });

  it('covers similar metadata dedupe and null-pricing hydration branches', async () => {
    const page = createPage() as unknown as {
      recommendationDisplayMetadata: Map<string, { title: string }>;
      buildIdentityKey: (igdbGameId: string, platformIgdbId: number) => string;
      ensureSimilarDisplayMetadata: (
        items: Array<{ igdbGameId: string; platformIgdbId: number }>
      ) => Promise<void>;
      populateRecommendationDisplayMetadata: (grouped: Map<string, Set<number>>) => Promise<void>;
      hydrateDiscoveryPricingForItem: (item: {
        igdbGameId: string;
        platformIgdbId: number;
      }) => Promise<void>;
      getRecommendationRowPriceLabel: (item: {
        igdbGameId: string;
        platformIgdbId: number;
      }) => string | null;
    };

    const existingKey = page.buildIdentityKey('910', 6);
    page.recommendationDisplayMetadata.set(existingKey, { title: 'Existing' });
    const populateSpy = vi.fn((_grouped: Map<string, Set<number>>) => Promise.resolve(undefined));
    (
      page as unknown as { populateRecommendationDisplayMetadata: typeof populateSpy }
    ).populateRecommendationDisplayMetadata = populateSpy;

    await page.ensureSimilarDisplayMetadata([
      { igdbGameId: '910', platformIgdbId: 6 },
      { igdbGameId: '910', platformIgdbId: 48 },
      { igdbGameId: '910', platformIgdbId: 167 },
    ]);
    expect(populateSpy).toHaveBeenCalledTimes(1);
    const grouped = populateSpy.mock.calls[0]?.[0];
    expect(grouped.get('910')).toEqual(new Set([48, 167]));

    igdbProxyServiceMock.lookupPsPrices.mockReturnValueOnce(of({ status: 'unavailable' }));
    await page.hydrateDiscoveryPricingForItem({ igdbGameId: '911', platformIgdbId: 167 });
    expect(igdbProxyServiceMock.lookupPsPrices).toHaveBeenCalledWith('911', 167, { title: null });
    expect(
      page.getRecommendationRowPriceLabel({ igdbGameId: '911', platformIgdbId: 167 })
    ).toBeNull();
  });

  it('hydrates recommendation display metadata for visible lane rows only', async () => {
    const page = createPage() as unknown as {
      selectedLaneKey: 'overall' | 'hiddenGems' | 'exploration' | 'blended' | 'popular' | 'recent';
      visibleRecommendationCount: number;
      activeLanesResponse: MockLanesResponse | null;
      ensureVisibleRecommendationDisplayMetadata: () => Promise<void>;
      populateRecommendationDisplayMetadata: (grouped: Map<string, Set<number>>) => Promise<void>;
    };

    page.selectedLaneKey = 'overall';
    page.visibleRecommendationCount = 1;
    page.activeLanesResponse = createLaneResponse({
      target: 'DISCOVERY',
      lane: 'overall',
      items: [
        { ...mockLaneItem, igdbGameId: '1500', platformIgdbId: 6 },
        { ...mockLaneItem, igdbGameId: '1501', platformIgdbId: 48 },
      ],
    });

    const populateSpy = vi.fn((_grouped: Map<string, Set<number>>) => Promise.resolve(undefined));
    (
      page as unknown as { populateRecommendationDisplayMetadata: typeof populateSpy }
    ).populateRecommendationDisplayMetadata = populateSpy;

    await page.ensureVisibleRecommendationDisplayMetadata();

    expect(populateSpy).toHaveBeenCalledTimes(1);
    const grouped = populateSpy.mock.calls[0]?.[0];
    expect(Array.from(grouped.keys())).toEqual(['1500']);
    expect(grouped.get('1500')).toEqual(new Set([6]));
    expect(grouped.has('1501')).toBe(false);
    expect(grouped.has('2500')).toBe(false);
  });

  it('hydrates recommendation metadata from the provided response when it is not active', async () => {
    const page = createPage() as unknown as {
      selectedLaneKey: 'overall' | 'hiddenGems' | 'exploration' | 'blended' | 'popular' | 'recent';
      visibleRecommendationCount: number;
      activeLanesResponse: MockLanesResponse | null;
      ensureVisibleRecommendationDisplayMetadata: (
        response?: MockLanesResponse | null
      ) => Promise<void>;
      populateRecommendationDisplayMetadata: (grouped: Map<string, Set<number>>) => Promise<void>;
    };

    page.selectedLaneKey = 'overall';
    page.visibleRecommendationCount = 2;
    page.activeLanesResponse = createLaneResponse({
      lane: 'overall',
      items: [{ ...mockLaneItem, igdbGameId: 'active-1', platformIgdbId: 6 }],
    });

    const alternateResponse: MockLanesResponse = createLaneResponse({
      lane: 'overall',
      items: [
        { ...mockLaneItem, igdbGameId: 'alt-1', platformIgdbId: 48 },
        { ...mockLaneItem, igdbGameId: 'alt-2', platformIgdbId: 167 },
      ],
    });

    const populateSpy = vi.fn((_grouped: Map<string, Set<number>>) => Promise.resolve(undefined));
    (
      page as unknown as { populateRecommendationDisplayMetadata: typeof populateSpy }
    ).populateRecommendationDisplayMetadata = populateSpy;

    await page.ensureVisibleRecommendationDisplayMetadata(alternateResponse);

    expect(populateSpy).toHaveBeenCalledTimes(1);
    const grouped = populateSpy.mock.calls[0]?.[0];
    expect(Array.from(grouped.keys())).toEqual(['alt-1', 'alt-2']);
    expect(grouped.has('active-1')).toBe(false);
  });

  it('skips local similar items when collecting display metadata', async () => {
    const page = createPage() as unknown as {
      localGameCacheByIdentity: Map<string, unknown>;
      buildIdentityKey: (igdbGameId: string, platformIgdbId: number) => string;
      ensureSimilarDisplayMetadata: (
        items: Array<{ igdbGameId: string; platformIgdbId: number }>
      ) => Promise<void>;
      populateRecommendationDisplayMetadata: (grouped: Map<string, Set<number>>) => Promise<void>;
    };

    page.localGameCacheByIdentity.set(page.buildIdentityKey('910', 6), {
      igdbGameId: '910',
      platformIgdbId: 6,
    });
    const populateSpy = vi
      .spyOn(page, 'populateRecommendationDisplayMetadata')
      .mockResolvedValue(undefined);

    await page.ensureSimilarDisplayMetadata([{ igdbGameId: '910', platformIgdbId: 6 }]);

    expect(populateSpy).not.toHaveBeenCalled();
  });

  it('hydrates similar metadata for visible rows only', async () => {
    const page = createPage() as unknown as {
      similarRecommendationItems: Array<{ igdbGameId: string; platformIgdbId: number }>;
      visibleSimilarRecommendationCount: number;
      ensureVisibleSimilarDisplayMetadata: () => Promise<void>;
      populateRecommendationDisplayMetadata: (grouped: Map<string, Set<number>>) => Promise<void>;
    };

    page.similarRecommendationItems = [
      { igdbGameId: '910', platformIgdbId: 6 },
      { igdbGameId: '911', platformIgdbId: 48 },
      { igdbGameId: '912', platformIgdbId: 167 },
    ];
    page.visibleSimilarRecommendationCount = 2;

    const populateSpy = vi.fn((_grouped: Map<string, Set<number>>) => Promise.resolve(undefined));
    (
      page as unknown as { populateRecommendationDisplayMetadata: typeof populateSpy }
    ).populateRecommendationDisplayMetadata = populateSpy;

    await page.ensureVisibleSimilarDisplayMetadata();

    expect(populateSpy).toHaveBeenCalledTimes(1);
    const grouped = populateSpy.mock.calls[0]?.[0];
    expect(Array.from(grouped.keys())).toEqual(['910', '911']);
    expect(grouped.has('912')).toBe(false);
  });

  it('passes recommendation title hints through PSPrices discovery hydration lookups', async () => {
    const page = createPage() as unknown as {
      recommendationDisplayMetadata: Map<string, { title: string }>;
      buildIdentityKey: (igdbGameId: string, platformIgdbId: number) => string;
      hydrateDiscoveryPricingForItem: (item: {
        igdbGameId: string;
        platformIgdbId: number;
      }) => Promise<void>;
    };

    page.recommendationDisplayMetadata.set(page.buildIdentityKey('912', 167), {
      title: 'Night In The Woods',
    });
    igdbProxyServiceMock.lookupPsPrices.mockReturnValueOnce(of({ status: 'unavailable' }));

    await page.hydrateDiscoveryPricingForItem({ igdbGameId: '912', platformIgdbId: 167 });

    expect(igdbProxyServiceMock.lookupPsPrices).toHaveBeenCalledWith('912', 167, {
      title: 'Night In The Woods',
    });
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
        onDidDismiss: vi.fn().mockResolvedValue({ role: 'confirm' }),
      };
    });

    const confirmWishlistPromise = page.pickListTypeForAdd();
    selectedHandler?.('wishlist');
    await expect(confirmWishlistPromise).resolves.toBe('wishlist');

    alertControllerMock.create.mockResolvedValueOnce({
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn().mockResolvedValue({ role: 'cancel' }),
    });
    await expect(page.pickListTypeForAdd()).resolves.toBeNull();
  });

  it('single-flights visible discovery pricing hydration across overlapping calls', async () => {
    const page = createPage() as unknown as {
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      selectedLaneKey: 'overall';
      visibleRecommendationCount: number;
      activeLanesResponse: typeof mockLanesResponse | null;
      ensureVisibleDiscoveryPricingHydrated: () => Promise<void>;
      hydrateDiscoveryPricingInBatches: (
        items: Array<{ igdbGameId: string; platformIgdbId: number }>
      ) => Promise<void>;
    };

    page.selectedTarget = 'DISCOVERY';
    page.selectedLaneKey = 'overall';
    page.visibleRecommendationCount = 10;
    page.activeLanesResponse = createLaneResponse({
      target: 'DISCOVERY',
      lane: 'overall',
      items: [{ ...mockLanesResponse.items[0], igdbGameId: '1200', platformIgdbId: 6 }],
    });

    let resolveHydration: () => void = () => undefined;
    const hydrationPromise = new Promise<void>((resolve) => {
      resolveHydration = resolve;
    });
    const hydrateSpy = vi.fn(() => hydrationPromise);
    page.hydrateDiscoveryPricingInBatches = hydrateSpy;

    const firstRun = page.ensureVisibleDiscoveryPricingHydrated();
    const secondRun = page.ensureVisibleDiscoveryPricingHydrated();

    expect(hydrateSpy).toHaveBeenCalledTimes(1);
    resolveHydration();
    await Promise.all([firstRun, secondRun]);
  });

  it('single-flights duplicate catalog lookups while a request is in flight', async () => {
    const page = createPage() as unknown as {
      fetchCatalogResult: (igdbGameId: string) => Promise<unknown>;
      catalogCache: Map<string, unknown>;
      catalogRequestCache: Map<string, Promise<unknown>>;
    };

    let resolveRequest: (value: unknown) => void = () => undefined;
    igdbProxyServiceMock.getGameById.mockImplementationOnce(
      () =>
        new Observable((subscriber) => {
          resolveRequest = (value) => {
            subscriber.next(value);
            subscriber.complete();
          };
        })
    );

    const firstRequest = page.fetchCatalogResult('1700');
    const secondRequest = page.fetchCatalogResult('1700');

    expect(igdbProxyServiceMock.getGameById).toHaveBeenCalledTimes(1);

    const response = {
      title: 'Catalog',
      coverUrl: null,
      platform: 'PC',
      platformIgdbId: 6,
      platformOptions: [{ id: 6, name: 'PC' }],
      releaseYear: 2024,
    };
    resolveRequest(response);

    await expect(firstRequest).resolves.toEqual(response);
    await expect(secondRequest).resolves.toEqual(response);
    expect(page.catalogCache.has('1700')).toBe(true);
    expect(page.catalogRequestCache.size).toBe(0);
  });

  it('normalizes catalog cache keys across fetch and read paths', async () => {
    const page = createPage() as unknown as {
      fetchCatalogResult: (igdbGameId: string) => Promise<unknown>;
      getCatalogResult: (igdbGameId: string) => unknown;
      catalogCache: Map<string, unknown>;
    };

    const response = {
      title: 'Catalog',
      coverUrl: null,
      platform: 'PC',
      platformIgdbId: 6,
      platformOptions: [{ id: 6, name: 'PC' }],
      releaseYear: 2024,
    };
    igdbProxyServiceMock.getGameById.mockReturnValueOnce(of(response));

    await expect(page.fetchCatalogResult(' 1701 ')).resolves.toEqual(response);

    expect(igdbProxyServiceMock.getGameById).toHaveBeenCalledWith('1701');
    expect(page.catalogCache.has('1701')).toBe(true);
    expect(page.getCatalogResult('1701')).toEqual(response);
    expect(page.getCatalogResult(' 1701 ')).toEqual(response);
  });

  it('rechecks discovery hydration when a rerun is requested without candidates', async () => {
    const page = createPage() as unknown as {
      selectedTarget: 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
      selectedLaneKey: 'overall' | 'hiddenGems' | 'exploration' | 'blended' | 'popular' | 'recent';
      visibleRecommendationCount: number;
      activeLanesResponse: unknown;
      recommendationDisplayMetadata: Map<
        string,
        {
          title: string;
          coverUrl: string | null;
          platformLabel: string;
          releaseYear: number | null;
          priceAmount?: number | null;
          priceIsFree?: boolean | null;
        }
      >;
      buildIdentityKey: (igdbGameId: string, platformIgdbId: number) => string;
      runVisibleDiscoveryPricingHydration: () => Promise<void>;
      hydrateDiscoveryPricingInBatches: (
        items: Array<{ igdbGameId: string; platformIgdbId: number }>
      ) => Promise<void>;
      isDiscoveryPricingHydrationRerunRequested: () => boolean;
    };

    page.selectedTarget = 'DISCOVERY';
    page.selectedLaneKey = 'overall';
    page.visibleRecommendationCount = 10;
    page.activeLanesResponse = createLaneResponse({
      target: 'DISCOVERY',
      lane: 'overall',
      items: [{ ...mockLanesResponse.items[0], igdbGameId: '1201', platformIgdbId: 6 }],
    });
    page.recommendationDisplayMetadata.set(page.buildIdentityKey('1201', 6), {
      title: 'Cached price',
      coverUrl: null,
      platformLabel: 'PC',
      releaseYear: 2024,
      priceAmount: 19.99,
      priceIsFree: false,
    });

    const hydrateSpy = vi
      .spyOn(page, 'hydrateDiscoveryPricingInBatches')
      .mockResolvedValue(undefined);
    let rerunChecks = 0;
    vi.spyOn(page, 'isDiscoveryPricingHydrationRerunRequested').mockImplementation(() => {
      rerunChecks += 1;
      page.selectedTarget = 'BACKLOG';
      return true;
    });

    await page.runVisibleDiscoveryPricingHydration();

    expect(hydrateSpy).not.toHaveBeenCalled();
    expect(rerunChecks).toBe(1);
  });

  it('reuses cached popularity feed and schedules hydration without refetching', async () => {
    const page = createPage() as unknown as {
      selectedExploreMode: 'recommendations' | 'popularity';
      popularityError: string;
      isLoadingPopularity: boolean;
      activePopularityItems: typeof mockPopularityFeedResponse.items;
      popularityFeedCache: Map<string, typeof mockPopularityFeedResponse>;
      loadPopularityFeed: (forceRefresh: boolean) => Promise<void>;
      ensureVisiblePopularityCatalogHydrated: () => Promise<void>;
    };

    const cachedFeed = {
      items: [{ ...mockPopularityFeedItem, id: '777' }],
      page: { ...mockPopularityFeedResponse.page },
    };
    page.selectedExploreMode = 'popularity';
    page.popularityError = 'stale';
    page.popularityFeedCache.set('trending', cachedFeed);
    const hydrateSpy = vi
      .spyOn(page, 'ensureVisiblePopularityCatalogHydrated')
      .mockResolvedValue(undefined);
    igdbProxyServiceMock.getPopularityFeed.mockClear();

    await page.loadPopularityFeed(false);

    expect(igdbProxyServiceMock.getPopularityFeed).not.toHaveBeenCalled();
    expect(page.popularityError).toBe('');
    expect(page.activePopularityItems).toEqual(cachedFeed.items);
    expect(page.isLoadingPopularity).toBe(false);
    expect(hydrateSpy).toHaveBeenCalledTimes(1);
  });

  it('force refreshes popularity feed after clearing attempted hydration ids', async () => {
    const page = createPage() as unknown as {
      selectedExploreMode: 'recommendations' | 'popularity';
      activePopularityItems: typeof mockPopularityFeedResponse.items;
      popularityFeedCache: Map<string, typeof mockPopularityFeedResponse>;
      popularityCatalogHydrationAttempted: Set<string>;
      loadPopularityFeed: (forceRefresh: boolean) => Promise<void>;
      ensureVisiblePopularityCatalogHydrated: () => Promise<void>;
    };

    const refreshedFeed = {
      items: [{ ...mockPopularityFeedItem, id: '888' }],
      page: { ...mockPopularityFeedResponse.page },
    };
    page.selectedExploreMode = 'popularity';
    page.popularityFeedCache.set('trending', {
      items: [{ ...mockPopularityFeedItem, id: 'old' }],
      page: { ...mockPopularityFeedResponse.page },
    });
    page.popularityCatalogHydrationAttempted.add('stale');
    const hydrateSpy = vi
      .spyOn(page, 'ensureVisiblePopularityCatalogHydrated')
      .mockResolvedValue(undefined);
    igdbProxyServiceMock.getPopularityFeed.mockReturnValueOnce(of(refreshedFeed));

    await page.loadPopularityFeed(true);

    expect(igdbProxyServiceMock.getPopularityFeed).toHaveBeenCalledWith({
      feedType: 'trending',
      offset: 0,
      limit: 10,
    });
    expect(page.popularityCatalogHydrationAttempted.size).toBe(0);
    expect(page.activePopularityItems).toEqual(refreshedFeed.items);
    expect(hydrateSpy).toHaveBeenCalledTimes(1);
  });

  it('exits popularity catalog hydration immediately outside popularity mode', async () => {
    const page = createPage() as unknown as {
      selectedExploreMode: 'recommendations' | 'popularity';
      popularityCatalogHydrationRerunRequested: boolean;
      ensureVisiblePopularityCatalogHydrated: () => Promise<void>;
      runVisiblePopularityCatalogHydration: () => Promise<void>;
    };

    page.selectedExploreMode = 'recommendations';
    page.popularityCatalogHydrationRerunRequested = true;
    const runSpy = vi
      .spyOn(page, 'runVisiblePopularityCatalogHydration')
      .mockResolvedValue(undefined);

    await page.ensureVisiblePopularityCatalogHydrated();

    expect(runSpy).not.toHaveBeenCalled();
    expect(page.popularityCatalogHydrationRerunRequested).toBe(false);
  });

  it('skips non-actionable popularity hydration candidates', async () => {
    const page = createPage() as unknown as {
      selectedExploreMode: 'recommendations' | 'popularity';
      activePopularityItems: typeof mockPopularityFeedResponse.items;
      visiblePopularityCount: number;
      localGameCacheByIdentity: Map<string, unknown>;
      catalogCache: Map<string, unknown>;
      popularityCatalogHydrationInFlight: Set<string>;
      popularityCatalogHydrationAttempted: Set<string>;
      buildIdentityKey: (igdbGameId: string, platformIgdbId: number) => string;
      runVisiblePopularityCatalogHydration: () => Promise<void>;
      fetchCatalogResult: (igdbGameId: string) => Promise<unknown>;
    };

    page.selectedExploreMode = 'popularity';
    page.visiblePopularityCount = 10;
    page.activePopularityItems = [
      { ...mockPopularityFeedItem, id: '   ' },
      { ...mockPopularityFeedItem, id: 'local' },
      { ...mockPopularityFeedItem, id: 'cached' },
      { ...mockPopularityFeedItem, id: 'in-flight' },
      { ...mockPopularityFeedItem, id: 'attempted' },
    ];
    page.localGameCacheByIdentity.set(page.buildIdentityKey('local', 6), {
      igdbGameId: 'local',
      platformIgdbId: 6,
    });
    page.catalogCache.set('cached', {});
    page.popularityCatalogHydrationInFlight.add('in-flight');
    page.popularityCatalogHydrationAttempted.add('attempted');
    const fetchSpy = vi.spyOn(page, 'fetchCatalogResult').mockResolvedValue(null);

    await page.runVisiblePopularityCatalogHydration();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not block popularity load-more while catalog hydration runs', async () => {
    const page = createPage() as unknown as {
      ensureVisiblePopularityCatalogHydrated: () => Promise<void>;
      loadMorePopularity: (event: Event) => Promise<void>;
    };

    let resolveHydration: () => void = () => undefined;
    const hydrationPromise = new Promise<void>((resolve) => {
      resolveHydration = resolve;
    });
    const hydrateSpy = vi
      .spyOn(page, 'ensureVisiblePopularityCatalogHydrated')
      .mockReturnValue(hydrationPromise);
    const complete = vi.fn().mockResolvedValue(undefined);

    const loadMorePromise = page.loadMorePopularity({ target: { complete } } as unknown as Event);

    await flushAsync();

    expect(hydrateSpy).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);

    resolveHydration();
    await hydrationPromise;
    await loadMorePromise;
  });

  it('single-flights visible popularity catalog hydration across overlapping calls', async () => {
    const page = createPage() as unknown as {
      selectedExploreMode: 'recommendations' | 'popularity';
      activePopularityItems: Array<{ id: string; platformIgdbId: number }>;
      visiblePopularityCount: number;
      popularityCatalogHydrationAttempted: Set<string>;
      ensureVisiblePopularityCatalogHydrated: () => Promise<void>;
      fetchCatalogResult: (igdbGameId: string) => Promise<unknown>;
    };

    page.selectedExploreMode = 'popularity';
    page.activePopularityItems = [{ id: '1300', platformIgdbId: 6 }];
    page.visiblePopularityCount = 10;

    let resolveHydration: () => void = () => undefined;
    const hydrationPromise = new Promise<void>((resolve) => {
      resolveHydration = resolve;
    });

    const fetchSpy = vi
      .spyOn(page, 'fetchCatalogResult')
      .mockImplementation(() => hydrationPromise);

    const firstRun = page.ensureVisiblePopularityCatalogHydrated();
    const secondRun = page.ensureVisiblePopularityCatalogHydrated();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('1300');

    resolveHydration();
    await Promise.all([firstRun, secondRun]);

    expect(page.popularityCatalogHydrationAttempted.has('1300')).toBe(true);
  });

  it('stops popularity catalog hydration when switching away from popularity mode', async () => {
    const page = createPage() as unknown as {
      selectedExploreMode: 'recommendations' | 'popularity';
      activePopularityItems: Array<{ id: string; platformIgdbId: number }>;
      visiblePopularityCount: number;
      ensureVisiblePopularityCatalogHydrated: () => Promise<void>;
      fetchCatalogResult: (igdbGameId: string) => Promise<unknown>;
    };

    page.selectedExploreMode = 'popularity';
    page.activePopularityItems = [
      { id: '1300', platformIgdbId: 6 },
      { id: '1301', platformIgdbId: 6 },
      { id: '1302', platformIgdbId: 6 },
      { id: '1303', platformIgdbId: 6 },
      { id: '1304', platformIgdbId: 6 },
    ];
    page.visiblePopularityCount = 10;

    let resolveFirstBatch: () => void = () => undefined;
    const firstBatchPromise = new Promise<void>((resolve) => {
      resolveFirstBatch = resolve;
    });

    const fetchSpy = vi
      .spyOn(page, 'fetchCatalogResult')
      .mockImplementation((igdbGameId) =>
        ['1300', '1301', '1302', '1303'].includes(igdbGameId)
          ? firstBatchPromise
          : Promise.resolve(undefined)
      );

    const hydrationPromise = page.ensureVisiblePopularityCatalogHydrated();
    await flushAsync();

    expect(fetchSpy).toHaveBeenCalledTimes(4);

    page.selectedExploreMode = 'recommendations';
    resolveFirstBatch();

    await hydrationPromise;

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(fetchSpy).not.toHaveBeenCalledWith('1304');
  });

  it('reruns popularity catalog hydration when a request lands after await and before cleanup', async () => {
    const page = createPage() as unknown as {
      selectedExploreMode: 'recommendations' | 'popularity';
      popularityCatalogHydrationRunPromise: Promise<void> | null;
      popularityCatalogHydrationRerunRequested: boolean;
      ensureVisiblePopularityCatalogHydrated: () => Promise<void>;
      runVisiblePopularityCatalogHydration: () => Promise<void>;
    };

    page.selectedExploreMode = 'popularity';

    let resolveCurrentRun: () => void = () => undefined;
    page.popularityCatalogHydrationRunPromise = new Promise<void>((resolve) => {
      resolveCurrentRun = resolve;
    });

    const rerunSpy = vi
      .spyOn(page, 'runVisiblePopularityCatalogHydration')
      .mockImplementation(() => {
        page.popularityCatalogHydrationRerunRequested = false;
        return Promise.resolve();
      });

    const waitingCall = page.ensureVisiblePopularityCatalogHydrated();

    queueMicrotask(() => {
      page.popularityCatalogHydrationRunPromise = null;
    });
    resolveCurrentRun();

    await waitingCall;

    expect(rerunSpy).toHaveBeenCalledTimes(1);
  });
});
