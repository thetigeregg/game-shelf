import { describe, expect, it, vi } from 'vitest';
import type { GameCatalogResult, GameEntry } from '../../core/models/game.models';

vi.mock('@ionic/angular/standalone', () => {
  const Stub = () => null;
  return {
    AlertController: Stub,
    IonItemSliding: Stub,
    LoadingController: Stub,
    PopoverController: Stub,
    ToastController: Stub,
    IonList: Stub,
    IonListHeader: Stub,
    IonItem: Stub,
    IonLabel: Stub,
    IonAccordionGroup: Stub,
    IonAccordion: Stub,
    IonIcon: Stub,
    IonBadge: Stub,
    IonItemOptions: Stub,
    IonItemOption: Stub,
    IonPopover: Stub,
    IonContent: Stub,
    IonLoading: Stub,
    IonModal: Stub,
    IonFooter: Stub,
    IonHeader: Stub,
    IonToolbar: Stub,
    IonTitle: Stub,
    IonButtons: Stub,
    IonButton: Stub,
    IonCard: Stub,
    IonCardHeader: Stub,
    IonCardTitle: Stub,
    IonSegment: Stub,
    IonSegmentButton: Stub,
    IonSelect: Stub,
    IonSelectOption: Stub,
    IonSearchbar: Stub,
    IonSpinner: Stub,
    IonGrid: Stub,
    IonRow: Stub,
    IonCol: Stub,
    IonText: Stub,
    IonRange: Stub,
    IonNote: Stub,
    IonThumbnail: Stub,
    IonFab: Stub,
    IonFabButton: Stub,
    IonFabList: Stub,
    IonInput: Stub,
    IonMenu: Stub,
    IonSplitPane: Stub,
    IonInfiniteScroll: Stub,
    IonInfiniteScrollContent: Stub
  };
});

vi.mock('ionicons', () => ({ addIcons: vi.fn() }));
vi.mock('ionicons/icons', () => ({
  star: {},
  ellipsisHorizontal: {},
  close: {},
  closeCircle: {},
  starOutline: {},
  play: {},
  trashBin: {},
  trophy: {},
  bookmark: {},
  pause: {},
  refresh: {},
  globe: {},
  search: {},
  logoGoogle: {},
  logoYoutube: {},
  chevronBack: {},
  documentText: {},
  book: {}
}));
vi.mock('ngx-tiptap', () => ({
  TiptapEditorDirective: class {
    value = true;
  }
}));
vi.mock('@tiptap/core', () => ({
  Editor: class {
    value = true;
  }
}));
vi.mock('@tiptap/starter-kit', () => ({ default: {} }));
vi.mock('@tiptap/extension-underline', () => ({ default: {} }));
vi.mock('@tiptap/extension-list', () => ({ TaskItem: {}, TaskList: {} }));
vi.mock('@tiptap/extension-details', () => ({
  Details: {},
  DetailsContent: {},
  DetailsSummary: {}
}));

import { GameListComponent } from './game-list.component';

function createGame(partial: Partial<GameEntry> = {}): GameEntry {
  const now = new Date().toISOString();
  return {
    igdbGameId: partial.igdbGameId ?? '1',
    title: partial.title ?? 'Test Game',
    coverUrl: partial.coverUrl ?? null,
    coverSource: partial.coverSource ?? 'none',
    platform: partial.platform ?? 'Unknown',
    platformIgdbId: partial.platformIgdbId ?? 999999,
    releaseDate: partial.releaseDate ?? null,
    releaseYear: partial.releaseYear ?? null,
    listType: partial.listType ?? 'collection',
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    reviewScore: partial.reviewScore ?? null,
    metacriticScore: partial.metacriticScore ?? null,
    priceAmount: partial.priceAmount ?? null,
    priceCurrency: partial.priceCurrency ?? null,
    priceIsFree: partial.priceIsFree ?? null
  };
}

