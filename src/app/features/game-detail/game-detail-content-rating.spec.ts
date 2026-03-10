import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

vi.mock('ionicons', () => ({
  addIcons: vi.fn()
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
  IonSelect: {},
  IonSelectOption: {},
  IonIcon: {}
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
  trophy: {}
}));

import { GameDetailContentComponent } from './game-detail-content.component';
import { PlatformCustomizationService } from '../../core/services/platform-customization.service';
import type { GameEntry } from '../../core/models/game.models';

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

describe('GameDetailContentComponent rating display', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PlatformCustomizationService,
          useValue: {
            getDisplayNameWithoutAlias: vi.fn((name: string) => name)
          }
        }
      ]
    });
  });

  function createComponent(): GameDetailContentComponent {
    return TestBed.runInInjectionContext(() => new GameDetailContentComponent());
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

  it('shows current price row only for wishlist entries', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({ listType: 'wishlist' });
    expect(component.showCurrentPriceLine).toBe(true);

    component.game = makeLibraryGame({ listType: 'collection' });
    expect(component.showCurrentPriceLine).toBe(false);
  });

  it('formats current price and discount metadata', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({
      listType: 'wishlist',
      priceAmount: 19.99,
      priceCurrency: 'CHF',
      priceDiscountPercent: 50,
      priceRegularAmount: 39.99
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
      priceRegularAmount: 19.99
    });

    expect(component.currentPriceMetaLabel).toBeNull();
  });

  it('shows free label for free games', () => {
    const component = createComponent();
    component.context = 'library';
    component.game = makeLibraryGame({
      listType: 'wishlist',
      priceIsFree: true,
      priceAmount: 0
    });

    expect(component.currentPriceLabel).toBe('Free');
  });
});
