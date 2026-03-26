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
import type { GameEntry } from '../../core/models/game.models';
import type { SimpleChanges } from '@angular/core';

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

type ResizeObserverMockInstance = {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  callback: ResizeObserverCallback;
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

function attachDetailTextElements(
  component: GameDetailContentComponent,
  summaryElement: HTMLElement,
  storylineElement: HTMLElement
): void {
  (
    component as unknown as {
      summaryTextRef: { nativeElement: HTMLElement };
      storylineTextRef: { nativeElement: HTMLElement };
    }
  ).summaryTextRef = {
    nativeElement: summaryElement,
  };
  (
    component as unknown as {
      summaryTextRef: { nativeElement: HTMLElement };
      storylineTextRef: { nativeElement: HTMLElement };
    }
  ).storylineTextRef = {
    nativeElement: storylineElement,
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
    vi.restoreAllMocks();
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

  function updateGame(
    component: GameDetailContentComponent,
    currentValue: GameEntry,
    previousValue?: GameEntry,
    firstChange = false
  ): void {
    component.game = currentValue;
    component.ngOnChanges({
      game: {
        currentValue,
        previousValue,
        firstChange,
        isFirstChange: () => firstChange,
      },
    } as SimpleChanges);
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

  it('derives detail text toggle availability from summary and storyline length before render', () => {
    const component = createComponent();
    component.context = 'library';

    updateGame(
      component,
      makeLibraryGame({
        summary: 'x'.repeat(261),
        storyline: 'short storyline',
      }),
      undefined,
      true
    );

    expect(component.canToggleDetailText('summary')).toBe(true);
    expect(component.canToggleDetailText('storyline')).toBe(false);
  });

  it('toggles summary and storyline expansion independently when expandable', () => {
    const component = createComponent();
    component.detailTextExpandable.summary = true;
    component.detailTextExpandable.storyline = true;

    expect(component.isDetailTextExpanded('summary')).toBe(false);
    expect(component.isDetailTextExpanded('storyline')).toBe(false);

    component.toggleDetailText('summary');
    expect(component.isDetailTextExpanded('summary')).toBe(true);
    expect(component.isDetailTextExpanded('storyline')).toBe(false);

    component.toggleDetailText('storyline');
    expect(component.isDetailTextExpanded('summary')).toBe(true);
    expect(component.isDetailTextExpanded('storyline')).toBe(true);

    component.toggleDetailText('summary');
    expect(component.isDetailTextExpanded('summary')).toBe(false);
    expect(component.isDetailTextExpanded('storyline')).toBe(true);
  });

  it('does not toggle summary or storyline when the field is not expandable', () => {
    const component = createComponent();

    component.toggleDetailText('summary');
    component.toggleDetailText('storyline');

    expect(component.isDetailTextExpanded('summary')).toBe(false);
    expect(component.isDetailTextExpanded('storyline')).toBe(false);
  });

  it('clears an existing detail text toggle when overflow measurement reports no clipping', () => {
    const component = createComponent();
    component.detailTextExpandable.summary = true;
    component.detailTextExpandable.storyline = true;
    (
      component as unknown as {
        summaryTextRef: { nativeElement: HTMLElement };
        storylineTextRef: { nativeElement: HTMLElement };
        refreshDetailTextExpandableState: () => void;
      }
    ).summaryTextRef = {
      nativeElement: {
        classList: {
          contains: () => true,
          add: vi.fn(),
          remove: vi.fn(),
        },
        clientHeight: 100,
        scrollHeight: 100,
      } as unknown as HTMLElement,
    };
    (
      component as unknown as {
        summaryTextRef: { nativeElement: HTMLElement };
        storylineTextRef: { nativeElement: HTMLElement };
        refreshDetailTextExpandableState: () => void;
      }
    ).storylineTextRef = {
      nativeElement: {
        classList: {
          contains: () => true,
          add: vi.fn(),
          remove: vi.fn(),
        },
        clientHeight: 120,
        scrollHeight: 120,
      } as unknown as HTMLElement,
    };

    (
      component as unknown as {
        refreshDetailTextExpandableState: () => void;
      }
    ).refreshDetailTextExpandableState();

    expect(component.canToggleDetailText('summary')).toBe(false);
    expect(component.canToggleDetailText('storyline')).toBe(false);
  });

  it('measures overflow in collapsed mode so expanded text remains expandable', () => {
    const component = createComponent();
    component.detailTextExpandable.summary = true;
    component.detailTextExpanded.summary = true;
    (
      component as unknown as {
        summaryTextRef: { nativeElement: HTMLElement };
        refreshDetailTextExpandableState: () => void;
      }
    ).summaryTextRef = {
      nativeElement: createDetailTextMeasurementElement(
        {
          clientHeight: 180,
          scrollHeight: 180,
        },
        {
          clientHeight: 90,
          scrollHeight: 150,
        }
      ),
    };

    (
      component as unknown as {
        refreshDetailTextExpandableState: () => void;
      }
    ).refreshDetailTextExpandableState();

    expect(component.canToggleDetailText('summary')).toBe(true);
    expect(component.isDetailTextExpanded('summary')).toBe(true);
  });

  it('resets expanded detail text when the selected game changes', () => {
    const component = createComponent();
    component.context = 'library';

    const previousGame = makeLibraryGame({
      summary: 'x'.repeat(261),
      storyline: 'y'.repeat(261),
    });

    updateGame(component, previousGame, undefined, true);

    component.toggleDetailText('summary');
    component.toggleDetailText('storyline');

    updateGame(
      component,
      makeLibraryGame({
        igdbGameId: '456',
        title: 'Secret of Mana',
        summary: 'a'.repeat(261),
        storyline: 'b'.repeat(261),
      }),
      previousGame
    );

    expect(component.isDetailTextExpanded('summary')).toBe(false);
    expect(component.isDetailTextExpanded('storyline')).toBe(false);
  });

  it('preserves expanded detail text when the same game is refreshed with a new object', () => {
    const component = createComponent();
    component.context = 'library';

    const previousGame = makeLibraryGame({
      summary: 'x'.repeat(261),
      storyline: 'y'.repeat(261),
    });

    updateGame(component, previousGame, undefined, true);

    component.toggleDetailText('summary');

    updateGame(
      component,
      makeLibraryGame({
        igdbGameId: previousGame.igdbGameId,
        platformIgdbId: previousGame.platformIgdbId,
        summary: 'updated '.repeat(40),
        storyline: 'y'.repeat(261),
      }),
      previousGame
    );

    expect(component.isDetailTextExpanded('summary')).toBe(true);
    expect(component.isDetailTextExpanded('storyline')).toBe(false);
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
      screenshots: [
        {
          id: 2,
          imageId: 'shot-2',
          url: 'https://img.example/shot-2.jpg',
          width: 1280,
          height: 720,
        },
      ],
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

  it('re-measures detail text overflow after resize observer notifications', () => {
    const component = createComponent();
    component.context = 'explore';

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

    const requestAnimationFrameSpy = vi.fn((callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameSpy);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const summaryExpandedState = { clientHeight: 100, scrollHeight: 100 };
    const summaryCollapsedState = { clientHeight: 90, scrollHeight: 90 };
    const storylineExpandedState = { clientHeight: 80, scrollHeight: 80 };
    const storylineCollapsedState = { clientHeight: 80, scrollHeight: 80 };

    attachDetailTextElements(
      component,
      createDetailTextMeasurementElement(summaryExpandedState, summaryCollapsedState),
      createDetailTextMeasurementElement(storylineExpandedState, storylineCollapsedState)
    );

    updateGame(
      component,
      makeLibraryGame({
        summary:
          'A moderately long summary that needs layout measurement instead of length checks.',
        storyline: 'Short storyline',
      }),
      undefined,
      true
    );

    component.ngAfterViewInit();

    expect(component.canToggleDetailText('summary')).toBe(false);
    expect(resizeObservers).toHaveLength(1);

    summaryCollapsedState.scrollHeight = 160;
    resizeObservers[0]?.callback([], {} as ResizeObserver);

    expect(component.canToggleDetailText('summary')).toBe(true);
    expect(component.canToggleDetailText('storyline')).toBe(false);
    expect(requestAnimationFrameSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('builds media slides without separate backdrop metadata', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({
      coverUrl: 'https://img.example/cover.jpg',
      screenshots: [
        { id: 2, imageId: 'shot-2', url: 'https://img.example/shot-2.jpg' },
        { id: 3, imageId: 'shot-3', url: 'https://img.example/shot-3.jpg' },
      ],
    });

    expect(component.mediaSlides).toEqual([
      {
        key: 'cover:https://img.example/cover.jpg',
        src: 'https://img.example/cover.jpg',
        kind: 'cover',
      },
      {
        key: 'screenshot:2',
        src: 'https://img.example/shot-2.jpg',
        kind: 'screenshot',
      },
      {
        key: 'screenshot:3',
        src: 'https://img.example/shot-3.jpg',
        kind: 'screenshot',
      },
    ]);
  });

  it('reuses cached media slides, tag items, display title, and formatted dates while the selected game is unchanged', () => {
    const component = createComponent();
    const game = makeLibraryGame({
      customTitle: 'Custom title',
      releaseDate: '2024-02-03T00:00:00.000Z',
      coverUrl: 'https://img.example/cover.jpg',
      screenshots: [{ id: 2, imageId: 'shot-2', url: 'https://img.example/shot-2.jpg' }],
      tags: [{ id: 1, name: 'RPG', color: '#123456' }],
    });
    const parseSpy = vi.spyOn(Date, 'parse');
    const toLocaleDateStringSpy = vi.spyOn(Date.prototype, 'toLocaleDateString');

    component.context = 'library';
    component.game = game;

    const firstDisplayTitle = component.displayTitle;
    const firstMediaSlides = component.mediaSlides;
    const secondMediaSlides = component.mediaSlides;
    const firstTagItems = component.tagItems;
    const secondTagItems = component.tagItems;
    const firstFormattedDate = component.formatDate(component.game.releaseDate);
    const secondFormattedDate = component.formatDate(component.game.releaseDate);
    game.customTitle = 'Changed title';
    const secondDisplayTitle = component.displayTitle;

    expect(firstDisplayTitle).toBe('Custom title');
    expect(secondDisplayTitle).toBe(firstDisplayTitle);
    expect(secondMediaSlides).toBe(firstMediaSlides);
    expect(secondTagItems).toBe(firstTagItems);
    expect(secondFormattedDate).toBe(firstFormattedDate);
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(toLocaleDateStringSpy).toHaveBeenCalledTimes(1);
  });

  it('preloads the active and next slides while gating later slides', () => {
    const component = createComponent();
    component.context = 'library';
    const game = makeLibraryGame({
      coverUrl: 'https://img.example/cover.jpg',
      screenshots: [
        { id: 2, imageId: 'shot-2', url: 'https://img.example/shot-2.jpg' },
        { id: 3, imageId: 'shot-3', url: 'https://img.example/shot-3.jpg' },
        { id: 4, imageId: 'shot-4', url: 'https://img.example/shot-4.jpg' },
      ],
    });
    updateGame(component, game, undefined, true);

    const slides = component.mediaSlides;
    const [coverSlide, firstScreenshotSlide, secondScreenshotSlide, thirdScreenshotSlide] = slides;
    expect(slides).toHaveLength(4);

    expect(component.shouldLoadMediaSlide(coverSlide)).toBe(true);
    expect(component.getMediaSlideSrc(coverSlide)).toBe('https://img.example/cover.jpg');
    expect(component.shouldLoadMediaSlide(firstScreenshotSlide)).toBe(true);
    expect(component.getMediaSlideSrc(firstScreenshotSlide)).toBe('https://img.example/shot-2.jpg');
    expect(component.shouldLoadMediaSlide(secondScreenshotSlide)).toBe(false);
    expect(component.getMediaSlideSrc(secondScreenshotSlide)).toBeNull();
    expect(component.shouldLoadMediaSlide(thirdScreenshotSlide)).toBe(false);
    expect(component.getMediaSlideSrc(thirdScreenshotSlide)).toBeNull();
  });

  it('keeps placeholder slides loadable when no media exists', () => {
    const component = createComponent();
    component.context = 'library';
    updateGame(component, makeLibraryGame(), undefined, true);

    const [placeholderSlide] = component.mediaSlides;

    expect(component.shouldLoadMediaSlide(placeholderSlide)).toBe(true);
    expect(component.getMediaSlideSrc(placeholderSlide)).toBe('');
  });

  it('prefetches only the next slide outside the loadable window', () => {
    const component = createComponent();
    component.context = 'library';
    const prefetchedUrls: string[] = [];

    vi.stubGlobal(
      'Image',
      class ImageMock {
        decoding = '';

        set src(value: string) {
          prefetchedUrls.push(value);
        }
      }
    );

    updateGame(
      component,
      makeLibraryGame({
        coverUrl: 'https://img.example/cover.jpg',
        screenshots: [
          { id: 2, imageId: 'shot-2', url: 'https://img.example/shot-2.jpg' },
          { id: 3, imageId: 'shot-3', url: 'https://img.example/shot-3.jpg' },
          { id: 4, imageId: 'shot-4', url: 'https://img.example/shot-4.jpg' },
        ],
      }),
      undefined,
      true
    );

    expect(prefetchedUrls).toEqual(['https://img.example/shot-3.jpg']);
  });

  it('skips prefetch for data and blob slide urls', () => {
    const component = createComponent();
    component.context = 'library';
    const prefetchedUrls: string[] = [];

    vi.stubGlobal(
      'Image',
      class ImageMock {
        decoding = '';

        set src(value: string) {
          prefetchedUrls.push(value);
        }
      }
    );

    updateGame(
      component,
      makeLibraryGame({
        coverUrl: 'https://img.example/cover.jpg',
        screenshots: [
          { id: 2, imageId: 'shot-2', url: 'data:image/png;base64,AAA' },
          { id: 3, imageId: 'shot-3', url: 'blob:https://example.com/shot-3' },
        ],
      }),
      undefined,
      true
    );

    expect(prefetchedUrls).toEqual([]);
  });

  it('destroys swiper and cancels queued refresh on destroy', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({
      coverUrl: 'https://img.example/cover.jpg',
    });
    attachSwiperContainer(component);

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
    attachDetailTextElements(
      component,
      createDetailTextMeasurementElement(
        { clientHeight: 100, scrollHeight: 100 },
        { clientHeight: 90, scrollHeight: 90 }
      ),
      createDetailTextMeasurementElement(
        { clientHeight: 100, scrollHeight: 100 },
        { clientHeight: 90, scrollHeight: 90 }
      )
    );

    const requestAnimationFrameSpy = vi.fn((_callback: FrameRequestCallback): number => {
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
    expect(resizeObservers[0]?.disconnect).toHaveBeenCalledOnce();

    const queuedCallback = requestAnimationFrameSpy.mock.calls[0]?.[0] as
      | FrameRequestCallback
      | undefined;
    queuedCallback?.(0);
    expect(swiper.update).not.toHaveBeenCalled();
    expect(swiperConstructorMock).toHaveBeenCalledTimes(1);
  });
});
