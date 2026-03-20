import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ionic/angular/standalone', () => {
  const Dummy = () => null;
  const AlertControllerToken = function AlertController() {
    return undefined;
  };
  const MenuControllerToken = function MenuController() {
    return undefined;
  };
  const PopoverControllerToken = function PopoverController() {
    return undefined;
  };
  const ToastControllerToken = function ToastController() {
    return undefined;
  };

  return {
    AlertController: AlertControllerToken,
    MenuController: MenuControllerToken,
    PopoverController: PopoverControllerToken,
    ToastController: ToastControllerToken,
    IonHeader: Dummy,
    IonToolbar: Dummy,
    IonButtons: Dummy,
    IonButton: Dummy,
    IonIcon: Dummy,
    IonTitle: Dummy,
    IonSearchbar: Dummy,
    IonContent: Dummy,
    IonPopover: Dummy,
    IonList: Dummy,
    IonItem: Dummy,
    IonModal: Dummy,
    IonBadge: Dummy,
    IonLoading: Dummy,
    IonFab: Dummy,
    IonFabButton: Dummy,
    IonFabList: Dummy,
    IonSplitPane: Dummy,
    IonText: Dummy,
  };
});
vi.mock('../features/game-list/game-list.component', () => ({
  GameListComponent: () => null,
}));
vi.mock('../features/game-search/game-search.component', () => ({
  GameSearchComponent: () => null,
}));
vi.mock('../features/game-filters-menu/game-filters-menu.component', () => ({
  GameFiltersMenuComponent: () => null,
}));
vi.mock('../features/game-detail/game-detail-content.component', () => ({
  GameDetailContentComponent: () => null,
}));
vi.mock('../features/game-detail/detail-shortcuts-fab.component', () => ({
  DetailShortcutsFabComponent: () => null,
}));
vi.mock('../features/game-detail/detail-videos-modal.component', () => ({
  DetailVideosModalComponent: () => null,
}));

import { ListPageComponent } from './list-page.component';
import { IgdbProxyService } from '../core/api/igdb-proxy.service';
import { GameShelfService } from '../core/services/game-shelf.service';
import { LayoutModeService } from '../core/services/layout-mode.service';
import { AddToLibraryWorkflowService } from '../features/game-search/add-to-library-workflow.service';
import type { GameCatalogResult } from '../core/models/game.models';
import {
  AlertController,
  MenuController,
  PopoverController,
  ToastController,
} from '@ionic/angular/standalone';

describe('ListPageComponent', () => {
  const gameShelfServiceMock = {
    watchList: vi.fn(() => of([])),
    findGameByIdentity: vi.fn(),
    getView: vi.fn(),
  };
  const igdbProxyServiceMock = {
    getGameById: vi.fn(),
  };
  const layoutModeServiceMock = {
    mode$: of<'mobile' | 'desktop'>('mobile'),
  };
  const routerMock = {
    navigate: vi.fn().mockResolvedValue(true),
  };
  const routeMock = {
    snapshot: { data: { listType: 'collection' } },
    queryParamMap: of(convertToParamMap({})),
  };
  const addToLibraryWorkflowMock = {
    addToLibrary: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    gameShelfServiceMock.watchList.mockReturnValue(of([]));
    gameShelfServiceMock.findGameByIdentity.mockResolvedValue(null);
    gameShelfServiceMock.getView.mockResolvedValue(null);
    igdbProxyServiceMock.getGameById.mockReturnValue(of(null));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: GameShelfService, useValue: gameShelfServiceMock },
        { provide: IgdbProxyService, useValue: igdbProxyServiceMock },
        { provide: LayoutModeService, useValue: layoutModeServiceMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: routeMock },
        { provide: AddToLibraryWorkflowService, useValue: addToLibraryWorkflowMock },
        { provide: AlertController, useValue: { create: vi.fn() } },
        { provide: MenuController, useValue: { open: vi.fn() } },
        { provide: PopoverController, useValue: { dismiss: vi.fn().mockResolvedValue(undefined) } },
        { provide: ToastController, useValue: { create: vi.fn() } },
      ],
    });
  });

  function createComponent(): ListPageComponent {
    return TestBed.runInInjectionContext(() => new ListPageComponent());
  }

  function makeResult(overrides: Partial<GameCatalogResult> = {}): GameCatalogResult {
    return {
      igdbGameId: '100',
      title: 'Metroid Prime',
      coverUrl: null,
      coverSource: 'igdb',
      platforms: ['GameCube'],
      platformOptions: [{ id: 21, name: 'GameCube' }],
      platform: 'GameCube',
      platformIgdbId: 21,
      releaseDate: '2002-11-17T00:00:00.000Z',
      releaseYear: 2002,
      ...overrides,
    };
  }

  async function flushAsync(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('clears loading immediately when detail hydration fails before identity lookup resolves', async () => {
    const component = createComponent();
    const result = makeResult();
    let resolveExistingEntry: (value: { id: number } | null) => void = () => undefined;
    const existingEntryPromise = new Promise<{ id: number } | null>((resolve) => {
      resolveExistingEntry = resolve;
    });

    gameShelfServiceMock.findGameByIdentity.mockReturnValueOnce(existingEntryPromise);
    igdbProxyServiceMock.getGameById.mockReturnValueOnce(throwError(() => new Error('boom')));

    await component.openAddGameDetail(result);

    expect(component.isAddGameDetailLoading).toBe(false);
    expect(component.addGameDetailErrorMessage).toBe('boom');
    expect(component.isAddGameDetailInLibrary).toBe(false);

    resolveExistingEntry({ id: 42 });
    await flushAsync();

    expect(component.isAddGameDetailLoading).toBe(false);
    expect(component.isAddGameDetailInLibrary).toBe(true);
  });
});
