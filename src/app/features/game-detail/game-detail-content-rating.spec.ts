import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

const swiperConstructorMock = vi.hoisted(() => vi.fn());

vi.mock('ionicons', () => ({
  addIcons: vi.fn(),
}));

vi.mock('@ionic/angular/standalone', () => ({
  IonGrid: {},
  IonRow: {},
  IonCol: {},
  IonList: {},
  IonItem: {},
  IonLabel: {},
  IonBadge: {},
  IonButton: {},
  IonButtons: {},
  IonSelect: {},
  IonSelectOption: {},
  IonIcon: {},
  IonToolbar: {},
}));

vi.mock('ionicons/icons', () => ({
  add: {},
  ban: {},
  cash: {},
  build: {},
  business: {},
  calendar: {},
  documentText: {},
  gameController: {},
  gitBranch: {},
  grid: {},
  hardwareChip: {},
  book: {},
  library: {},
  medal: {},
  pricetags: {},
  star: {},
  time: {},
  trophy: {},
}));

vi.mock('swiper', () => ({
  default: function SwiperMock(this: unknown, ...args: unknown[]) {
    return swiperConstructorMock(...args) as SwiperInstanceMock;
  },
}));

vi.mock('swiper/modules', () => ({
  Pagination: {},
  Zoom: {},
}));

import { GameDetailContentComponent } from './game-detail-content.component';
import { PlatformCustomizationService } from '../../core/services/platform-customization.service';
import type { GameEntry, GameWebsite } from '../../core/models/game.models';

type SwiperInstanceMock = {
  allowTouchMove: boolean;
  update: ReturnType<typeof vi.fn>;
  pagination: {
    render: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  destroy: ReturnType<typeof vi.fn>;
};

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
    ...overrides,
  };
}

function makeWebsite(overrides: Partial<GameWebsite> = {}): GameWebsite {
  return {
    provider: 'steam',
    providerLabel: 'Steam',
    url: 'https://store.steampowered.com/app/123',
    sourceId: 13,
    sourceName: 'Steam',
    trusted: null,
    ...overrides,
  };
}

