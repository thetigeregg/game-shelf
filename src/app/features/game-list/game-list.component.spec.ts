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
  let gameShelfService: jasmine.SpyObj<GameShelfService>;

  const games: GameEntry[] = [
    {
      id: 1,
      externalId: '101',
      title: 'Super Mario Odyssey',
      coverUrl: 'https://example.com/cover.jpg',
      platform: 'Nintendo Switch',
      releaseDate: '2017-10-27T00:00:00.000Z',
      releaseYear: 2017,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 2,
      externalId: '102',
      title: 'Halo Infinite',
      coverUrl: 'https://example.com/halo.jpg',
      platform: 'Xbox Series X',
      releaseDate: '2021-12-08T00:00:00.000Z',
      releaseYear: 2021,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  beforeEach(async () => {
    gameShelfService = jasmine.createSpyObj<GameShelfService>('GameShelfService', [
      'watchList',
      'moveGame',
      'removeGame',
    ]);

    gameShelfService.watchList.and.returnValue(of(games));
    gameShelfService.moveGame.and.resolveTo();
    gameShelfService.removeGame.and.resolveTo();

    await TestBed.configureTestingModule({
      declarations: [GameListComponent],
      imports: [CommonModule, IonicModule.forRoot()],
      providers: [{ provide: GameShelfService, useValue: gameShelfService }],
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

    expect(gameShelfService.moveGame).toHaveBeenCalledWith('101', 'wishlist');
    expect(gameShelfService.removeGame).toHaveBeenCalledWith('101');
  });

  it('filters by platform and sorts by release date descending', () => {
    component.listType = 'collection';
    component.filters = {
      sortField: 'releaseDate',
      sortDirection: 'desc',
      platform: 'Nintendo Switch',
      releaseDateFrom: null,
      releaseDateTo: null,
    };
    fixture.detectChanges();

    const textContent = fixture.nativeElement.textContent;
    expect(textContent).toContain('Super Mario Odyssey');
    expect(textContent).not.toContain('Halo Infinite');
  });
});
