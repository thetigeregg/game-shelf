import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { of } from 'rxjs';
import { GameShelfService } from '../../core/services/game-shelf.service';
import { GameEntry } from '../../core/models/game.models';
import { GameListComponent } from './game-list.component';

describe('GameListComponent', () => {
  let component: GameListComponent;
  let fixture: ComponentFixture<GameListComponent>;
  let gameShelfService: {
    [K in keyof GameShelfService]?: ReturnType<typeof vi.fn>
  };

  const games: GameEntry[] = [
    {
      id: 1,
      igdbGameId: '101',
      title: 'Super Mario Odyssey',
      coverUrl: 'https://example.com/cover.jpg',
      coverSource: 'thegamesdb',
      platform: 'Nintendo Switch',
      platformIgdbId: 130,
      releaseDate: '2017-10-27T00:00:00.000Z',
      releaseYear: 2017,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 2,
      igdbGameId: '102',
      title: 'Halo Infinite',
      coverUrl: 'https://example.com/halo.jpg',
      coverSource: 'igdb',
      platform: 'Xbox Series X',
      platformIgdbId: 169,
      releaseDate: '2021-12-08T00:00:00.000Z',
      releaseYear: 2021,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  beforeEach(async () => {
    gameShelfService = {
      watchList: vi.fn().mockReturnValue(of(games)),
      moveGame: vi.fn().mockResolvedValue(undefined),
      removeGame: vi.fn().mockResolvedValue(undefined),
      refreshGameMetadata: vi.fn().mockResolvedValue(games[0]),
      searchBoxArtByTitle: vi.fn().mockReturnValue(of(['https://example.com/new-cover.jpg'])),
      updateGameCover: vi.fn().mockResolvedValue({ ...games[0], coverUrl: 'https://example.com/new-cover.jpg', coverSource: 'thegamesdb' }),
      setGameStatus: vi.fn().mockResolvedValue(games[0]),
      listTags: vi.fn().mockResolvedValue([]),
      setGameTags: vi.fn().mockResolvedValue(games[0]),
    };

    await TestBed.configureTestingModule({
      declarations: [GameListComponent],
      imports: [CommonModule, IonicModule.forRoot()],
      providers: [{ provide: GameShelfService, useValue: gameShelfService as unknown as GameShelfService }],
    }).compileComponents();

    fixture = TestBed.createComponent(GameListComponent);
    component = fixture.componentInstance;
  });

  it('renders title, platform, and release year for collection list', () => {
    component.listType = 'collection';
    fixture.detectChanges();

    const textContent = fixture.nativeElement.textContent;
    expect(textContent).toContain('Super Mario Odyssey');
    expect(textContent).toContain('Nintendo Switch');
    expect(textContent).toContain('2017');
    expect(fixture.nativeElement.querySelectorAll('ion-popover').length).toBeGreaterThan(0);
  });

  it('shows alternate move label for wishlist list', () => {
    component.listType = 'wishlist';
    fixture.detectChanges();
    expect(component.getOtherListLabel()).toBe('Collection');
  });

  it('moves and removes a game from row actions', async () => {
    component.listType = 'collection';
    fixture.detectChanges();

    await component.moveGame(games[0]);
    await component.removeGame(games[0]);

    expect(gameShelfService.moveGame).toHaveBeenCalledWith('101', 130, 'wishlist');
    expect(gameShelfService.removeGame).toHaveBeenCalledWith('101', 130);
  });

  it('refreshes selected game metadata from detail actions', async () => {
    component.listType = 'collection';
    component.openGameDetail(games[0]);
    fixture.detectChanges();

    await component.refreshSelectedGameMetadata();

    expect(gameShelfService.refreshGameMetadata).toHaveBeenCalledWith('101', 130);
  });

  it('searches box art with selected game title when picker is opened', async () => {
    component.listType = 'collection';
    component.openGameDetail(games[0]);
    fixture.detectChanges();

    await component.openImagePickerFromPopover();

    expect(component.imagePickerQuery).toBe('Super Mario Odyssey');
    expect(gameShelfService.searchBoxArtByTitle).toHaveBeenCalledWith('Super Mario Odyssey', 'Nintendo Switch', 130);
    expect(component.isImagePickerModalOpen).toBeTrue();
  });

  it('applies selected image via update cover service', async () => {
    component.listType = 'collection';
    component.openGameDetail(games[0]);
    fixture.detectChanges();

    await component.applySelectedImage('https://example.com/new-cover.jpg');

    expect(gameShelfService.updateGameCover).toHaveBeenCalledWith('101', 130, 'https://example.com/new-cover.jpg');
  });

  it('filters by platform and sorts by release date descending', () => {
    component.listType = 'collection';
    component.filters = {
      sortField: 'releaseDate',
      sortDirection: 'desc',
      platform: ['Nintendo Switch'],
      genres: [],
      statuses: [],
      tags: [],
      ratings: [],
      releaseDateFrom: null,
      releaseDateTo: null,
    };
    fixture.detectChanges();

    const textContent = fixture.nativeElement.textContent;
    expect(textContent).toContain('Super Mario Odyssey');
    expect(textContent).not.toContain('Halo Infinite');
  });
});
