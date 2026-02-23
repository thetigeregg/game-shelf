import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GAME_LIST_FILTERS,
  GameListFilters,
  GameListView,
  ListType
} from '../core/models/game.models';
import { GameShelfService } from '../core/services/game-shelf.service';
import { parseListPagePreferences, serializeListPagePreferences } from './list-page-preferences';

vi.mock('@ionic/angular/standalone', () => {
  class Stub {}

  return {
    MenuController: class MenuController {},
    PopoverController: class PopoverController {},
    ToastController: class ToastController {},
    IonHeader: Stub,
    IonToolbar: Stub,
    IonButtons: Stub,
    IonButton: Stub,
    IonIcon: Stub,
    IonTitle: Stub,
    IonSearchbar: Stub,
    IonContent: Stub,
    IonPopover: Stub,
    IonList: Stub,
    IonItem: Stub,
    IonModal: Stub,
    IonBadge: Stub,
    IonLoading: Stub,
    IonFab: Stub,
    IonFabButton: Stub,
    IonFabList: Stub
  };
});

vi.mock('../features/game-list/game-list.component', () => ({
  GameListComponent: class GameListComponent {}
}));

vi.mock('../features/game-search/game-search.component', () => ({
  GameSearchComponent: class GameSearchComponent {}
}));

vi.mock('../features/game-filters-menu/game-filters-menu.component', () => ({
  GameFiltersMenuComponent: class GameFiltersMenuComponent {}
}));

type RouteStub = {
  snapshot: { data: { listType: ListType } };
  queryParamMap: Observable<ParamMap>;
};

type RouterStub = {
  navigate: ReturnType<typeof vi.fn>;
  navigateByUrl: ReturnType<typeof vi.fn>;
};

type GameShelfServiceStub = {
  watchList: ReturnType<typeof vi.fn>;
  getView: ReturnType<typeof vi.fn>;
};

type ListPageComponentClass = new () => {
  filters: GameListFilters;
  groupBy: string;
  noneTagFilterValue: string;
  onFiltersChange(filters: GameListFilters): void;
  onGroupByChange(value: string | null | undefined): void;
};

const COLLECTION_PREFERENCE_STORAGE_KEY = 'game-shelf:preferences:collection';

let ListPageComponentCtor: ListPageComponentClass;
let MenuControllerToken: unknown;
let PopoverControllerToken: unknown;
let ToastControllerToken: unknown;

describe('ListPageComponent persistence', () => {
  beforeAll(async () => {
    const ionic = await import('@ionic/angular/standalone');
    MenuControllerToken = ionic.MenuController;
    PopoverControllerToken = ionic.PopoverController;
    ToastControllerToken = ionic.ToastController;

    const listPage = await import('./list-page.component');
    ListPageComponentCtor = listPage.ListPageComponent as unknown as ListPageComponentClass;
  });

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('restores full saved sort/group/filter preferences on app load', async () => {
    const savedFilters: GameListFilters = {
      ...DEFAULT_GAME_LIST_FILTERS,
      sortField: 'releaseDate',
      sortDirection: 'desc',
      platform: ['Nintendo Switch'],
      tags: ['__none__', 'Backlog'],
      ratings: [5]
    };

    localStorage.setItem(
      COLLECTION_PREFERENCE_STORAGE_KEY,
      serializeListPagePreferences({
        filters: savedFilters,
        groupBy: 'publisher'
      })
    );

    const { component } = await setup();

    expect(component.filters).toEqual(savedFilters);
    expect(component.groupBy).toBe('publisher');
  });

  it('preserves sorting/grouping/filtering after app close and relaunch', async () => {
    const { component } = await setup();

    component.onFiltersChange({
      ...DEFAULT_GAME_LIST_FILTERS,
      sortField: 'platform',
      sortDirection: 'desc',
      platform: [' NES ', 'NES'],
      collections: ['Favorites'],
      tags: ['Action', '__none__', 'Action']
    });
    component.onGroupByChange('genre');

    const { component: relaunchedComponent } = await setup();

    expect(relaunchedComponent.filters.sortField).toBe('platform');
    expect(relaunchedComponent.filters.sortDirection).toBe('desc');
    expect(relaunchedComponent.filters.platform).toEqual(['NES']);
    expect(relaunchedComponent.filters.collections).toEqual(['Favorites']);
    expect(relaunchedComponent.filters.tags).toEqual(['__none__', 'Action']);
    expect(relaunchedComponent.groupBy).toBe('genre');
  });

  it('applies saved view from query param and keeps it after next launch', async () => {
    const viewFilters: GameListFilters = {
      ...DEFAULT_GAME_LIST_FILTERS,
      sortField: 'createdAt',
      sortDirection: 'desc',
      developers: ['Nintendo'],
      statuses: ['playing'],
      tags: ['Retro']
    };
    const view: GameListView = {
      id: 12,
      name: 'In Progress Nintendo',
      listType: 'collection',
      filters: viewFilters,
      groupBy: 'developer',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const { component, gameShelfService, router } = await setup({
      queryParams: { applyView: '12' },
      viewById: view
    });

    await flushAsync();

    expect(gameShelfService.getView).toHaveBeenCalledWith(12);
    expect(component.filters).toEqual(viewFilters);
    expect(component.groupBy).toBe('developer');
    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: { applyView: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });

    const stored = parseListPagePreferences(
      localStorage.getItem(COLLECTION_PREFERENCE_STORAGE_KEY),
      '__none__'
    );
    expect(stored).not.toBeNull();
    expect(stored?.filters).toEqual(viewFilters);
    expect(stored?.groupBy).toBe('developer');

    const { component: relaunchedComponent } = await setup();
    expect(relaunchedComponent.filters).toEqual(viewFilters);
    expect(relaunchedComponent.groupBy).toBe('developer');
  });
});

async function setup(options?: {
  listType?: ListType;
  queryParams?: Record<string, string>;
  viewById?: GameListView;
}): Promise<{
  component: InstanceType<ListPageComponentClass>;
  queryParamMap$: BehaviorSubject<ParamMap>;
  router: RouterStub;
  gameShelfService: GameShelfServiceStub;
}> {
  const queryParamMap$ = new BehaviorSubject<ParamMap>(
    convertToParamMap(options?.queryParams ?? {})
  );
  const routeStub: RouteStub = {
    snapshot: {
      data: {
        listType: options?.listType ?? 'collection'
      }
    },
    queryParamMap: queryParamMap$.asObservable()
  };
  const router: RouterStub = {
    navigate: vi.fn(async () => true),
    navigateByUrl: vi.fn(async () => true)
  };
  const gameShelfService: GameShelfServiceStub = {
    watchList: vi.fn(() => of([])),
    getView: vi.fn(async (viewId: number) => {
      if (options?.viewById?.id === viewId) {
        return options.viewById;
      }

      return undefined;
    })
  };

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    providers: [
      { provide: ActivatedRoute, useValue: routeStub },
      { provide: Router, useValue: router },
      { provide: GameShelfService, useValue: gameShelfService },
      { provide: MenuControllerToken, useValue: { open: vi.fn(async () => true) } },
      { provide: PopoverControllerToken, useValue: { dismiss: vi.fn(async () => true) } },
      {
        provide: ToastControllerToken,
        useValue: {
          create: vi.fn(async () => ({
            present: vi.fn(async () => undefined)
          }))
        }
      }
    ]
  }).compileComponents();

  const component = TestBed.runInInjectionContext(
    () => new ListPageComponentCtor()
  ) as InstanceType<ListPageComponentClass>;

  return {
    component,
    queryParamMap$,
    router,
    gameShelfService
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