describe('game-list review actions', () => {
  it('paginates similar library games in pages of 5', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      similarLibraryGames: Array<{
        game: GameEntry;
        similarity: number;
        reasons: { summary: string };
      }>;
      visibleSimilarLibraryGamesCount: number;
    };
    const games = Array.from({ length: 11 }, (_, index) => ({
      game: createGame({ igdbGameId: String(index + 1), platformIgdbId: 6 }),
      similarity: 0.8,
      reasons: { summary: 'same series' }
    }));

    Object.assign(page, {
      similarLibraryGames: games,
      visibleSimilarLibraryGamesCount: 5
    });

    expect(page.getVisibleSimilarLibraryGames()).toHaveLength(5);
    expect(page.canLoadMoreSimilarLibraryGames()).toBe(true);

    const complete = vi.fn().mockResolvedValue(undefined);
    await page.loadMoreSimilarLibraryGames({ target: { complete } } as unknown as Event);
    expect(page.getVisibleSimilarLibraryGames()).toHaveLength(10);
  });

  it('bulk review update processes all selected platforms with review copy', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      displayedGames: GameEntry[];
      selectedGameKeys: Set<string>;
    };
    const unsupported = createGame({
      igdbGameId: '1',
      platformIgdbId: 999999,
      title: 'Old Console'
    });
    const supported = createGame({ igdbGameId: '2', platformIgdbId: 6, title: 'PC Game' });
    const runBulkAction = vi.fn().mockResolvedValue([
      { game: unsupported, ok: true, value: createGame({ igdbGameId: '1', reviewScore: 91 }) },
      { game: supported, ok: false, value: null }
    ]);
    const clearSelectionMode = vi.fn();
    const presentToast = vi.fn(() => Promise.resolve(undefined));

    Object.assign(page, {
      displayedGames: [unsupported, supported],
      selectedGameKeys: new Set(['1::999999', '2::6']),
      runBulkAction,
      clearSelectionMode,
      presentToast
    });

    await (
      page as unknown as { updateReviewForSelectedGames: () => Promise<void> }
    ).updateReviewForSelectedGames();

    const firstCall = runBulkAction.mock.calls[0] as [GameEntry[]];
    expect(firstCall[0].map((game) => game.igdbGameId)).toEqual(['1', '2']);
    expect(presentToast).toHaveBeenCalledWith('Updated review data for 1 game.');
    expect(presentToast).toHaveBeenCalledWith(
      'Unable to update review data for 1 selected game.',
      'danger'
    );
    expect(clearSelectionMode).toHaveBeenCalledOnce();
  });

  it('bulk review update counts recovered retries as updated even when one result has no match data', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      displayedGames: GameEntry[];
      selectedGameKeys: Set<string>;
    };
    const first = createGame({ igdbGameId: '10', platformIgdbId: 6, title: 'First' });
    const second = createGame({ igdbGameId: '11', platformIgdbId: 6, title: 'Second' });
    const runBulkAction = vi.fn().mockResolvedValue([
      { game: first, ok: true, value: createGame({ igdbGameId: '10', reviewScore: 88 }) },
      { game: second, ok: true, value: createGame({ igdbGameId: '11', reviewScore: null }) }
    ]);
    const clearSelectionMode = vi.fn();
    const presentToast = vi.fn(() => Promise.resolve(undefined));

    Object.assign(page, {
      displayedGames: [first, second],
      selectedGameKeys: new Set(['10::6', '11::6']),
      runBulkAction,
      clearSelectionMode,
      presentToast
    });

    await (
      page as unknown as { updateReviewForSelectedGames: () => Promise<void> }
    ).updateReviewForSelectedGames();

    expect(presentToast).toHaveBeenCalledWith('Updated review data for 2 games.');
    expect(clearSelectionMode).toHaveBeenCalledOnce();
  });

  it('moves selected games using batched service call', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      displayedGames: GameEntry[];
      selectedGameKeys: Set<string>;
      listType: 'collection' | 'wishlist';
    };
    const first = createGame({ igdbGameId: '10', platformIgdbId: 6 });
    const second = createGame({ igdbGameId: '11', platformIgdbId: 130 });
    const moveGamesToList = vi.fn().mockResolvedValue(undefined);
    const clearSelectionMode = vi.fn();
    const presentToast = vi.fn(() => Promise.resolve(undefined));

    Object.assign(page, {
      displayedGames: [first, second],
      selectedGameKeys: new Set(['10::6', '11::130']),
      listType: 'collection',
      gameShelfService: { moveGamesToList },
      clearSelectionMode,
      presentToast
    });

    await (
      page as unknown as { moveSelectedGamesToOtherList: () => Promise<void> }
    ).moveSelectedGamesToOtherList();

    expect(moveGamesToList).toHaveBeenCalledWith(
      [
        { igdbGameId: '10', platformIgdbId: 6 },
        { igdbGameId: '11', platformIgdbId: 130 }
      ],
      'wishlist'
    );
    expect(clearSelectionMode).toHaveBeenCalledOnce();
    expect(presentToast).toHaveBeenCalledWith('Moved 2 games to Wishlist.');
  });

  it('deletes selected games using batched service call', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      displayedGames: GameEntry[];
      selectedGameKeys: Set<string>;
    };
    const first = createGame({ igdbGameId: '20', platformIgdbId: 6 });
    const second = createGame({ igdbGameId: '21', platformIgdbId: 130 });
    const removeGames = vi.fn().mockResolvedValue(undefined);
    const clearSelectionMode = vi.fn();
    const presentToast = vi.fn(() => Promise.resolve(undefined));

    Object.assign(page, {
      displayedGames: [first, second],
      selectedGameKeys: new Set(['20::6', '21::130']),
      gameShelfService: { removeGames },
      confirmDelete: vi.fn().mockResolvedValue(true),
      clearSelectionMode,
      presentToast
    });

    await (page as unknown as { deleteSelectedGames: () => Promise<void> }).deleteSelectedGames();

    expect(removeGames).toHaveBeenCalledWith([
      { igdbGameId: '20', platformIgdbId: 6 },
      { igdbGameId: '21', platformIgdbId: 130 }
    ]);
    expect(clearSelectionMode).toHaveBeenCalledOnce();
    expect(presentToast).toHaveBeenCalledWith('2 games deleted.');
  });

  it('sets status for selected games using batched service call', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      displayedGames: GameEntry[];
      selectedGameKeys: Set<string>;
      statusOptions: Array<{ value: 'playing' | 'completed'; label: string }>;
    };
    const first = createGame({ igdbGameId: '25', platformIgdbId: 6 });
    const second = createGame({ igdbGameId: '26', platformIgdbId: 130 });
    const setGameStatusForGames = vi.fn().mockResolvedValue(undefined);
    const clearSelectionMode = vi.fn();
    const presentToast = vi.fn(() => Promise.resolve(undefined));
    const alertController = {
      create: vi.fn(
        (options: {
          buttons: Array<{ role?: string; handler?: (value: string | null | undefined) => void }>;
        }) =>
          Promise.resolve({
            present: vi.fn(() => Promise.resolve()),
            onDidDismiss: vi.fn(() => {
              const confirmButton = options.buttons.find((button) => button.role === 'confirm');
              confirmButton?.handler?.('completed');
              return Promise.resolve({ role: 'confirm' });
            })
          })
      )
    };

    Object.assign(page, {
      displayedGames: [first, second],
      selectedGameKeys: new Set(['25::6', '26::130']),
      statusOptions: [
        { value: 'playing', label: 'Playing' },
        { value: 'completed', label: 'Completed' }
      ],
      gameShelfService: { setGameStatusForGames },
      alertController,
      clearSelectionMode,
      presentToast
    });

    await (
      page as unknown as { setStatusForSelectedGames: () => Promise<void> }
    ).setStatusForSelectedGames();

    expect(setGameStatusForGames).toHaveBeenCalledWith(
      [
        { igdbGameId: '25', platformIgdbId: 6 },
        { igdbGameId: '26', platformIgdbId: 130 }
      ],
      'completed'
    );
    expect(clearSelectionMode).toHaveBeenCalledOnce();
    expect(presentToast).toHaveBeenCalledWith('Status updated.');
  });

  it('sets tags for selected games using batched service call', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      displayedGames: GameEntry[];
      selectedGameKeys: Set<string>;
    };
    const first = createGame({ igdbGameId: '30', platformIgdbId: 6 });
    const second = createGame({ igdbGameId: '31', platformIgdbId: 130 });
    const setGameTagsForGames = vi.fn().mockResolvedValue(undefined);
    const listTags = vi.fn().mockResolvedValue([
      {
        id: 1,
        name: 'Favorite',
        color: '#ff0000',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 2,
        name: 'Backlog',
        color: '#00ff00',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]);
    const clearSelectionMode = vi.fn();
    const presentToast = vi.fn(() => Promise.resolve(undefined));
    const alertController = {
      create: vi.fn(
        (options: {
          buttons: Array<{
            role?: string;
            handler?: (value: string[] | string | null | undefined) => void;
          }>;
        }) =>
          Promise.resolve({
            present: vi.fn(() => Promise.resolve()),
            onDidDismiss: vi.fn(() => {
              const confirmButton = options.buttons.find((button) => button.role === 'confirm');
              confirmButton?.handler?.(['1', '2']);
              return Promise.resolve({ role: 'confirm' });
            })
          })
      )
    };

    Object.assign(page, {
      displayedGames: [first, second],
      selectedGameKeys: new Set(['30::6', '31::130']),
      gameShelfService: { listTags, setGameTagsForGames },
      alertController,
      clearSelectionMode,
      presentToast
    });

    await (
      page as unknown as { setTagsForSelectedGames: () => Promise<void> }
    ).setTagsForSelectedGames();

    expect(setGameTagsForGames).toHaveBeenCalledWith(
      [
        { igdbGameId: '30', platformIgdbId: 6 },
        { igdbGameId: '31', platformIgdbId: 130 }
      ],
      [1, 2]
    );
    expect(clearSelectionMode).toHaveBeenCalledOnce();
    expect(presentToast).toHaveBeenCalledWith('Tags updated.');
  });

  it('single review refresh allows unsupported legacy platforms and uses review messages', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      selectedGame: GameEntry | null;
      isMetacriticUpdateLoading: boolean;
    };
    const target = createGame({ igdbGameId: '7', platformIgdbId: 999999, title: 'Saturn Title' });
    const loading = {
      present: vi.fn(() => Promise.resolve(undefined)),
      dismiss: vi.fn(() => Promise.resolve(undefined))
    };
    const refreshGameMetacriticScore = vi.fn(() =>
      Promise.resolve(createGame({ igdbGameId: '7', platformIgdbId: 999999, reviewScore: 84 }))
    );
    const presentToast = vi.fn(() => Promise.resolve(undefined));
    const applyUpdatedGame = vi.fn();

    Object.assign(page, {
      selectedGame: target,
      isMetacriticUpdateLoading: false,
      loadingController: { create: vi.fn(() => Promise.resolve(loading)) },
      gameShelfService: { refreshGameMetacriticScore },
      presentToast,
      applyUpdatedGame,
      openReviewPickerModal: vi.fn()
    });

    await (
      page as unknown as { refreshSelectedGameReviewScore: () => Promise<void> }
    ).refreshSelectedGameReviewScore();

    expect(refreshGameMetacriticScore).toHaveBeenCalledWith('7', 999999);
    expect(presentToast).toHaveBeenCalledWith('Review data updated.');
    expect(presentToast).not.toHaveBeenCalledWith(
      'Metacritic is not supported for this platform.',
      'warning'
    );
    expect((page as { isMetacriticUpdateLoading: boolean }).isMetacriticUpdateLoading).toBe(false);
  });

  it('single pricing refresh opens picker for PSPrices platforms', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      selectedGame: GameEntry | null;
      isPricingPickerLoading: boolean;
    };
    const target = createGame({
      igdbGameId: '88',
      platformIgdbId: 167,
      title: 'PS Game',
      listType: 'wishlist'
    });
    const openPricingPickerModal = vi.fn();
    const runPricingPickerSearch = vi.fn(() => Promise.resolve(undefined));

    Object.assign(page, {
      selectedGame: target,
      isPricingPickerLoading: false,
      gameShelfService: {
        isPricingSupportedPlatform: vi.fn(() => true)
      },
      openPricingPickerModal,
      runPricingPickerSearch,
      presentToast: vi.fn(() => Promise.resolve(undefined))
    });

    await (
      page as unknown as { refreshSelectedGamePricing: () => Promise<void> }
    ).refreshSelectedGamePricing();

    expect(openPricingPickerModal).toHaveBeenCalledWith(target);
    expect(runPricingPickerSearch).toHaveBeenCalledOnce();
  });

  it('single pricing refresh uses direct lookup for Steam', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      selectedGame: GameEntry | null;
      isPricingPickerLoading: boolean;
    };
    const target = createGame({
      igdbGameId: '89',
      platformIgdbId: 6,
      title: 'Steam Game',
      listType: 'wishlist'
    });
    const loading = {
      present: vi.fn(() => Promise.resolve(undefined)),
      dismiss: vi.fn(() => Promise.resolve(undefined))
    };
    const refreshGamePricing = vi.fn(() =>
      Promise.resolve(createGame({ igdbGameId: '89', platformIgdbId: 6, priceAmount: 19.99 }))
    );
    const presentToast = vi.fn(() => Promise.resolve(undefined));
    const applyUpdatedGame = vi.fn();

    Object.assign(page, {
      selectedGame: target,
      isPricingPickerLoading: false,
      loadingController: { create: vi.fn(() => Promise.resolve(loading)) },
      gameShelfService: {
        isPricingSupportedPlatform: vi.fn(() => true),
        refreshGamePricing,
        hasUnifiedPriceData: vi.fn(() => true)
      },
      applyUpdatedGame,
      presentToast
    });

    await (
      page as unknown as { refreshSelectedGamePricing: () => Promise<void> }
    ).refreshSelectedGamePricing();

    expect(refreshGamePricing).toHaveBeenCalledWith('89', 6);
    expect(presentToast).toHaveBeenCalledWith('Pricing updated.');
  });

  it('applies selected pricing candidate using preferred psprices url', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      pricingPickerTargetGame: GameEntry | null;
      isPricingPickerLoading: boolean;
    };
    const target = createGame({
      igdbGameId: '10148',
      platformIgdbId: 167,
      title: 'Night In The Woods',
      listType: 'wishlist'
    });
    const updated = createGame({
      igdbGameId: '10148',
      platformIgdbId: 167,
      title: 'Night In The Woods',
      listType: 'wishlist',
      priceAmount: 19.9,
      priceCurrency: 'CHF'
    });
    const refreshGamePricingWithQuery = vi.fn(() => Promise.resolve(updated));
    const applyUpdatedGame = vi.fn();
    const presentToast = vi.fn(() => Promise.resolve(undefined));
    const closePricingPickerModal = vi.fn();

    Object.assign(page, {
      pricingPickerTargetGame: target,
      isPricingPickerLoading: false,
      gameShelfService: {
        refreshGamePricingWithQuery,
        hasUnifiedPriceData: vi.fn(() => true)
      },
      applyUpdatedGame,
      presentToast,
      closePricingPickerModal,
      changeDetectorRef: { markForCheck: vi.fn() }
    });

    await page.applySelectedPricingCandidate({
      title: 'Night In The Woods',
      amount: 19.9,
      currency: 'CHF',
      regularAmount: null,
      discountPercent: null,
      isFree: false,
      url: 'https://psprices.com/region-ch/game/5825037/night-in-the-woods',
      score: 100
    });

    expect(refreshGamePricingWithQuery).toHaveBeenCalledWith('10148', 167, {
      title: 'Night In The Woods',
      preferredUrl: 'https://psprices.com/region-ch/game/5825037/night-in-the-woods'
    });
    expect(applyUpdatedGame).toHaveBeenCalledWith(updated);
    expect(closePricingPickerModal).toHaveBeenCalledOnce();
    expect(presentToast).toHaveBeenCalledWith('Pricing updated.');
  });

  it('applies selected review candidate using preferred review url', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      reviewPickerTargetGame: GameEntry | null;
      isReviewPickerLoading: boolean;
    };
    const target = createGame({
      igdbGameId: '10148',
      platformIgdbId: 167,
      title: 'Night In The Woods',
      listType: 'wishlist'
    });
    const updated = createGame({
      igdbGameId: '10148',
      platformIgdbId: 167,
      title: 'Night In The Woods',
      reviewScore: 88,
      metacriticScore: 88
    });
    const refreshGameMetacriticScoreWithQuery = vi.fn(() => Promise.resolve(updated));
    const applyUpdatedGame = vi.fn();
    const presentToast = vi.fn(() => Promise.resolve(undefined));
    const closeReviewPickerModal = vi.fn();

    Object.assign(page, {
      reviewPickerTargetGame: target,
      isReviewPickerLoading: false,
      gameShelfService: { refreshGameMetacriticScoreWithQuery },
      applyUpdatedGame,
      presentToast,
      closeReviewPickerModal,
      changeDetectorRef: { markForCheck: vi.fn() }
    });

    await page.applySelectedReviewCandidate({
      title: 'Night In The Woods',
      releaseYear: 2017,
      platform: 'PlayStation 5',
      reviewScore: 88,
      reviewUrl: 'https://www.metacritic.com/game/night-in-the-woods-alt/',
      reviewSource: 'metacritic',
      metacriticScore: 88,
      metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods-alt/'
    });

    expect(refreshGameMetacriticScoreWithQuery).toHaveBeenCalledWith('10148', 167, {
      title: 'Night In The Woods',
      releaseYear: 2017,
      platform: 'PlayStation 5',
      platformIgdbId: 167,
      mobygamesGameId: null,
      preferredUrl: 'https://www.metacritic.com/game/night-in-the-woods-alt/'
    });
    expect(applyUpdatedGame).toHaveBeenCalledWith(updated);
    expect(closeReviewPickerModal).toHaveBeenCalledOnce();
    expect(presentToast).toHaveBeenCalledWith('Review data updated.');
  });

  it('single pricing refresh is blocked for non-wishlist games', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      selectedGame: GameEntry | null;
      isPricingPickerLoading: boolean;
    };
    const target = createGame({
      igdbGameId: '90',
      platformIgdbId: 6,
      title: 'Collection Steam Game',
      listType: 'collection'
    });
    const refreshGamePricing = vi.fn();
    const presentToast = vi.fn(() => Promise.resolve(undefined));

    Object.assign(page, {
      selectedGame: target,
      isPricingPickerLoading: false,
      gameShelfService: {
        isPricingSupportedPlatform: vi.fn(() => true),
        refreshGamePricing
      },
      presentToast
    });

    await (
      page as unknown as { refreshSelectedGamePricing: () => Promise<void> }
    ).refreshSelectedGamePricing();

    expect(presentToast).toHaveBeenCalledWith(
      'Pricing is only available for wishlist games.',
      'warning'
    );
    expect(refreshGamePricing).not.toHaveBeenCalled();
  });

  it('bulk pricing refresh is skipped for collection list type', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      displayedGames: GameEntry[];
      selectedGameKeys: Set<string>;
      listType: 'collection' | 'wishlist';
    };
    const runBulkAction = vi.fn();

    Object.assign(page, {
      displayedGames: [createGame({ igdbGameId: '91', platformIgdbId: 6, listType: 'collection' })],
      selectedGameKeys: new Set(['91::6']),
      listType: 'collection',
      runBulkAction,
      gameShelfService: {
        isPricingSupportedPlatform: vi.fn(() => true)
      }
    });

    await (
      page as unknown as { updatePricingForSelectedGames: () => Promise<void> }
    ).updatePricingForSelectedGames();

    expect(runBulkAction).not.toHaveBeenCalled();
  });

  it('detailVideos uses actively viewed detail game in similar discovery mode', () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      selectedGame: GameEntry | null;
      isSimilarDiscoveryDetailModalOpen: boolean;
      similarDiscoveryDetail: GameCatalogResult | GameEntry | null;
    };
    const selected = createGame({
      videos: [{ id: 1, name: 'Selected', videoId: 'PIF_fqFZEuk', url: '' }]
    });
    const discovery: GameCatalogResult = {
      igdbGameId: '2',
      title: 'Discovery',
      coverUrl: null,
      coverSource: 'none',
      platform: 'Switch',
      platformIgdbId: 130,
      platforms: ['Switch'],
      releaseDate: null,
      releaseYear: null,
      videos: [{ id: 2, name: 'Discovery', videoId: 'Qf8JjQvYUFs', url: '' }]
    };

    Object.assign(page, {
      selectedGame: selected,
      isSimilarDiscoveryDetailModalOpen: true,
      similarDiscoveryDetail: discovery
    });

    expect(page.detailVideos[0]?.videoId).toBe('Qf8JjQvYUFs');
    expect(page.hasDetailVideosShortcut).toBe(true);
  });

  it('hasDetailVideosShortcut is false when active detail videos are not valid YouTube ids', () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      selectedGame: GameEntry | null;
      isSimilarDiscoveryDetailModalOpen: boolean;
      similarDiscoveryDetail: GameCatalogResult | GameEntry | null;
    };
    const selected = {
      ...createGame(),
      videos: [{ id: 1, name: 'Invalid', videoId: 'abc def', url: '' }]
    } as GameEntry;

    Object.assign(page, {
      selectedGame: selected,
      isSimilarDiscoveryDetailModalOpen: false,
      similarDiscoveryDetail: null
    });

    expect(page.detailVideos).toHaveLength(1);
    expect(page.hasDetailVideosShortcut).toBe(false);
  });

  it('formats row price as CHF for wishlist rows', () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      listType: 'collection' | 'wishlist';
    };
    Object.assign(page, { listType: 'wishlist' });

    const label = page.getRowPriceLabel(createGame({ priceAmount: 19.99 }));

    expect(label).toContain('CHF');
    expect(label).toContain('19.99');
  });

  it('does not show row price for collection rows', () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      listType: 'collection' | 'wishlist';
    };
    Object.assign(page, { listType: 'collection' });

    expect(page.getRowPriceLabel(createGame({ priceAmount: 19.99 }))).toBeNull();
  });
});
