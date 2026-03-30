import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { GameEntry } from '../../core/models/game.models';
import { PlatformCustomizationService } from '../../core/services/platform-customization.service';
import { GameDetailContentComponent } from './game-detail-content.component';
import { canOpenMetadataFilter } from './game-detail-metadata.utils';

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
  default: vi.fn(),
}));

vi.mock('swiper/modules', () => ({
  Pagination: {},
  Zoom: {},
}));

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

describe('game detail metadata interactions', () => {
  beforeEach(() => {
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

  function createComponent(): GameDetailContentComponent {
    return TestBed.runInInjectionContext(() => new GameDetailContentComponent());
  }

  it('opens genre metadata filter in library context when genres are present', () => {
    expect(canOpenMetadataFilter(true, true, [' Action '])).toBe(true);
  });

  it('does not open genre metadata filter when genre metadata is missing', () => {
    expect(canOpenMetadataFilter(true, true, [' ', ''])).toBe(false);
  });

  it('enables metadata links only when library sections are shown and links are allowed', () => {
    const component = createComponent();

    component.context = 'library';
    component.allowMetadataFilterLinks = true;
    expect(component.shouldEnableMetadataFilterLinks).toBe(true);

    component.allowMetadataFilterLinks = false;
    expect(component.shouldEnableMetadataFilterLinks).toBe(false);

    component.context = 'explore';
    component.allowMetadataFilterLinks = true;
    expect(component.shouldEnableMetadataFilterLinks).toBe(false);
  });

  it('does not emit metadata click events when links are disabled', () => {
    const component = createComponent();
    component.context = 'library';
    component.allowMetadataFilterLinks = false;
    component.game = makeLibraryGame({ genres: ['RPG'] });
    const emitSpy = vi.spyOn(component.genreClick, 'emit');

    component.onGenreClick();

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('emits metadata click events when links are enabled and metadata is present', () => {
    const component = createComponent();
    component.context = 'library';
    component.allowMetadataFilterLinks = true;
    component.game = makeLibraryGame({ developers: ['Square'] });
    const emitSpy = vi.spyOn(component.developerClick, 'emit');

    component.onDeveloperClick();

    expect(emitSpy).toHaveBeenCalledOnce();
  });
});
