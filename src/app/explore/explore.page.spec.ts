import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
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
    IonSegment: Dummy,
    IonSegmentButton: Dummy,
    IonRefresher: Dummy,
    IonRefresherContent: Dummy,
    IonChip: Dummy
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
            collections: []
          }
        }
      }
    ],
    hiddenGems: [],
    exploration: []
  }
};

describe('ExplorePage recommendations UX', () => {
  const igdbProxyServiceMock = {
    getRecommendationLanes: vi.fn(),
    rebuildRecommendations: vi.fn(),
    getGameById: vi.fn()
  };

  const platformCustomizationMock = {
    getDisplayNameWithoutAlias: vi.fn((name: string) => name)
  };

  const addToLibraryWorkflowMock = {
    addToLibrary: vi.fn()
  };

  const gameShelfServiceMock = {
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
      of({ target: 'BACKLOG', runId: '2', status: 'SUCCESS' })
    );
    igdbProxyServiceMock.getGameById.mockReturnValue(
      of({
        igdbGameId: '100',
        title: 'Test Game',
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
        publishers: [],
        platforms: ['PC (Microsoft Windows)'],
        platformOptions: [{ id: 6, name: 'PC (Microsoft Windows)' }],
        platform: 'PC (Microsoft Windows)',
        platformIgdbId: 6,
        releaseDate: null,
        releaseYear: 2020
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
      limit: 20
    });
    expect(page.getActiveLaneItems()).toHaveLength(1);
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
      limit: 20
    });
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

  it('manual rebuild triggers rebuild API and refreshes the active tuple', async () => {
    const page = createPage();
    page.ngOnInit();
    await flushAsync();

    igdbProxyServiceMock.getRecommendationLanes.mockClear();
    await page.rebuildRecommendations(true);

    expect(igdbProxyServiceMock.rebuildRecommendations).toHaveBeenCalledWith({
      target: 'BACKLOG',
      force: true
    });
    expect(igdbProxyServiceMock.getRecommendationLanes).toHaveBeenCalledWith({
      target: 'BACKLOG',
      runtimeMode: 'NEUTRAL',
      limit: 20
    });
  });

  it('opens detail modal for recommendation row and requests detail by igdb id', async () => {
    const page = createPage();
    page.ngOnInit();
    await flushAsync();

    const row = page.getActiveLaneItems()[0];
    await page.openGameDetail(row);

    expect(page.isGameDetailModalOpen).toBe(true);
    expect(igdbProxyServiceMock.getGameById).toHaveBeenCalledWith('100');
    expect(page.selectedGameDetail?.igdbGameId).toBe('100');
  });
});
