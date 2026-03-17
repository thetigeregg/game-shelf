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
    requeueEnrichment: vi.fn(() => of({ ok: true, queued: true, deduped: false, jobId: 55 })),
    requeueEnrichmentRun: vi.fn(() => of({ ok: true, queued: false, deduped: true, jobId: 55 })),
  };
  const toastCreate = vi.fn(() =>
    Promise.resolve({ present: vi.fn(() => Promise.resolve(undefined)) })
  );

  setField(page, 'providerOptions', [
    { value: 'hltb', label: 'HLTB' },
    { value: 'review', label: 'Review' },
    { value: 'pricing', label: 'Pricing' },
  ]);
  setField(page, 'reviewSourceOptions', [
    { value: 'metacritic', label: 'Metacritic' },
    { value: 'mobygames', label: 'MobyGames' },
  ]);
  setField(page, 'gameShelfService', gameShelfService);
  setField(page, 'adminMatchService', adminMatchService as unknown as AdminDiscoveryMatchService);
  setField(page, 'adminAuth', { getToken: vi.fn(() => null), hasToken: vi.fn(() => false) });
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
    },
  ]);
  setField(page, 'isListRequeueing', false);
  setField(page, 'isRequeueing', false);
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

  it('requeues discovery enrichment for the active game and surfaces a toast', async () => {
    const { page, adminMatchService, toastCreate } = createPageHarness();

    await (
      page as { requeueActiveGameEnrichment: () => Promise<void> }
    ).requeueActiveGameEnrichment();

    expect(adminMatchService.requeueEnrichment).toHaveBeenCalledWith('123', 48);
    expect(toastCreate).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Discovery enrichment queued.', color: 'success' })
    );
    expect(page.isRequeueing).toBe(false);
  });

  it('queues the list-level discovery enrichment run and reports deduped state', async () => {
    const { page, adminMatchService, toastCreate } = createPageHarness();

    await (page as { requeueDiscoveryRun: () => Promise<void> }).requeueDiscoveryRun();

    expect(adminMatchService.requeueEnrichmentRun).toHaveBeenCalledTimes(1);
    expect(toastCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Discovery enrichment run is already queued.',
        color: 'success',
      })
    );
    expect(page.isListRequeueing).toBe(false);
  });
});
