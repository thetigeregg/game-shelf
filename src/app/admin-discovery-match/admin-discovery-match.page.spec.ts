import { describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';

vi.mock('@ionic/angular/standalone', () => {
  const Stub = () => null;

  return {
    IonBackButton: Stub,
    IonBadge: Stub,
    IonButton: Stub,
    IonButtons: Stub,
    IonContent: Stub,
    IonFooter: Stub,
    IonHeader: Stub,
    IonInput: Stub,
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
    IonTitle: Stub,
    IonToolbar: Stub,
    ToastController: Stub,
  };
});

import { AdminDiscoveryMatchPage } from './admin-discovery-match.page';
import { groupAdminDiscoveryItems } from './admin-discovery-match.utils';
import type {
  AdminDiscoveryDetailResponse,
  AdminDiscoveryMatchService,
} from '../core/services/admin-discovery-match.service';
import type { GameShelfService } from '../core/services/game-shelf.service';
import type {
  HltbMatchCandidate,
  PriceMatchCandidate,
  ReviewMatchCandidate,
} from '../core/models/game.models';

function setField(target: object, key: string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

function createDetail(): AdminDiscoveryDetailResponse {
  return {
    igdbGameId: '123',
    platformIgdbId: 48,
    title: 'Chrono Trigger',
    platform: 'PlayStation',
    releaseYear: 1999,
    matchState: {
      hltb: {
        status: 'missing',
        locked: false,
        attempts: 0,
        lastTriedAt: null,
        nextTryAt: null,
        permanentMiss: false,
      },
      review: {
        status: 'missing',
        locked: false,
        attempts: 0,
        lastTriedAt: null,
        nextTryAt: null,
        permanentMiss: false,
      },
      pricing: {
        status: 'missing',
        locked: false,
        attempts: 0,
        lastTriedAt: null,
        nextTryAt: null,
        permanentMiss: false,
      },
    },
    providers: {
      hltb: {
        hltbGameId: null,
        hltbUrl: null,
        hltbMainHours: null,
        hltbMainExtraHours: null,
        hltbCompletionistHours: null,
        queryTitle: 'Chrono Trigger',
        queryReleaseYear: 1999,
        queryPlatform: 'PlayStation',
      },
      review: {
        reviewSource: null,
        reviewScore: null,
        reviewUrl: null,
        metacriticScore: null,
        metacriticUrl: null,
        mobygamesGameId: null,
        mobyScore: null,
        queryTitle: 'Chrono Trigger',
        queryReleaseYear: 1999,
        queryPlatform: 'PlayStation',
        queryPlatformIgdbId: 48,
        queryMobygamesGameId: null,
      },
      pricing: {
        priceSource: null,
        priceFetchedAt: null,
        priceAmount: null,
        priceCurrency: null,
        priceRegularAmount: null,
        priceDiscountPercent: null,
        priceIsFree: false,
        priceUrl: null,
        psPricesUrl: null,
        psPricesTitle: null,
        psPricesPlatform: null,
      },
    },
  };
}

function createPageHarness(): {
  page: AdminDiscoveryMatchPage;
  gameShelfService: Pick<
    GameShelfService,
    'searchHltbCandidates' | 'searchReviewCandidates' | 'searchPricingCandidates'
  > & {
    searchHltbCandidates: ReturnType<typeof vi.fn>;
    searchReviewCandidates: ReturnType<typeof vi.fn>;
    searchPricingCandidates: ReturnType<typeof vi.fn>;
  };
  adminMatchService: {
    requeueEnrichment: ReturnType<typeof vi.fn>;
    requeueEnrichmentRun: ReturnType<typeof vi.fn>;
  };
  toastCreate: ReturnType<typeof vi.fn>;
} {
  const page = Object.create(AdminDiscoveryMatchPage.prototype) as AdminDiscoveryMatchPage;
  const gameShelfService = {
    searchHltbCandidates: vi.fn(() => of([])),
    searchReviewCandidates: vi.fn(() => of([])),
    searchPricingCandidates: vi.fn(() => of([])),
  };
  const adminMatchService = {
    requeueEnrichment: vi.fn(() =>
      of({ ok: true, queued: true, deduped: false, jobId: 55, queuedCount: 1, dedupedCount: 0 })
    ),
    requeueEnrichmentRun: vi.fn(() =>
      of({ ok: true, queued: false, deduped: true, jobId: 55, queuedCount: 0, dedupedCount: 1 })
    ),
  };
  const toastCreate = vi.fn(() =>
    Promise.resolve({ present: vi.fn(() => Promise.resolve(undefined)) })
  );

  setField(page, 'providerOptions', [
    { value: 'hltb', label: 'HLTB' },
    { value: 'review', label: 'Review' },
    { value: 'pricing', label: 'Pricing' },
  ]);
  setField(page, 'selectedProvider', 'hltb');
  setField(page, 'selectedState', 'all');
  setField(page, 'searchQuery', '');
  setField(page, 'reviewSourceOptions', [
    { value: 'metacritic', label: 'Metacritic' },
    { value: 'mobygames', label: 'MobyGames' },
  ]);
  setField(page, 'pricingSourceOptions', [
    { value: 'steam_store', label: 'Steam Store' },
    { value: 'psprices', label: 'PSPrices' },
  ]);
  setField(page, 'gameShelfService', gameShelfService);
  setField(page, 'adminMatchService', adminMatchService as unknown as AdminDiscoveryMatchService);
  setField(page, 'clientWriteAuth', {
    getToken: vi.fn(() => 'device-token-1'),
    hasToken: vi.fn(() => true),
  });
  setField(page, 'toastController', { create: toastCreate });
  setField(page, 'activeDetail', createDetail());
  setField(page, 'activeModalProvider', 'hltb');
  setField(page, 'items', [
    {
      igdbGameId: '123',
      platformIgdbId: 48,
      title: 'Chrono Trigger',
      platform: 'PlayStation',
      releaseYear: 1999,
      matchState: createDetail().matchState,
      gameKeys: ['123::48'],
      platformLabels: ['PlayStation'],
      groupedPlatformCount: 1,
      sourceItems: [createDetail()],
    },
  ]);
  setField(page, 'listQueueStatusMessage', null);
  setField(page, 'listQueueStatusDetail', null);
  setField(page, 'listQueueStatusTone', 'success');
  setField(page, 'isListRequeueing', false);
  setField(page, 'isRequeueing', false);
  setField(page, 'activeQueueStatusMessage', null);
  setField(page, 'activeQueueStatusDetail', null);
  setField(page, 'activeQueueStatusTone', 'success');
  setField(page, 'activeGroup', null);
  setField(page, 'hltbSearchQuery', 'Chrono Trigger');
  setField(page, 'hltbSearchResults', []);
  setField(page, 'hltbSearchError', null);
  setField(page, 'isHltbSearchLoading', false);
  setField(page, 'hltbSearchHasRun', false);
  setField(page, 'reviewSearchQuery', 'Chrono Trigger');
  setField(page, 'reviewSearchResults', []);
  setField(page, 'reviewSearchError', null);
  setField(page, 'isReviewSearchLoading', false);
  setField(page, 'reviewSearchHasRun', false);
  setField(page, 'pricingSearchQuery', 'Chrono Trigger');
  setField(page, 'pricingSearchResults', []);
  setField(page, 'pricingSearchError', null);
  setField(page, 'isPricingSearchLoading', false);
  setField(page, 'pricingSearchHasRun', false);
  setField(page, 'hltbForm', {
    hltbGameId: '',
    hltbUrl: '',
    hltbMainHours: '',
    hltbMainExtraHours: '',
    hltbCompletionistHours: '',
    queryTitle: 'Chrono Trigger',
    queryReleaseYear: '1999',
    queryPlatform: 'PlayStation',
  });
  setField(page, 'reviewForm', {
    reviewSource: 'metacritic',
    reviewScore: '',
    reviewUrl: '',
    metacriticScore: '',
    metacriticUrl: '',
    mobygamesGameId: '',
    mobyScore: '',
    queryTitle: 'Chrono Trigger',
    queryReleaseYear: '1999',
    queryPlatform: 'PlayStation',
  });
  setField(page, 'pricingForm', {
    priceSource: 'psprices',
    priceFetchedAt: '',
    priceAmount: '',
    priceCurrency: '',
    priceRegularAmount: '',
    priceDiscountPercent: '',
    priceIsFree: false,
    priceUrl: '',
    psPricesUrl: '',
    psPricesTitle: '',
    psPricesPlatform: '',
  });

  return { page, gameShelfService, adminMatchService, toastCreate };
}

describe('AdminDiscoveryMatchPage', () => {
  it('searches and deduplicates HLTB candidates for the active provider', async () => {
    const { page, gameShelfService } = createPageHarness();
    const duplicateCandidate: HltbMatchCandidate = {
      title: 'Chrono Trigger',
      releaseYear: 1999,
      platform: 'PlayStation',
      hltbMainHours: 22,
      hltbMainExtraHours: 28,
      hltbCompletionistHours: 41,
      hltbGameId: 101,
      hltbUrl: 'https://howlongtobeat.com/game/101',
      isRecommended: true,
    };

    gameShelfService.searchHltbCandidates.mockReturnValue(
      of([duplicateCandidate, { ...duplicateCandidate }])
    );

    await page.searchActiveProviderCandidates();

    expect(gameShelfService.searchHltbCandidates).toHaveBeenCalledWith(
      'Chrono Trigger',
      1999,
      'PlayStation'
    );
    expect(page.hltbSearchHasRun).toBe(true);
    expect(page.hltbSearchError).toBeNull();
    expect(page.hltbSearchResults).toHaveLength(1);
    expect(page.hltbSearchResults[0].hltbGameId).toBe(101);
  });

  it('applies a review candidate into the editable form fields', () => {
    const { page } = createPageHarness();
    page.reviewForm.metacriticScore = '88';
    page.reviewForm.metacriticUrl = 'https://www.metacritic.com/game/chrono-trigger';
    const candidate: ReviewMatchCandidate = {
      title: 'Chrono Trigger',
      releaseYear: 1999,
      platform: 'PlayStation',
      reviewScore: 91,
      reviewUrl: 'https://www.mobygames.com/game/chrono-trigger',
      reviewSource: 'mobygames',
      mobyScore: 9.1,
      mobygamesGameId: 222,
      isRecommended: true,
    };

    page.applyReviewCandidate(candidate);

    expect(page.reviewForm.reviewSource).toBe('mobygames');
    expect(page.reviewForm.reviewScore).toBe('91');
    expect(page.reviewForm.reviewUrl).toBe('https://www.mobygames.com/game/chrono-trigger');
    expect(page.reviewForm.metacriticScore).toBe('');
    expect(page.reviewForm.metacriticUrl).toBe('');
    expect(page.reviewForm.mobygamesGameId).toBe('222');
    expect(page.reviewForm.mobyScore).toBe('9.1');
    expect(page.reviewForm.queryTitle).toBe('Chrono Trigger');
    expect(page.reviewForm.queryReleaseYear).toBe('1999');
    expect(page.reviewForm.queryPlatform).toBe('PlayStation');
  });

  it('maps pricing search rate-limit errors into UI copy', async () => {
    const { page, gameShelfService } = createPageHarness();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    page.activeModalProvider = 'pricing';
    gameShelfService.searchPricingCandidates.mockReturnValue(
      throwError(() => new Error('429 too many requests, retry after 12s'))
    );

    try {
      await page.searchActiveProviderCandidates();

      expect(gameShelfService.searchPricingCandidates).toHaveBeenCalledWith(
        '123',
        48,
        'Chrono Trigger'
      );
      expect(page.pricingSearchResults).toEqual([]);
      expect(page.pricingSearchError).toBe('Rate limited. Retry after 12s.');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('applies a pricing candidate into the editable form fields', () => {
    const { page } = createPageHarness();
    const candidate: PriceMatchCandidate = {
      title: 'Chrono Trigger',
      amount: 19.99,
      currency: 'USD',
      regularAmount: 39.99,
      discountPercent: 50,
      isFree: false,
      url: 'https://psprices.com/us/game/chrono-trigger',
      score: 0.96,
      source: 'psprices',
      isRecommended: true,
    };

    page.applyPricingCandidate(candidate);

    expect(page.pricingForm.priceSource).toBe('psprices');
    expect(page.pricingForm.priceAmount).toBe('19.99');
    expect(page.pricingForm.priceCurrency).toBe('USD');
    expect(page.pricingForm.priceRegularAmount).toBe('39.99');
    expect(page.pricingForm.priceDiscountPercent).toBe('50');
    expect(page.pricingForm.priceUrl).toBe('https://psprices.com/us/game/chrono-trigger');
    expect(page.pricingForm.psPricesUrl).toBe('https://psprices.com/us/game/chrono-trigger');
    expect(page.pricingForm.psPricesTitle).toBe('Chrono Trigger');
  });

  it('defaults PC pricing form source to steam and applies steam candidates without psprices fields', () => {
    const { page } = createPageHarness();
    const detail: AdminDiscoveryDetailResponse = {
      ...createDetail(),
      platformIgdbId: 6,
      providers: {
        ...createDetail().providers,
        pricing: {
          ...createDetail().providers.pricing,
          priceSource: null,
          psPricesUrl: 'https://psprices.com/us/game/portal-2',
          psPricesTitle: 'Portal 2',
          psPricesPlatform: 'PS3',
        },
      },
    };
    setField(page, 'activeDetail', {
      ...detail,
    });

    (
      page as unknown as { syncFormsFromDetail: (payload: AdminDiscoveryDetailResponse) => void }
    ).syncFormsFromDetail(detail);

    expect(page.pricingForm.priceSource).toBe('steam_store');
    expect(page.showPsPricesFields).toBe(false);
    expect(page.pricingForm.psPricesUrl).toBe('');
    expect(page.pricingForm.psPricesTitle).toBe('');
    expect(page.pricingForm.psPricesPlatform).toBe('');
    expect(page.pricingSearchQuery).toBe('Chrono Trigger');

    page.applyPricingCandidate({
      title: 'Portal 2',
      amount: 9.99,
      currency: 'USD',
      regularAmount: 19.99,
      discountPercent: 50,
      isFree: false,
      url: 'https://store.steampowered.com/app/620/Portal_2/',
      score: null,
      source: 'steam_store',
      isRecommended: true,
    });

    expect(page.pricingForm.priceSource).toBe('steam_store');
    expect(page.showPsPricesFields).toBe(false);
    expect(page.pricingForm.priceUrl).toBe('https://store.steampowered.com/app/620/Portal_2/');
    expect(page.pricingForm.psPricesUrl).toBe('');
    expect(page.pricingForm.psPricesTitle).toBe('');
    expect(page.pricingForm.psPricesPlatform).toBe('');
  });

  it('clears psprices fields from the pricing update payload when the source is steam', () => {
    const { page } = createPageHarness();
    page.pricingForm = {
      ...page.pricingForm,
      priceSource: 'steam_store',
      priceAmount: '9.99',
      priceUrl: 'https://store.steampowered.com/app/620/Portal_2/',
      psPricesUrl: 'https://psprices.com/us/game/portal-2',
      psPricesTitle: 'Portal 2',
      psPricesPlatform: 'PS3',
    };

    const request = (
      page as unknown as {
        buildUpdateRequest: (provider: 'pricing') => Record<string, unknown>;
      }
    ).buildUpdateRequest('pricing');

    expect(request['priceSource']).toBe('steam_store');
    expect(request['psPricesUrl']).toBeNull();
    expect(request['psPricesTitle']).toBeNull();
    expect(request['psPricesPlatform']).toBeNull();
  });

  it('drops negative admin ids and years from HLTB and review update payloads', () => {
    const { page } = createPageHarness();

    page.hltbForm = {
      ...page.hltbForm,
      hltbGameId: '-101',
      queryReleaseYear: '-1999',
      hltbMainHours: '8.5',
    };
    page.reviewForm = {
      ...page.reviewForm,
      reviewSource: 'mobygames',
      mobygamesGameId: '-222',
      queryReleaseYear: '-2000',
      reviewScore: '81',
    };

    const hltbRequest = (
      page as unknown as {
        buildUpdateRequest: (provider: 'hltb') => Record<string, unknown>;
      }
    ).buildUpdateRequest('hltb');
    const reviewRequest = (
      page as unknown as {
        buildUpdateRequest: (provider: 'review') => Record<string, unknown>;
      }
    ).buildUpdateRequest('review');

    expect(hltbRequest['hltbGameId']).toBeNull();
    expect(hltbRequest['queryReleaseYear']).toBeNull();
    expect(reviewRequest['mobygamesGameId']).toBeNull();
    expect(reviewRequest['queryReleaseYear']).toBeNull();
  });

  it('requeues discovery enrichment for the active game and surfaces a toast', async () => {
    const { page, adminMatchService, toastCreate } = createPageHarness();
    setField(page, 'activeGroup', page.items[0]);

    await (
      page as { requeueActiveGameEnrichment: () => Promise<void> }
    ).requeueActiveGameEnrichment();

    expect(adminMatchService.requeueEnrichment).toHaveBeenCalledWith('123', 48, 'hltb');
    expect(page.activeQueueStatusMessage).toBe(
      'Targeted discovery enrichment queued for this game.'
    );
    expect(page.activeQueueStatusDetail).toBe('Targeted row: Chrono Trigger (PlayStation, 1999)');
    expect(page.activeQueueStatusTone).toBe('success');
    expect(toastCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Targeted discovery enrichment queued for this game.',
        color: 'success',
      })
    );
    expect(page.isRequeueing).toBe(false);
  });

  it('queues the list-level discovery enrichment run and reports deduped state', async () => {
    const { page, adminMatchService, toastCreate } = createPageHarness();

    await (page as { requeueDiscoveryRun: () => Promise<void> }).requeueDiscoveryRun();

    expect(adminMatchService.requeueEnrichmentRun).toHaveBeenCalledWith('hltb', ['123::48']);
    expect(page.listQueueStatusMessage).toBe('Targeted discovery enrichment is already queued.');
    expect(page.listQueueStatusDetail).toBe('1 game targeted: Chrono Trigger (PlayStation, 1999)');
    expect(page.listQueueStatusTone).toBe('warning');
    expect(toastCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Targeted discovery enrichment is already queued.',
        color: 'warning',
      })
    );
    expect(page.isListRequeueing).toBe(false);
  });

  it('stores a danger status when list-level requeue fails', async () => {
    const { page, adminMatchService } = createPageHarness();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    adminMatchService.requeueEnrichmentRun.mockReturnValue(
      throwError(() => new Error('queue offline'))
    );

    try {
      await (page as { requeueDiscoveryRun: () => Promise<void> }).requeueDiscoveryRun();

      expect(adminMatchService.requeueEnrichmentRun).toHaveBeenCalledWith('hltb', ['123::48']);
      expect(page.listQueueStatusMessage).toBe('queue offline');
      expect(page.listQueueStatusDetail).toBe(
        '1 game targeted: Chrono Trigger (PlayStation, 1999)'
      );
      expect(page.listQueueStatusTone).toBe('danger');
      expect(page.isListRequeueing).toBe(false);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('queues pricing revalidation for the active game', async () => {
    const { page, adminMatchService, toastCreate } = createPageHarness();
    setField(page, 'activeModalProvider', 'pricing');
    setField(page, 'activeGroup', page.items[0]);

    await (
      page as { requeueActiveGameEnrichment: () => Promise<void> }
    ).requeueActiveGameEnrichment();

    expect(adminMatchService.requeueEnrichment).toHaveBeenCalledWith('123', 48, 'pricing');
    expect(page.activeQueueStatusMessage).toBe('Targeted pricing refresh queued for this game.');
    expect(toastCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Targeted pricing refresh queued for this game.',
        color: 'success',
      })
    );
  });

  it('summarizes multiple targeted rows in the persistent list status detail', async () => {
    const { page, adminMatchService } = createPageHarness();

    page.items = [
      {
        igdbGameId: '123',
        platformIgdbId: 48,
        title: 'Chrono Trigger',
        platform: 'PlayStation',
        releaseYear: 1999,
        matchState: createDetail().matchState,
        gameKeys: ['123::48'],
        platformLabels: ['PlayStation'],
        groupedPlatformCount: 1,
        sourceItems: [createDetail()],
      },
      {
        igdbGameId: '200',
        platformIgdbId: 6,
        title: 'Half-Life',
        platform: 'PC',
        releaseYear: 1998,
        matchState: createDetail().matchState,
        gameKeys: ['200::6'],
        platformLabels: ['PC'],
        groupedPlatformCount: 1,
        sourceItems: [
          {
            ...createDetail(),
            igdbGameId: '200',
            platformIgdbId: 6,
            title: 'Half-Life',
            platform: 'PC',
            releaseYear: 1998,
          },
        ],
      },
      {
        igdbGameId: '300',
        platformIgdbId: 167,
        title: 'Astro Bot',
        platform: 'PlayStation 5',
        releaseYear: 2024,
        matchState: createDetail().matchState,
        gameKeys: ['300::167'],
        platformLabels: ['PlayStation 5'],
        groupedPlatformCount: 1,
        sourceItems: [
          {
            ...createDetail(),
            igdbGameId: '300',
            platformIgdbId: 167,
            title: 'Astro Bot',
            platform: 'PlayStation 5',
            releaseYear: 2024,
          },
        ],
      },
      {
        igdbGameId: '400',
        platformIgdbId: 130,
        title: 'Nioh',
        platform: 'PlayStation 4',
        releaseYear: 2017,
        matchState: createDetail().matchState,
        gameKeys: ['400::130'],
        platformLabels: ['PlayStation 4'],
        groupedPlatformCount: 1,
        sourceItems: [
          {
            ...createDetail(),
            igdbGameId: '400',
            platformIgdbId: 130,
            title: 'Nioh',
            platform: 'PlayStation 4',
            releaseYear: 2017,
          },
        ],
      },
    ];
    adminMatchService.requeueEnrichmentRun.mockReturnValue(
      of({ ok: true, queued: true, deduped: false, jobId: 71, queuedCount: 4, dedupedCount: 0 })
    );

    await (page as { requeueDiscoveryRun: () => Promise<void> }).requeueDiscoveryRun();

    expect(adminMatchService.requeueEnrichmentRun).toHaveBeenCalledWith('hltb', [
      '123::48',
      '200::6',
      '300::167',
      '400::130',
    ]);
    expect(page.listQueueStatusDetail).toBe(
      '4 games targeted: Chrono Trigger (PlayStation, 1999), Half-Life (PC, 1998), Astro Bot (PlayStation 5, 2024), +1 more'
    );
  });

  it('collapses matching discovery rows across multiple platforms into one grouped item', () => {
    const grouped = groupAdminDiscoveryItems([
      createDetail(),
      {
        ...createDetail(),
        platformIgdbId: 167,
        platform: 'PlayStation 5',
      },
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.platform).toBe('Multiple platforms');
    expect(grouped[0]?.groupedPlatformCount).toBe(2);
    expect(grouped[0]?.gameKeys).toEqual(['123::48', '123::167']);
    expect(grouped[0]?.sourceItems).toHaveLength(2);
  });

  it('keeps permanent-miss bulk reset keys from underlying grouped rows', () => {
    const { page } = createPageHarness();
    const grouped = groupAdminDiscoveryItems([
      {
        ...createDetail(),
        matchState: {
          ...createDetail().matchState,
          hltb: {
            ...createDetail().matchState.hltb,
            status: 'permanentMiss',
            permanentMiss: true,
            attempts: 6,
          },
        },
      },
      {
        ...createDetail(),
        platformIgdbId: 167,
        platform: 'PlayStation 5',
        matchState: {
          ...createDetail().matchState,
          hltb: {
            ...createDetail().matchState.hltb,
            status: 'missing',
          },
        },
      },
    ]);

    setField(page, 'selectedProvider', 'hltb');
    setField(page, 'items', grouped);

    expect(page.visiblePermanentMissKeys).toEqual(['123::48']);
    expect(grouped[0]?.matchState.hltb.status).toBe('permanentMiss');
  });
});
