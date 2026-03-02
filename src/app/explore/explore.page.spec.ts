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
  let gameShelfServiceMock: {
    setGameRating: ReturnType<typeof vi.fn>;
    setGameStatus: ReturnType<typeof vi.fn>;
    setGameTags: ReturnType<typeof vi.fn>;
    listTags: ReturnType<typeof vi.fn>;
    findGameByIdentity: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
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
          useValue: {
            listPopularityTypes: vi.fn().mockReturnValue(of([])),
            listPopularityGames: vi.fn().mockReturnValue(of([])),
            getGameById: vi.fn().mockReturnValue(of(null))
          }
        },
        {
          provide: PlatformCustomizationService,
          useValue: {
            getDisplayNameWithoutAlias: vi.fn((name: string) => name)
          }
        },
        {
          provide: AddToLibraryWorkflowService,
          useValue: {
            addToLibrary: vi.fn().mockResolvedValue({ status: 'added' })
          }
        },
        {
          provide: GameShelfService,
          useValue: gameShelfServiceMock
        },
        {
          provide: AlertController,
          useValue: {
            create: vi.fn()
          }
        },
        {
          provide: ToastController,
          useValue: {
            create: vi.fn().mockResolvedValue({ present: vi.fn().mockResolvedValue(undefined) })
          }
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
});
