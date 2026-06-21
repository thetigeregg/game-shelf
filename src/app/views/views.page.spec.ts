import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ionic/angular/standalone', () => {
  const AlertControllerToken = function AlertController() {
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
    PopoverController: PopoverControllerToken,
    ToastController: ToastControllerToken,
    IonHeader: {},
    IonToolbar: {},
    IonButtons: {},
    IonBackButton: {},
    IonTitle: {},
    IonContent: {},
    IonList: {},
    IonItem: {},
    IonLabel: {},
    IonButton: {},
    IonIcon: {},
    IonFab: {},
    IonFabButton: {},
    IonPopover: {},
    IonModal: {},
    IonInput: {},
    IonNote: {},
  };
});

vi.mock('ionicons', () => ({
  addIcons: vi.fn(),
}));

vi.mock('ionicons/icons', () => ({
  ellipsisVertical: {},
  add: {},
}));

import { AlertController, PopoverController, ToastController } from '@ionic/angular/standalone';
import { ViewsPage } from './views.page';
import { GameShelfService } from '../core/services/game-shelf.service';
import { DebugLogService } from '../core/services/debug-log.service';
import { ViewsContextService } from './views-context.service';
import { DEFAULT_GAME_LIST_FILTERS, GameListView } from '../core/models/game.models';

function makeView(overrides: Partial<GameListView> = {}): GameListView {
  return {
    id: 1,
    name: 'Recent',
    listType: 'collection',
    filters: { ...DEFAULT_GAME_LIST_FILTERS },
    groupBy: 'none',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ViewsPage', () => {
  let component: ViewsPage;
  let gameShelfServiceMock: { watchViews: ReturnType<typeof vi.fn> };
  let viewsContextServiceMock: { consume: ReturnType<typeof vi.fn> };
  let debugLogServiceMock: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    trace: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    gameShelfServiceMock = {
      watchViews: vi.fn().mockReturnValue(of([] as GameListView[])),
    };
    viewsContextServiceMock = {
      consume: vi.fn().mockReturnValue({
        context: {
          listType: 'collection',
          filters: { ...DEFAULT_GAME_LIST_FILTERS },
          groupBy: 'none',
        },
        hasContext: false,
      }),
    };
    debugLogServiceMock = {
      info: vi.fn(),
      warn: vi.fn(),
      trace: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: GameShelfService, useValue: gameShelfServiceMock },
        { provide: ViewsContextService, useValue: viewsContextServiceMock },
        { provide: DebugLogService, useValue: debugLogServiceMock },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        { provide: AlertController, useValue: { create: vi.fn() } },
        { provide: PopoverController, useValue: { dismiss: vi.fn() } },
        { provide: ToastController, useValue: { create: vi.fn() } },
      ],
    });

    component = TestBed.runInInjectionContext(() => new ViewsPage());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getViewSummary', () => {
    it('formats sort and group labels for a well-formed view', () => {
      const view = makeView({
        filters: { ...DEFAULT_GAME_LIST_FILTERS, sortField: 'createdAt', sortDirection: 'desc' },
        groupBy: 'platform',
      });

      const summary = component.getViewSummary(view);

      expect(summary).toBe('Date added ↓ • Group: Platform');
      expect(debugLogServiceMock.warn).not.toHaveBeenCalled();
    });

    it('falls back to defaults without side effects when filters are missing', () => {
      const malformed = makeView({ id: 7, name: 'Broken' });
      delete (malformed as Partial<GameListView>).filters;

      const summary = component.getViewSummary(malformed);

      expect(summary).toBe('Game title ↑ • Group: None');
      // getViewSummary runs during change detection, so it must stay
      // side-effect free — warnings are emitted from the views$ pipeline.
      expect(debugLogServiceMock.warn).not.toHaveBeenCalled();
    });

    it('normalizes a missing groupBy to none without side effects', () => {
      const malformed = makeView();
      delete (malformed as Partial<GameListView>).groupBy;

      const summary = component.getViewSummary(malformed);

      expect(summary).toContain('Group: None');
      expect(debugLogServiceMock.warn).not.toHaveBeenCalled();
    });
  });

  describe('ngOnInit', () => {
    it('logs a diagnostic checkpoint on each views emission', () => {
      const views = [makeView()];
      gameShelfServiceMock.watchViews.mockReturnValue(of(views));

      component.ngOnInit();
      component.views$.subscribe();

      expect(debugLogServiceMock.info).toHaveBeenCalledWith('views.page.views_emit', {
        count: 1,
      });
    });

    it('warns once per emission for each malformed view', () => {
      const malformedFilters = makeView({ id: 7, name: 'Broken' });
      delete (malformedFilters as Partial<GameListView>).filters;
      const malformedGroupBy = makeView({ id: 8, name: 'AlsoBroken' });
      delete (malformedGroupBy as Partial<GameListView>).groupBy;
      gameShelfServiceMock.watchViews.mockReturnValue(
        of([makeView(), malformedFilters, malformedGroupBy])
      );

      component.ngOnInit();
      // ngOnInit flushes its start/end checkpoints, so reset the mock to assert
      // the conditional flush in the views$ tap actually fires for malformed rows.
      debugLogServiceMock.flush.mockClear();
      component.views$.subscribe();

      expect(debugLogServiceMock.warn).toHaveBeenCalledTimes(2);
      expect(debugLogServiceMock.warn).toHaveBeenCalledWith(
        'views.page.view_malformed',
        expect.objectContaining({ id: 7, name: 'Broken', hasFilters: false, hasGroupBy: true })
      );
      expect(debugLogServiceMock.warn).toHaveBeenCalledWith(
        'views.page.view_malformed',
        expect.objectContaining({ id: 8, name: 'AlsoBroken', hasFilters: true, hasGroupBy: false })
      );
      expect(debugLogServiceMock.flush).toHaveBeenCalled();
    });

    it('does not warn when all emitted views are well-formed', () => {
      gameShelfServiceMock.watchViews.mockReturnValue(of([makeView(), makeView({ id: 2 })]));

      component.ngOnInit();
      component.views$.subscribe();

      expect(debugLogServiceMock.warn).not.toHaveBeenCalled();
    });

    it('records start and end diagnostic checkpoints', () => {
      component.ngOnInit();

      expect(debugLogServiceMock.info).toHaveBeenCalledWith('views.page.ngoninit.start');
      expect(debugLogServiceMock.info).toHaveBeenCalledWith('views.page.ngoninit.end', {
        listType: 'collection',
      });
    });
  });
});
