import { describe, expect, it, beforeEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular/standalone';
import type {
  GameEntry,
  HltbMatchCandidate,
  MetacriticMatchCandidate,
  PriceMatchCandidate,
  ReviewMatchCandidate
} from '../core/models/game.models';

vi.mock('@ionic/angular/standalone', () => {
  const Stub = () => null;

  return {
    IonBackButton: Stub,
    IonBadge: Stub,
    IonButton: Stub,
    IonButtons: Stub,
    IonCheckbox: Stub,
    IonContent: Stub,
    IonHeader: Stub,
    IonItem: Stub,
    IonLabel: Stub,
    IonList: Stub,
    IonListHeader: Stub,
    IonModal: Stub,
    IonNote: Stub,
    IonSearchbar: Stub,
    IonSelect: Stub,
    IonSelectOption: Stub,
    IonSpinner: Stub,
    IonThumbnail: Stub,
    IonTitle: Stub,
    IonToolbar: Stub,
    LoadingController: Stub,
    ToastController: Stub
  };
});

vi.mock('../features/game-list/game-list-bulk-actions', () => ({
  runBulkActionWithRetry: vi.fn()
}));

import { runBulkActionWithRetry } from '../features/game-list/game-list-bulk-actions';
import { MetadataValidatorPage } from './metadata-validator.page';
import { GameShelfService } from '../core/services/game-shelf.service';
import { PlatformCustomizationService } from '../core/services/platform-customization.service';
import { DebugLogService } from '../core/services/debug-log.service';

interface ShelfServiceStub {
  hasUnifiedPriceData: ReturnType<typeof vi.fn>;
  isPricingSupportedPlatform: ReturnType<typeof vi.fn>;
  shouldUseIgdbCoverForPlatform: ReturnType<typeof vi.fn>;
  searchBoxArtByTitle: ReturnType<typeof vi.fn>;
  updateGameCover: ReturnType<typeof vi.fn>;
  searchHltbCandidates: ReturnType<typeof vi.fn>;
  searchReviewCandidates: ReturnType<typeof vi.fn>;
  searchPricingCandidates: ReturnType<typeof vi.fn>;
  refreshGameCompletionTimesWithQuery: ReturnType<typeof vi.fn>;
  refreshGameCompletionTimes: ReturnType<typeof vi.fn>;
  searchMetacriticCandidates: ReturnType<typeof vi.fn>;
  refreshGameMetacriticScoreWithQuery: ReturnType<typeof vi.fn>;
  refreshGameMetacriticScore: ReturnType<typeof vi.fn>;
  refreshGamePricing: ReturnType<typeof vi.fn>;
  refreshGamePricingWithQuery: ReturnType<typeof vi.fn>;
}

function createGame(partial: Partial<GameEntry> = {}): GameEntry {
  const now = new Date().toISOString();
  return {
    igdbGameId: partial.igdbGameId ?? '1',
    title: partial.title ?? 'Test Game',
    coverUrl: partial.coverUrl ?? null,
    coverSource: partial.coverSource ?? 'none',
    platform: partial.platform ?? 'PC',
    platformIgdbId: partial.platformIgdbId ?? 6,
    releaseDate: partial.releaseDate ?? null,
    releaseYear: partial.releaseYear ?? 1993,
    listType: partial.listType ?? 'collection',
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    hltbMainHours: partial.hltbMainHours ?? null,
    hltbMainExtraHours: partial.hltbMainExtraHours ?? null,
    hltbCompletionistHours: partial.hltbCompletionistHours ?? null,
    metacriticScore: partial.metacriticScore ?? null,
    metacriticUrl: partial.metacriticUrl ?? null,
    priceSource: partial.priceSource ?? null,
    priceFetchedAt: partial.priceFetchedAt ?? null,
    priceAmount: partial.priceAmount ?? null,
    priceCurrency: partial.priceCurrency ?? null,
    priceRegularAmount: partial.priceRegularAmount ?? null,
    priceDiscountPercent: partial.priceDiscountPercent ?? null,
    priceIsFree: partial.priceIsFree ?? null,
    priceUrl: partial.priceUrl ?? null
  };
}

function setField(target: object, key: string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

function callPrivate(target: object, key: string, ...args: unknown[]): unknown {
  const fn = (target as Record<string, (...invocation: unknown[]) => unknown>)[key];
  return fn.apply(target, args);
}

function createPageHarness(): {
  page: MetadataValidatorPage;
  shelf: ShelfServiceStub;
  presentToast: ReturnType<typeof vi.fn>;
  loadingController: { create: ReturnType<typeof vi.fn> };
  debugTrace: ReturnType<typeof vi.fn>;
  runBulkMock: ReturnType<typeof vi.mocked<typeof runBulkActionWithRetry>>;
} {
  const page = Object.create(MetadataValidatorPage.prototype) as MetadataValidatorPage;
  const shelf: ShelfServiceStub = {
    hasUnifiedPriceData: vi.fn((game: GameEntry) => {
      if (
        typeof game.priceAmount === 'number' &&
        Number.isFinite(game.priceAmount) &&
        game.priceAmount >= 0
      ) {
        return true;
      }
      return game.priceIsFree === true;
    }),
    isPricingSupportedPlatform: vi.fn((platformIgdbId: number) =>
      [6, 48, 167, 130, 508].includes(platformIgdbId)
    ),
    shouldUseIgdbCoverForPlatform: vi.fn(() => false),
    searchBoxArtByTitle: vi.fn(() => of([])),
    updateGameCover: vi.fn(() => Promise.resolve(undefined)),
    searchHltbCandidates: vi.fn(() => of([])),
    searchReviewCandidates: vi.fn(() => of([])),
    searchPricingCandidates: vi.fn(() => of([])),
    refreshGameCompletionTimesWithQuery: vi.fn((_a, _b, _c) =>
      Promise.resolve(createGame({ hltbMainHours: 3 }))
    ),
    refreshGameCompletionTimes: vi.fn((_a, _b) => Promise.resolve(createGame())),
    searchMetacriticCandidates: vi.fn(() => of([])),
    refreshGameMetacriticScoreWithQuery: vi.fn((_a, _b, _c) => Promise.resolve(createGame())),
    refreshGameMetacriticScore: vi.fn((_a, _b) => Promise.resolve(createGame())),
    refreshGamePricing: vi.fn((_a, _b) => Promise.resolve(createGame())),
    refreshGamePricingWithQuery: vi.fn((_a, _b, _c) => Promise.resolve(createGame()))
  };
  const presentToast = vi.fn(() => Promise.resolve(undefined));
  const loadingController = { create: vi.fn() };
  const debugTrace = vi.fn();
  const runBulkMock = vi.mocked(runBulkActionWithRetry);

  setField(page, 'gameShelfService', shelf);
  setField(page, 'platformCustomizationService', {
    getDisplayNameWithoutAlias: vi.fn((name: string) => name)
  });
  setField(page, 'toastController', {
    create: vi.fn(() => Promise.resolve({ present: vi.fn(() => Promise.resolve(undefined)) }))
  });
  setField(page, 'loadingController', loadingController);
  setField(page, 'router', { navigateByUrl: vi.fn(() => Promise.resolve(true)) });
  setField(page, 'debugLogService', { trace: debugTrace });
  setField(page, 'selectedListType$', { next: vi.fn() });
  setField(page, 'selectedMissingFilters$', { next: vi.fn() });
  setField(page, 'displayedGames', []);
  setField(page, 'selectedGameKeys', new Set<string>());
  setField(page, 'selectedListType', null);
  setField(page, 'selectedMissingFilters', []);
  setField(page, 'isBulkRefreshingHltb', false);
  setField(page, 'isBulkRefreshingMetacritic', false);
  setField(page, 'isBulkRefreshingPricing', false);
  setField(page, 'isBulkRefreshingImage', false);
  setField(page, 'isHltbPickerModalOpen', false);
  setField(page, 'isHltbPickerLoading', false);
  setField(page, 'hltbPickerQuery', '');
  setField(page, 'hltbPickerResults', []);
  setField(page, 'hltbPickerError', null);
  setField(page, 'hltbPickerTargetGame', null);
  setField(page, 'isMetacriticPickerModalOpen', false);
  setField(page, 'isMetacriticPickerLoading', false);
  setField(page, 'metacriticPickerQuery', '');
  setField(page, 'metacriticPickerResults', []);
  setField(page, 'metacriticPickerError', null);
  setField(page, 'metacriticPickerTargetGame', null);
  setField(page, 'isPricingPickerModalOpen', false);
  setField(page, 'isPricingPickerLoading', false);
  setField(page, 'pricingPickerQuery', '');
  setField(page, 'pricingPickerResults', []);
  setField(page, 'pricingPickerError', null);
  setField(page, 'pricingPickerTargetGame', null);
  setField(page, 'presentToast', presentToast);
  setField(
    page,
    'delay',
    vi.fn(() => Promise.resolve(undefined))
  );

  return { page, shelf, presentToast, loadingController, debugTrace, runBulkMock };
}

describe('MetadataValidatorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes default state via dependency injection context', () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: GameShelfService,
          useValue: {
            watchList: vi.fn(() => of([]))
          }
        },
        {
          provide: PlatformCustomizationService,
          useValue: { getDisplayNameWithoutAlias: vi.fn((name: string) => name) }
        },
        { provide: ToastController, useValue: { create: vi.fn() } },
        { provide: LoadingController, useValue: { create: vi.fn() } },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        { provide: DebugLogService, useValue: { trace: vi.fn() } }
      ]
    });

    const page = TestBed.runInInjectionContext(() => new MetadataValidatorPage());
    expect(page.missingFilterOptions.map((option) => option.value)).toEqual([
      'hltb',
      'metacritic',
      'nonPcTheGamesDbImage'
    ]);
    expect(page.isBulkRefreshingMetacritic).toBe(false);
    expect(page.isMetacriticPickerModalOpen).toBe(false);
    expect(page.metacriticPickerQuery).toBe('');
    expect(page.metacriticPickerResults).toEqual([]);
    expect(page.metacriticPickerError).toBeNull();
    expect(page.metacriticPickerTargetGame).toBeNull();
    expect(page.selectedGamesCount).toBe(0);
  });

  it('normalizes list and missing filter selections', () => {
    const { page } = createPageHarness();

    const selectedListTypeNext = (
      page as unknown as { selectedListType$: { next: (value: unknown) => void } }
    ).selectedListType$.next as ReturnType<typeof vi.fn>;
    const selectedMissingFiltersNext = (
      page as unknown as { selectedMissingFilters$: { next: (value: unknown) => void } }
    ).selectedMissingFilters$.next as ReturnType<typeof vi.fn>;

    page.onListTypeChange('collection');
    expect((page as unknown as { selectedListType: string | null }).selectedListType).toBe(
      'collection'
    );
    expect(selectedListTypeNext).toHaveBeenCalledWith('collection');
    expect(page.missingFilterOptions.map((option) => option.value)).toEqual([
      'hltb',
      'metacritic',
      'nonPcTheGamesDbImage'
    ]);

    page.onMissingFiltersChange(['hltb', 'metacritic', 'pricing', 'metacritic', 'x']);
    expect(
      (page as unknown as { selectedMissingFilters: string[] }).selectedMissingFilters
    ).toEqual(['hltb', 'metacritic']);
    expect(selectedMissingFiltersNext).toHaveBeenCalledWith(['hltb', 'metacritic']);

    page.onListTypeChange('wishlist');
    expect((page as unknown as { selectedListType: string | null }).selectedListType).toBe(
      'wishlist'
    );
    expect(selectedListTypeNext).toHaveBeenCalledWith('wishlist');
    expect(page.missingFilterOptions.map((option) => option.value)).toEqual([
      'hltb',
      'metacritic',
      'pricing',
      'nonPcTheGamesDbImage'
    ]);

    page.onMissingFiltersChange(['hltb', 'metacritic', 'pricing', 'metacritic', 'x']);
    expect(
      (page as unknown as { selectedMissingFilters: string[] }).selectedMissingFilters
    ).toEqual(['hltb', 'metacritic', 'pricing']);
    expect(selectedMissingFiltersNext).toHaveBeenCalledWith(['hltb', 'metacritic', 'pricing']);

    page.onListTypeChange('collection');
    expect(
      (page as unknown as { selectedMissingFilters: string[] }).selectedMissingFilters
    ).toEqual(['hltb', 'metacritic']);
    expect(selectedMissingFiltersNext).toHaveBeenCalledWith(['hltb', 'metacritic']);

    page.onListTypeChange('invalid');
    expect((page as unknown as { selectedListType: string | null }).selectedListType).toBeNull();
    expect(selectedListTypeNext).toHaveBeenCalledWith(null);

    page.onMissingFiltersChange('nonPcTheGamesDbImage');
    expect(
      (page as unknown as { selectedMissingFilters: string[] }).selectedMissingFilters
    ).toEqual(['nonPcTheGamesDbImage']);
  });

  it('supports selection toggles and label helpers', () => {
    const { page } = createPageHarness();
    const games = [createGame({ igdbGameId: '1' }), createGame({ igdbGameId: '2' })];
    setField(page, 'displayedGames', games);

    page.toggleSelectAllDisplayed();
    expect((page as unknown as { selectedGameKeys: Set<string> }).selectedGameKeys.size).toBe(2);
    expect(page.isAllDisplayedSelected()).toBe(true);
    expect(page.getDisplayedGamesLabel()).toBe('2 games');

    page.toggleSelectAllDisplayed();
    expect((page as unknown as { selectedGameKeys: Set<string> }).selectedGameKeys.size).toBe(0);

    page.toggleGameSelection(games[0]);
    expect(page.isGameSelected(games[0])).toBe(true);
    page.toggleGameSelection(games[0]);
    expect(page.isGameSelected(games[0])).toBe(false);
  });

  it('handles platform label fallback and metadata predicates', () => {
    const { page, shelf } = createPageHarness();
    setField(page, 'platformCustomizationService', {
      getDisplayNameWithoutAlias: vi.fn(() => '  ')
    });
    expect(page.getPlatformLabel(createGame())).toBe('Unknown platform');

    expect(page.hasHltbMetadata(createGame({ hltbMainHours: 1 }))).toBe(true);
    expect(page.hasHltbMetadata(createGame())).toBe(false);
    expect(page.hasMetacriticMetadata(createGame({ metacriticScore: 84 }))).toBe(true);
    expect(page.hasMetacriticMetadata(createGame({ metacriticScore: 101 }))).toBe(false);

    shelf.shouldUseIgdbCoverForPlatform.mockReturnValueOnce(true);
    expect(page.isNonPcTheGamesDbImagePresent(createGame())).toBe(false);

    shelf.shouldUseIgdbCoverForPlatform.mockReturnValueOnce(false);
    expect(
      page.isNonPcTheGamesDbImagePresent(
        createGame({ coverSource: 'thegamesdb', coverUrl: 'https://image' })
      )
    ).toBe(true);
  });

  it('refreshMetacriticForGame opens review picker for all platforms', async () => {
    const { page, presentToast } = createPageHarness();
    const openPicker = vi.fn(() => Promise.resolve(undefined));
    setField(page, 'openMetacriticPickerModal', openPicker);

    await page.refreshMetacriticForGame(createGame({ platformIgdbId: 999999, platform: 'Saturn' }));
    expect(openPicker).toHaveBeenCalledTimes(1);
    expect(presentToast).not.toHaveBeenCalled();

    await page.refreshMetacriticForGame(createGame({ platformIgdbId: 6, platform: 'PC' }));
    expect(openPicker).toHaveBeenCalledTimes(2);
  });

  it('refreshImageForGame handles pc/no-match/success/error', async () => {
    const { page, shelf, presentToast } = createPageHarness();

    shelf.shouldUseIgdbCoverForPlatform.mockReturnValueOnce(true);
    await page.refreshImageForGame(createGame({ title: 'PC Game' }));
    expect(presentToast).toHaveBeenCalledWith(
      'Image validation is not required for PC games.',
      'warning'
    );

    shelf.shouldUseIgdbCoverForPlatform.mockReturnValue(false);
    shelf.searchBoxArtByTitle.mockReturnValueOnce(of([]));
    await page.refreshImageForGame(createGame({ title: 'No Cover' }));
    expect(presentToast).toHaveBeenCalledWith('No TheGamesDB image found for No Cover.', 'warning');

    shelf.searchBoxArtByTitle.mockReturnValueOnce(of(['https://cover']));
    await page.refreshImageForGame(
      createGame({ igdbGameId: '2', platformIgdbId: 48, title: 'Has Cover' })
    );
    expect(shelf.updateGameCover).toHaveBeenCalled();
    expect(presentToast).toHaveBeenCalledWith('Updated image for Has Cover.');

    shelf.searchBoxArtByTitle.mockReturnValueOnce(throwError(() => new Error('down')));
    await page.refreshImageForGame(createGame({ title: 'Error Cover' }));
    expect(presentToast).toHaveBeenCalledWith('Unable to update image for Error Cover.', 'danger');
  });

  it('bulk HLTB handles skip and result summaries', async () => {
    const { page, runBulkMock, presentToast } = createPageHarness();
    const game = createGame();
    setField(page, 'displayedGames', [game]);
    setField(
      page,
      'selectedGameKeys',
      new Set([`${game.igdbGameId}::${String(game.platformIgdbId)}`])
    );

    runBulkMock.mockResolvedValueOnce([
      { game, ok: true, value: createGame({ hltbMainHours: 4 }) },
      { game, ok: true, value: createGame() },
      { game, ok: false, value: null }
    ]);

    await page.refreshHltbForSelectedGames();
    expect(runBulkMock).toHaveBeenCalledOnce();
    expect(presentToast).toHaveBeenCalledWith('Updated HLTB for 2 games.');
    expect(presentToast).toHaveBeenCalledWith(
      'Unable to update HLTB for 1 selected game.',
      'danger'
    );

    setField(page, 'selectedGameKeys', new Set<string>());
    await page.refreshHltbForSelectedGames();
    expect(runBulkMock).toHaveBeenCalledOnce();

    setField(page, 'selectedGameKeys', new Set(['1::6']));
    runBulkMock.mockResolvedValueOnce([{ game, ok: true, value: createGame() }]);
    await page.refreshHltbForSelectedGames();
    expect(presentToast).toHaveBeenCalledWith(
      'No HLTB matches found for selected games.',
      'warning'
    );
  });

  it('bulk Metacritic handles missing and failed review updates', async () => {
    const { page, runBulkMock, presentToast } = createPageHarness();
    const supported = createGame({ igdbGameId: '1', platformIgdbId: 6 });
    const unsupported = createGame({ igdbGameId: '2', platformIgdbId: 999999 });
    setField(page, 'displayedGames', [supported, unsupported]);
    setField(page, 'selectedGameKeys', new Set(['1::6', '2::999999']));

    runBulkMock.mockResolvedValueOnce([
      { game: supported, ok: true, value: createGame({ metacriticScore: 84 }) },
      { game: supported, ok: true, value: createGame() },
      { game: supported, ok: false, value: null }
    ]);

    await page.refreshMetacriticForSelectedGames();
    expect(runBulkMock).toHaveBeenCalledOnce();
    const firstCall = runBulkMock.mock.calls[0] as [
      {
        action: (game: GameEntry) => Promise<GameEntry | null>;
        delay: (ms: number) => Promise<void>;
      }
    ];
    const firstBulkCall = firstCall[0];
    expect(typeof firstBulkCall.action).toBe('function');
    expect(typeof firstBulkCall.delay).toBe('function');
    await firstBulkCall.action(supported);
    await firstBulkCall.delay(0);
    expect(presentToast).toHaveBeenCalledWith('Updated review for 2 games.');
    expect(presentToast).toHaveBeenCalledWith(
      'Unable to update review for 1 selected game.',
      'danger'
    );

    setField(page, 'displayedGames', [unsupported]);
    setField(page, 'selectedGameKeys', new Set(['2::999999']));
    runBulkMock.mockResolvedValueOnce([]);
    await page.refreshMetacriticForSelectedGames();
    expect(runBulkMock).toHaveBeenCalledTimes(2);

    setField(page, 'selectedGameKeys', new Set<string>());
    await page.refreshMetacriticForSelectedGames();
    expect(runBulkMock).toHaveBeenCalledTimes(2);

    setField(page, 'displayedGames', [supported]);
    setField(page, 'selectedGameKeys', new Set(['1::6']));
    runBulkMock.mockResolvedValueOnce([{ game: supported, ok: true, value: createGame() }]);
    await page.refreshMetacriticForSelectedGames();
    expect(presentToast).toHaveBeenCalledWith(
      'No review matches found for selected games.',
      'warning'
    );
  });

  it('bulk image refresh handles no updates, success, and failures', async () => {
    const { page, shelf, presentToast } = createPageHarness();
    const g1 = createGame({ igdbGameId: '1', title: 'A' });
    const g2 = createGame({ igdbGameId: '2', title: 'B' });
    setField(page, 'displayedGames', [g1, g2]);
    setField(page, 'selectedGameKeys', new Set(['1::6', '2::6']));

    shelf.searchBoxArtByTitle.mockReturnValueOnce(of([])).mockReturnValueOnce(of([]));
    await page.refreshImageForSelectedGames();
    expect(presentToast).toHaveBeenCalledWith(
      'No TheGamesDB image updates were available.',
      'warning'
    );

    shelf.searchBoxArtByTitle
      .mockReturnValueOnce(of(['https://cover']))
      .mockReturnValueOnce(of([]));
    await page.refreshImageForSelectedGames();
    expect(presentToast).toHaveBeenCalledWith('Updated images for 1 game.');

    shelf.searchBoxArtByTitle.mockReturnValueOnce(throwError(() => new Error('fail')));
    await page.refreshImageForSelectedGames();
    expect(presentToast).toHaveBeenCalledWith(
      'Unable to update images for selected games.',
      'danger'
    );
  });

  it('bulk pricing refresh only processes supported platforms', async () => {
    const { page, runBulkMock, presentToast } = createPageHarness();
    const pc = createGame({ igdbGameId: '1', platformIgdbId: 6, listType: 'wishlist' });
    const unsupported = createGame({ igdbGameId: '2', platformIgdbId: 11, listType: 'wishlist' });
    setField(page, 'displayedGames', [pc, unsupported]);
    setField(page, 'selectedGameKeys', new Set(['1::6', '2::11']));

    runBulkMock.mockResolvedValueOnce([
      {
        game: pc,
        ok: true,
        value: createGame({
          igdbGameId: '1',
          platformIgdbId: 6,
          listType: 'wishlist',
          priceAmount: 29.9
        })
      },
      { game: pc, ok: false, value: null }
    ]);

    await page.refreshPricingForSelectedGames();
    expect(runBulkMock).toHaveBeenCalledOnce();
    const call = runBulkMock.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(
      (call as { games: GameEntry[] }).games.map((game: GameEntry) => game.igdbGameId)
    ).toEqual(['1']);
    expect(presentToast).toHaveBeenCalledWith('Updated pricing for 1 game.');
    expect(presentToast).toHaveBeenCalledWith(
      'Unable to update pricing for 1 selected game.',
      'danger'
    );
  });

  it('refreshPricingForGame opens pricing picker for psprices platforms and direct refresh for steam', async () => {
    const { page, shelf } = createPageHarness();
    const psGame = createGame({
      igdbGameId: '2',
      platformIgdbId: 167,
      title: 'PS Game',
      listType: 'wishlist'
    });
    const steamGame = createGame({
      igdbGameId: '3',
      platformIgdbId: 6,
      title: 'Steam Game',
      listType: 'wishlist'
    });

    await page.refreshPricingForGame(psGame);
    expect(
      (page as unknown as { isPricingPickerModalOpen: boolean }).isPricingPickerModalOpen
    ).toBe(true);
    expect(shelf.refreshGamePricing).not.toHaveBeenCalled();

    await page.refreshPricingForGame(steamGame);
    expect(shelf.refreshGamePricing).toHaveBeenCalledWith('3', 6);
  });

  it('runs picker searches with guard, success, and error paths', async () => {
    const { page, shelf } = createPageHarness();
    const hltbCandidate: HltbMatchCandidate = {
      title: 'Doom',
      releaseYear: 1993,
      platform: 'PC',
      hltbMainHours: 5,
      hltbMainExtraHours: 8,
      hltbCompletionistHours: 12
    };
    const reviewCandidate: ReviewMatchCandidate = {
      title: 'Doom',
      releaseYear: 1993,
      platform: 'PC',
      reviewScore: 87,
      reviewUrl: 'https://www.metacritic.com/game/doom/',
      reviewSource: 'metacritic',
      metacriticScore: 87,
      metacriticUrl: 'https://www.metacritic.com/game/doom/'
    };
    const pricingCandidate: PriceMatchCandidate = {
      title: 'Doom',
      amount: 29.9,
      currency: 'CHF',
      regularAmount: 39.9,
      discountPercent: 25,
      isFree: false,
      url: 'https://psprices.com/region-ch/game/123/doom',
      score: 96
    };

    setField(page, 'hltbPickerQuery', 'a');
    await page.runHltbPickerSearch();
    expect((page as unknown as { hltbPickerError: string | null }).hltbPickerError).toBe(
      'Enter at least 2 characters.'
    );

    setField(page, 'hltbPickerQuery', 'doom');
    shelf.searchHltbCandidates.mockReturnValueOnce(of([hltbCandidate, hltbCandidate]));
    await page.runHltbPickerSearch();
    expect(
      (page as unknown as { hltbPickerResults: HltbMatchCandidate[] }).hltbPickerResults.length
    ).toBe(1);

    shelf.searchHltbCandidates.mockReturnValueOnce(throwError(() => new Error('429')));
    await page.runHltbPickerSearch();
    expect(
      (page as unknown as { hltbPickerResults: HltbMatchCandidate[] }).hltbPickerResults
    ).toEqual([]);

    const target = createGame({ platform: 'PC', platformIgdbId: 6, releaseYear: 1993 });
    setField(page, 'metacriticPickerTargetGame', target);
    setField(page, 'metacriticPickerQuery', 'doom');
    shelf.searchReviewCandidates.mockReturnValueOnce(of([reviewCandidate, reviewCandidate]));
    await page.runMetacriticPickerSearch();
    expect(shelf.searchReviewCandidates).toHaveBeenCalledWith('doom', 1993, 'PC', 6);
    expect(
      (page as unknown as { metacriticPickerResults: MetacriticMatchCandidate[] })
        .metacriticPickerResults.length
    ).toBe(1);

    shelf.searchReviewCandidates.mockReturnValueOnce(throwError(() => new Error('429')));
    await page.runMetacriticPickerSearch();
    expect(
      (page as unknown as { metacriticPickerResults: MetacriticMatchCandidate[] })
        .metacriticPickerResults
    ).toEqual([]);

    setField(page, 'pricingPickerTargetGame', target);
    setField(page, 'pricingPickerQuery', 'doom');
    shelf.searchPricingCandidates.mockReturnValueOnce(of([pricingCandidate, pricingCandidate]));
    await page.runPricingPickerSearch();
    expect(shelf.searchPricingCandidates).toHaveBeenCalledWith('1', 6, 'doom');
    expect(
      (page as unknown as { pricingPickerResults: PriceMatchCandidate[] }).pricingPickerResults
        .length
    ).toBe(1);

    shelf.searchPricingCandidates.mockReturnValueOnce(throwError(() => new Error('429')));
    await page.runPricingPickerSearch();
    expect(
      (page as unknown as { pricingPickerResults: PriceMatchCandidate[] }).pricingPickerResults
    ).toEqual([]);
  });

  it('applies selected/original pricing candidates across success/no-match/error', async () => {
    const { page, shelf, presentToast } = createPageHarness();
    const target = createGame({
      igdbGameId: '42',
      platformIgdbId: 167,
      title: 'Target',
      platform: 'PS5'
    });
    setField(page, 'pricingPickerTargetGame', target);

    await page.applySelectedPricingCandidate({
      title: 'Target',
      amount: 49.9,
      currency: 'CHF',
      regularAmount: 69.9,
      discountPercent: 28,
      isFree: false,
      url: 'https://psprices.com/region-ch/game/target',
      score: 97
    });
    expect(shelf.refreshGamePricingWithQuery).toHaveBeenCalledWith('42', 167, {
      title: 'Target'
    });

    shelf.refreshGamePricingWithQuery.mockResolvedValueOnce(
      createGame({
        igdbGameId: '42',
        platformIgdbId: 167,
        priceAmount: null,
        priceIsFree: null
      })
    );
    setField(page, 'pricingPickerTargetGame', target);
    await page.applySelectedPricingCandidate({
      title: 'Target',
      amount: 49.9,
      currency: 'CHF',
      regularAmount: 69.9,
      discountPercent: 28,
      isFree: false,
      url: 'https://psprices.com/region-ch/game/target',
      score: 97
    });
    expect(presentToast).toHaveBeenCalledWith('No pricing match found for Target.', 'warning');

    shelf.refreshGamePricingWithQuery.mockRejectedValueOnce(new Error('fail'));
    setField(page, 'pricingPickerTargetGame', target);
    await page.applySelectedPricingCandidate({
      title: 'Target',
      amount: 49.9,
      currency: 'CHF',
      regularAmount: 69.9,
      discountPercent: 28,
      isFree: false,
      url: 'https://psprices.com/region-ch/game/target',
      score: 97
    });
    expect(presentToast).toHaveBeenCalledWith('Unable to update pricing for Target.', 'danger');

    shelf.refreshGamePricing.mockResolvedValueOnce(
      createGame({
        igdbGameId: '42',
        platformIgdbId: 167,
        priceAmount: 39.9,
        priceCurrency: 'CHF'
      })
    );
    setField(page, 'pricingPickerTargetGame', target);
    await page.useOriginalPricingLookup();
    expect(shelf.refreshGamePricing).toHaveBeenCalledWith('42', 167);
  });

  it('applies selected/original HLTB and Metacritic candidates across success/no-match/error', async () => {
    const { page, shelf, presentToast } = createPageHarness();
    const target = createGame({ igdbGameId: '42', platformIgdbId: 6, title: 'Target' });
    setField(page, 'hltbPickerTargetGame', target);
    setField(page, 'metacriticPickerTargetGame', target);

    await page.applySelectedHltbCandidate({
      title: 'Target',
      releaseYear: 1993,
      platform: 'PC',
      hltbMainHours: 3,
      hltbMainExtraHours: 4,
      hltbCompletionistHours: 6
    });
    expect(presentToast).toHaveBeenCalledWith('Updated HLTB for Target.');

    shelf.refreshGameCompletionTimesWithQuery.mockResolvedValueOnce(createGame());
    setField(page, 'hltbPickerTargetGame', target);
    await page.applySelectedHltbCandidate({
      title: 'Target',
      releaseYear: 1993,
      platform: 'PC',
      hltbMainHours: null,
      hltbMainExtraHours: null,
      hltbCompletionistHours: null
    });
    expect(presentToast).toHaveBeenCalledWith('No HLTB match found for Target.', 'warning');

    shelf.refreshGameCompletionTimes.mockRejectedValueOnce(new Error('down'));
    setField(page, 'hltbPickerTargetGame', target);
    await page.useOriginalHltbLookup();
    expect(presentToast).toHaveBeenCalledWith('Unable to update HLTB for Target.', 'danger');

    shelf.refreshGameMetacriticScoreWithQuery.mockResolvedValueOnce(
      createGame({ metacriticScore: 90 })
    );
    setField(page, 'metacriticPickerTargetGame', target);
    await page.applySelectedMetacriticCandidate({
      title: 'Target',
      releaseYear: 1993,
      platform: 'PC',
      metacriticScore: 90,
      metacriticUrl: 'https://www.metacritic.com/game/target/'
    });
    expect(presentToast).toHaveBeenCalledWith('Updated review for Target.');

    shelf.refreshGameMetacriticScore.mockResolvedValueOnce(createGame());
    setField(page, 'metacriticPickerTargetGame', target);
    await page.useOriginalMetacriticLookup();
    expect(presentToast).toHaveBeenCalledWith('No review match found for Target.', 'warning');

    shelf.refreshGameMetacriticScore.mockRejectedValueOnce(new Error('down'));
    setField(page, 'metacriticPickerTargetGame', target);
    await page.useOriginalMetacriticLookup();
    expect(presentToast).toHaveBeenCalledWith('Unable to update review for Target.', 'danger');
  });

  it('early-returns picker apply/original handlers when target is missing', async () => {
    const { page, shelf } = createPageHarness();

    await page.applySelectedHltbCandidate({
      title: 'x',
      releaseYear: null,
      platform: null,
      hltbMainHours: null,
      hltbMainExtraHours: null,
      hltbCompletionistHours: null
    });
    await page.useOriginalHltbLookup();
    await page.applySelectedMetacriticCandidate({
      title: 'x',
      releaseYear: null,
      platform: null,
      metacriticScore: null,
      metacriticUrl: null
    });
    await page.useOriginalMetacriticLookup();

    expect(shelf.refreshGameCompletionTimesWithQuery).not.toHaveBeenCalled();
    expect(shelf.refreshGameCompletionTimes).not.toHaveBeenCalled();
    expect(shelf.refreshGameMetacriticScoreWithQuery).not.toHaveBeenCalled();
    expect(shelf.refreshGameMetacriticScore).not.toHaveBeenCalled();
  });

  it('covers modal helpers and navigation', () => {
    const { page } = createPageHarness();
    const navigateByUrl = (
      page as unknown as { router: { navigateByUrl: (url: string) => Promise<boolean> } }
    ).router.navigateByUrl as ReturnType<typeof vi.fn>;

    setField(page, 'isHltbPickerModalOpen', true);
    setField(page, 'isMetacriticPickerModalOpen', true);
    page.closeHltbPickerModal();
    page.closeMetacriticPickerModal();
    expect((page as unknown as { isHltbPickerModalOpen: boolean }).isHltbPickerModalOpen).toBe(
      false
    );
    expect(
      (page as unknown as { isMetacriticPickerModalOpen: boolean }).isMetacriticPickerModalOpen
    ).toBe(false);

    page.onHltbPickerQueryChange({ detail: { value: 'abc' } } as unknown as Event);
    page.onMetacriticPickerQueryChange({ detail: { value: 'xyz' } } as unknown as Event);
    expect((page as unknown as { hltbPickerQuery: string }).hltbPickerQuery).toBe('abc');
    expect((page as unknown as { metacriticPickerQuery: string }).metacriticPickerQuery).toBe(
      'xyz'
    );

    page.goToSettings();
    expect(navigateByUrl).toHaveBeenCalledWith('/settings');
  });

  it('covers private helpers and bulk candidate fallback paths', async () => {
    const { page, shelf, presentToast } = createPageHarness();
    const game = createGame({ igdbGameId: '7', platformIgdbId: 6, title: ' Doom ' });

    const filtered = callPrivate(
      page,
      'applyMissingMetadataFilters',
      [game, createGame({ igdbGameId: '8', metacriticScore: 88 })],
      ['metacritic']
    ) as GameEntry[];
    expect(filtered.length).toBe(1);

    const pricingFiltered = callPrivate(
      page,
      'applyMissingMetadataFilters',
      [
        createGame({ igdbGameId: '9', platformIgdbId: 6, listType: 'wishlist', priceAmount: null }),
        createGame({
          igdbGameId: '10',
          platformIgdbId: 167,
          listType: 'wishlist',
          priceAmount: 39.9
        }),
        createGame({
          igdbGameId: '11',
          platformIgdbId: 6,
          listType: 'collection',
          priceAmount: null
        })
      ],
      ['pricing']
    ) as GameEntry[];
    expect(pricingFiltered.map((entry) => entry.igdbGameId)).toEqual(['9']);

    expect(callPrivate(page, 'toPositiveNumber', 2)).toBe(2);
    expect(callPrivate(page, 'toPositiveNumber', 0)).toBeNull();
    expect(callPrivate(page, 'toMetacriticScore', 88.2)).toBe(88.2);
    expect(callPrivate(page, 'toMetacriticScore', 0)).toBeNull();

    const hltbDeduped = callPrivate(page, 'dedupeHltbCandidates', [
      {
        title: 'X',
        releaseYear: 2000,
        platform: 'PC',
        hltbMainHours: 1,
        hltbMainExtraHours: null,
        hltbCompletionistHours: null
      },
      {
        title: 'X',
        releaseYear: 2000,
        platform: 'PC',
        hltbMainHours: 1,
        hltbMainExtraHours: null,
        hltbCompletionistHours: null
      }
    ]) as HltbMatchCandidate[];
    expect(hltbDeduped.length).toBe(1);

    const mcDeduped = callPrivate(page, 'dedupeMetacriticCandidates', [
      { title: 'X', releaseYear: 2000, platform: 'PC', metacriticScore: 50, metacriticUrl: null },
      { title: 'X', releaseYear: 2000, platform: 'PC', metacriticScore: 50, metacriticUrl: null }
    ]) as MetacriticMatchCandidate[];
    expect(mcDeduped.length).toBe(1);

    // Score-completion replacement: a candidate that adds a score should replace
    // an otherwise-identical candidate that is missing a score.
    const reviewDeduped = callPrivate(page, 'dedupeReviewCandidates', [
      {
        title: 'Y',
        releaseYear: 2020,
        platform: 'PS5',
        reviewScore: null,
        reviewUrl: null,
        reviewSource: null,
        imageUrl: null
      },
      {
        title: 'Y',
        releaseYear: 2020,
        platform: 'PS5',
        reviewScore: 85,
        reviewUrl: 'https://www.metacritic.com/game/y/',
        reviewSource: 'metacritic' as const,
        imageUrl: null
      }
    ]) as ReviewMatchCandidate[];
    expect(reviewDeduped.length).toBe(1);
    expect(reviewDeduped[0].reviewScore).toBe(85);

    shelf.searchHltbCandidates.mockReturnValueOnce(of([]));
    await (callPrivate(page, 'refreshHltbForBulkGame', game) as Promise<GameEntry>);
    expect(shelf.refreshGameCompletionTimes).toHaveBeenCalledWith('7', 6);

    shelf.searchHltbCandidates.mockReturnValueOnce(
      throwError(() => new Error('429 retry after 1 s'))
    );
    await expect(
      callPrivate(page, 'refreshHltbForBulkGame', game) as Promise<GameEntry>
    ).rejects.toThrow();

    shelf.searchReviewCandidates.mockReturnValueOnce(of([]));
    await (callPrivate(page, 'refreshMetacriticForBulkGame', game) as Promise<GameEntry>);
    expect(shelf.refreshGameMetacriticScore).toHaveBeenCalledWith('7', 6);

    shelf.searchReviewCandidates.mockReturnValueOnce(
      throwError(() => new Error('429 retry after 1 s'))
    );
    await expect(
      callPrivate(page, 'refreshMetacriticForBulkGame', game) as Promise<GameEntry>
    ).rejects.toThrow();

    await (callPrivate(page, 'presentToast', 'hello', 'warning') as Promise<void>);
    expect(presentToast).toHaveBeenCalledWith('hello', 'warning');
  });

  it('covers private modal opening and candidate branches', async () => {
    const { page, shelf } = createPageHarness();
    const game = createGame({ igdbGameId: '9', platformIgdbId: 6, title: 'Test' });
    const unsupported = createGame({ igdbGameId: '10', platformIgdbId: 999999, title: 'Test2' });

    const runHltbPickerSearch = vi.fn(() => Promise.resolve(undefined));
    const runMetacriticPickerSearch = vi.fn(() => Promise.resolve(undefined));
    setField(page, 'runHltbPickerSearch', runHltbPickerSearch);
    setField(page, 'runMetacriticPickerSearch', runMetacriticPickerSearch);

    await (callPrivate(page, 'openHltbPickerModal', game) as Promise<void>);
    expect(runHltbPickerSearch).toHaveBeenCalledOnce();

    await (callPrivate(page, 'openMetacriticPickerModal', unsupported) as Promise<void>);
    expect(runMetacriticPickerSearch).toHaveBeenCalledOnce();

    await (callPrivate(page, 'openMetacriticPickerModal', game) as Promise<void>);
    expect(runMetacriticPickerSearch).toHaveBeenCalledTimes(2);

    shelf.searchHltbCandidates.mockReturnValueOnce(
      of([
        {
          title: 'Test',
          releaseYear: 1993,
          platform: 'PC',
          hltbMainHours: 1,
          hltbMainExtraHours: null,
          hltbCompletionistHours: null
        }
      ])
    );
    await (callPrivate(page, 'refreshHltbForBulkGame', game) as Promise<GameEntry>);
    expect(shelf.refreshGameCompletionTimesWithQuery).toHaveBeenCalled();

    shelf.searchReviewCandidates.mockReturnValueOnce(
      of([
        {
          title: 'Test',
          releaseYear: 1993,
          platform: 'PC',
          reviewScore: 70,
          reviewUrl: 'https://www.metacritic.com/game/test/',
          reviewSource: 'metacritic' as const,
          mobygamesGameId: null
        }
      ])
    );
    await (callPrivate(page, 'refreshMetacriticForBulkGame', game) as Promise<GameEntry>);
    expect(shelf.refreshGameMetacriticScoreWithQuery).toHaveBeenCalled();
  });

  it('covers bulk pricing helper branches for supported/unsupported and fallback paths', async () => {
    const { page, shelf } = createPageHarness();
    const unsupported = createGame({ igdbGameId: '20', platformIgdbId: 3, title: 'Console' });
    const supported = createGame({ igdbGameId: '21', platformIgdbId: 167, title: 'PS Test' });

    await (callPrivate(page, 'refreshPricingForBulkGame', unsupported) as Promise<GameEntry>);
    expect(shelf.refreshGamePricing).toHaveBeenCalledWith('20', 3);

    shelf.searchPricingCandidates.mockReturnValueOnce(of([]));
    await (callPrivate(page, 'refreshPricingForBulkGame', supported) as Promise<GameEntry>);
    expect(shelf.refreshGamePricing).toHaveBeenCalledWith('21', 167);

    shelf.searchPricingCandidates.mockReturnValueOnce(
      of([{ title: 'PS Test Candidate', amount: 19.9 } as PriceMatchCandidate])
    );
    await (callPrivate(page, 'refreshPricingForBulkGame', supported) as Promise<GameEntry>);
    expect(shelf.refreshGamePricingWithQuery).toHaveBeenCalledWith('21', 167, {
      title: 'PS Test Candidate'
    });

    shelf.searchPricingCandidates.mockReturnValueOnce(
      throwError(() => new Error('temporary down'))
    );
    await (callPrivate(page, 'refreshPricingForBulkGame', supported) as Promise<GameEntry>);
    expect(shelf.refreshGamePricing).toHaveBeenCalledWith('21', 167);

    shelf.searchPricingCandidates.mockReturnValueOnce(
      throwError(() => new Error('Rate limit exceeded. Retry after 10s.'))
    );
    await expect(
      callPrivate(page, 'refreshPricingForBulkGame', supported) as Promise<GameEntry>
    ).rejects.toThrow();
  });

  it('covers selection sync, review modal wrapper, and hltb non-rate-limit fallback trace', async () => {
    const { page, shelf, debugTrace } = createPageHarness();
    const visible = createGame({ igdbGameId: '32', platformIgdbId: 6, title: 'Visible' });

    setField(page, 'displayedGames', [visible]);
    setField(page, 'selectedGameKeys', new Set(['31::6', '32::6']));
    callPrivate(page, 'syncSelectionToDisplayedGames');
    expect((page as unknown as { selectedGameKeys: Set<string> }).selectedGameKeys).toEqual(
      new Set(['32::6'])
    );

    const openMetacriticPickerModal = vi.fn(() => Promise.resolve(undefined));
    setField(page, 'openMetacriticPickerModal', openMetacriticPickerModal);
    await (callPrivate(page, 'openReviewPickerModal', visible) as Promise<void>);
    expect(openMetacriticPickerModal).toHaveBeenCalledWith(visible);

    shelf.searchHltbCandidates.mockReturnValueOnce(throwError(() => new Error('temporary down')));
    await (callPrivate(page, 'refreshHltbForBulkGame', visible) as Promise<GameEntry>);
    expect(debugTrace).toHaveBeenCalledWith(
      'metadata_validator.bulk_hltb.candidate_search_failed',
      expect.objectContaining({ gameKey: '32::6' })
    );
  });

  it('handles metacritic picker short query, no-match, success, and error paths', async () => {
    const { page, shelf, presentToast } = createPageHarness();
    const target = createGame({ igdbGameId: '11', platformIgdbId: 6, title: 'Target' });

    setField(page, 'metacriticPickerQuery', 'x');
    await page.runMetacriticPickerSearch();
    expect(
      (page as unknown as { metacriticPickerResults: MetacriticMatchCandidate[] })
        .metacriticPickerResults
    ).toEqual([]);
    expect(
      (page as unknown as { metacriticPickerError: string | null }).metacriticPickerError
    ).toBe('Enter at least 2 characters.');

    shelf.refreshGameMetacriticScoreWithQuery.mockResolvedValueOnce(
      createGame({ metacriticScore: null, metacriticUrl: null })
    );
    setField(page, 'metacriticPickerTargetGame', target);
    await page.applySelectedMetacriticCandidate({
      title: 'Target',
      releaseYear: 1993,
      platform: 'PC',
      metacriticScore: 10,
      metacriticUrl: null
    });
    expect(presentToast).toHaveBeenCalledWith('No review match found for Target.', 'warning');

    shelf.refreshGameMetacriticScore.mockResolvedValueOnce(
      createGame({ metacriticScore: 80, metacriticUrl: 'https://www.metacritic.com/game/target/' })
    );
    setField(page, 'metacriticPickerTargetGame', target);
    await page.useOriginalMetacriticLookup();
    expect(presentToast).toHaveBeenCalledWith('Updated review for Target.');

    shelf.refreshGameMetacriticScoreWithQuery.mockRejectedValueOnce(new Error('down'));
    setField(page, 'metacriticPickerTargetGame', target);
    await page.applySelectedMetacriticCandidate({
      title: 'Target',
      releaseYear: 1993,
      platform: 'PC',
      metacriticScore: 80,
      metacriticUrl: null
    });
    expect(presentToast).toHaveBeenCalledWith('Unable to update review for Target.', 'danger');

    shelf.refreshGameMetacriticScoreWithQuery.mockRejectedValueOnce(
      new Error('Rate limit exceeded. Retry after 7s.')
    );
    setField(page, 'metacriticPickerTargetGame', target);
    await page.applySelectedMetacriticCandidate({
      title: 'Target',
      releaseYear: 1993,
      platform: 'PC',
      metacriticScore: 80,
      metacriticUrl: null
    });
    expect(presentToast).toHaveBeenCalledWith('Rate limited. Retry after 7s.', 'warning');

    shelf.refreshGameMetacriticScore.mockRejectedValueOnce(
      new Error('Rate limit exceeded. Retry after 5s.')
    );
    setField(page, 'metacriticPickerTargetGame', target);
    await page.useOriginalMetacriticLookup();
    expect(presentToast).toHaveBeenCalledWith('Rate limited. Retry after 5s.', 'warning');
    expect(
      (page as unknown as { isMetacriticPickerLoading: boolean }).isMetacriticPickerLoading
    ).toBe(false);
  });

  it('covers real private delay/presentToast implementations', async () => {
    const { page } = createPageHarness();
    const toastCreate = vi.fn(() =>
      Promise.resolve({ present: vi.fn(() => Promise.resolve(undefined)) })
    );
    setField(page, 'toastController', { create: toastCreate });
    delete (page as Record<string, unknown>)['presentToast'];
    delete (page as Record<string, unknown>)['delay'];

    await (callPrivate(page, 'delay', 0) as Promise<void>);
    await (callPrivate(page, 'presentToast', 'real', 'danger') as Promise<void>);
    expect(toastCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'real',
        color: 'danger'
      })
    );
  });
});