describe('GameDetailContentComponent rating display', () => {
  beforeEach(() => {
    swiperConstructorMock.mockReset();
    swiperConstructorMock.mockImplementation(() => createSwiperInstance());

    TestBed.configureTestingModule({
      providers: [
        {
          provide: PlatformCustomizationService,
          useValue: {
            getDisplayNameWithoutAlias: vi.fn((name: string) => name),
            getDisplayNameWithAliasSource: vi.fn((name: string) => name),
          },
        },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createComponent(): GameDetailContentComponent {
    return TestBed.runInInjectionContext(() => new GameDetailContentComponent());
  }

  function attachSwiperContainer(component: GameDetailContentComponent): void {
    (
      component as unknown as { swiperContainerRef: { nativeElement: HTMLElement } }
    ).swiperContainerRef = {
      nativeElement: document.createElement('div'),
    };
  }

  function getCreatedSwiper(): SwiperInstanceMock {
    return swiperConstructorMock.mock.results[0]?.value as SwiperInstanceMock;
  }

  it('shows rating label without trailing zeros and edit action when rated', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({ rating: 3 });

    expect(component.ratingLabel).toBe('3');
    expect(component.ratingActionLabel).toBe('EDIT');
  });

  it('shows none/set when no rating is present', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({ rating: null });

    expect(component.ratingLabel).toBe('None');
    expect(component.ratingActionLabel).toBe('SET');
  });

  it('keeps half-step precision while trimming whole-number decimals', () => {
    const component = createComponent();

    expect(component.formatRatingValue(4)).toBe('4');
    expect(component.formatRatingValue(4.5)).toBe('4.5');
  });

  it('shows current price row for wishlist and hides for collection', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({ listType: 'wishlist' });
    expect(component.showCurrentPriceLine).toBe(true);

    component.game = makeLibraryGame({ listType: 'collection' });
    expect(component.showCurrentPriceLine).toBe(false);
  });

  it('shows current price row for discovery detail when explicitly enabled and data exists', () => {
    const component = createComponent();
    component.context = 'explore';
    component.showPriceForNonWishlist = true;
    component.game = {
      ...makeLibraryGame({ listType: 'collection' }),
      listType: undefined,
      priceAmount: 49.9,
      priceCurrency: 'CHF',
    } as unknown as GameEntry;

    expect(component.showCurrentPriceLine).toBe(true);
    expect(component.currentPriceLabel).toContain('49.90');
  });

  it('formats current price and discount metadata', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({
      listType: 'wishlist',
      priceAmount: 19.99,
      priceCurrency: 'CHF',
      priceDiscountPercent: 50,
      priceRegularAmount: 39.99,
    });

    expect(component.currentPriceLabel).toContain('19.99');
    expect(component.currentPriceMetaLabel).toContain('-50%');
    expect(component.currentPriceMetaLabel).toContain('Normal price:');
    expect(component.currentPriceMetaLabel).toContain('39.99');
  });

  it('hides normal price metadata when regular equals current', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({
      listType: 'wishlist',
      priceAmount: 19.99,
      priceCurrency: 'CHF',
      priceRegularAmount: 19.99,
    });

    expect(component.currentPriceMetaLabel).toBeNull();
  });

  it('shows free label for free games', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({
      listType: 'wishlist',
      priceIsFree: true,
      priceAmount: 0,
    });

    expect(component.currentPriceLabel).toBe('Free');
  });

  it('hides website section when no websites are available', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({
      websites: [],
    });

    expect(component.showWebsiteSection).toBe(false);
    expect(component.visibleWebsites).toEqual([]);
  });

  it('shows websites when present', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({
      websites: [
        makeWebsite({
          provider: 'steam',
          providerLabel: 'Steam',
          url: 'https://store.steampowered.com/app/10',
        }),
        makeWebsite({
          provider: 'xbox',
          providerLabel: 'Xbox',
          url: 'https://www.xbox.com/games/store/example',
        }),
      ],
    });

    expect(component.showWebsiteSection).toBe(true);
    expect(component.visibleWebsites).toEqual([
      {
        provider: 'steam',
        providerLabel: 'Steam',
        url: 'https://store.steampowered.com/app/10',
      },
      {
        provider: 'xbox',
        providerLabel: 'Xbox',
        url: 'https://www.xbox.com/games/store/example',
      },
    ]);
  });

  it('sorts websites by provider priority', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({
      websites: [
        makeWebsite({
          provider: 'gog',
          providerLabel: 'GOG',
          url: 'https://www.gog.com/en/game/example',
        }),
        makeWebsite({
          provider: 'epic',
          providerLabel: 'Epic Games Store',
          url: 'https://store.epicgames.com/en-US/p/example',
        }),
        makeWebsite({
          provider: 'steam',
          providerLabel: 'Steam',
          url: 'https://store.steampowered.com/app/10',
        }),
      ],
    });

    expect(component.visibleWebsites).toEqual([
      {
        provider: 'steam',
        providerLabel: 'Steam',
        url: 'https://store.steampowered.com/app/10',
      },
      {
        provider: 'epic',
        providerLabel: 'Epic Games Store',
        url: 'https://store.epicgames.com/en-US/p/example',
      },
      {
        provider: 'gog',
        providerLabel: 'GOG',
        url: 'https://www.gog.com/en/game/example',
      },
    ]);
  });

  it('falls back to default currency formatting when Intl throws for a currency code', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({
      listType: 'wishlist',
      priceAmount: 19.99,
      priceCurrency: 'CHF',
    });

    const RealNumberFormat = Intl.NumberFormat;
    const formatterSpy = vi
      .spyOn(Intl, 'NumberFormat')
      .mockImplementation((...args: ConstructorParameters<typeof Intl.NumberFormat>) => {
        const currency = args[1]?.currency;
        if (currency === 'CHF') {
          throw new RangeError('invalid currency');
        }

        return new RealNumberFormat(...args);
      });

    try {
      expect(component.currentPriceLabel).toContain('19.99');
    } finally {
      formatterSpy.mockRestore();
    }
  });

  it('initializes Swiper after view init and refreshes on game changes', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({
      coverUrl: 'https://img.example/cover.jpg',
    });
    attachSwiperContainer(component);

    const requestAnimationFrameSpy = vi.fn((callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameSpy);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    expect(swiperConstructorMock).not.toHaveBeenCalled();
    component.ngAfterViewInit();

    expect(swiperConstructorMock).toHaveBeenCalledTimes(1);
    const swiper = getCreatedSwiper();
    expect(swiper.allowTouchMove).toBe(false);
    expect(swiper.update).toHaveBeenCalledTimes(1);
    expect(swiper.pagination.render).toHaveBeenCalledTimes(1);
    expect(swiper.pagination.update).toHaveBeenCalledTimes(1);

    component.game = makeLibraryGame({
      coverUrl: 'https://img.example/cover.jpg',
      screenshots: [{ id: 2, imageId: 'shot-2', url: 'https://img.example/shot-2.jpg' }],
    });
    component.ngOnChanges({
      game: {
        currentValue: component.game,
        previousValue: null,
        firstChange: false,
        isFirstChange: () => false,
      },
    });

    expect(swiper.allowTouchMove).toBe(true);
    expect(swiper.update).toHaveBeenCalledTimes(2);
    expect(swiper.pagination.render).toHaveBeenCalledTimes(2);
    expect(swiper.pagination.update).toHaveBeenCalledTimes(2);
  });

  it('destroys swiper and cancels queued refresh on destroy', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({
      coverUrl: 'https://img.example/cover.jpg',
    });
    attachSwiperContainer(component);

    let queuedFrameCallback: FrameRequestCallback | null = null;
    const requestAnimationFrameSpy = vi.fn((callback: FrameRequestCallback): number => {
      queuedFrameCallback = callback;
      return 42;
    });
    const cancelAnimationFrameSpy = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameSpy);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameSpy);

    component.ngAfterViewInit();
    const swiper = getCreatedSwiper();

    component.ngOnDestroy();

    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(42);
    expect(swiper.destroy).toHaveBeenCalledWith(true, true);

    queuedFrameCallback?.(0);
    expect(swiper.update).not.toHaveBeenCalled();
    expect(swiperConstructorMock).toHaveBeenCalledTimes(1);
  });
});
