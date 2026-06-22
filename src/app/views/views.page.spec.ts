import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ionic/angular/standalone', () => {
  const AlertControllerToken = function AlertController() {
    return undefined;
  };
  const ToastControllerToken = function ToastController() {
    return undefined;
  };

  return {
    AlertController: AlertControllerToken,
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

import { AlertController, ToastController } from '@ionic/angular/standalone';
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
  let gameShelfServiceMock: {
    watchViews: ReturnType<typeof vi.fn>;
    updateViewConfiguration: ReturnType<typeof vi.fn>;
    deleteView: ReturnType<typeof vi.fn>;
  };
  let viewsContextServiceMock: { consume: ReturnType<typeof vi.fn> };
  let alertControllerMock: { create: ReturnType<typeof vi.fn> };
  let toastControllerMock: { create: ReturnType<typeof vi.fn> };
  let debugLogServiceMock: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    trace: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    gameShelfServiceMock = {
      watchViews: vi.fn().mockReturnValue(of([] as GameListView[])),
      updateViewConfiguration: vi.fn().mockResolvedValue(undefined),
      deleteView: vi.fn().mockResolvedValue(undefined),
    };
    alertControllerMock = { create: vi.fn() };
    toastControllerMock = { create: vi.fn().mockResolvedValue({ present: vi.fn() }) };
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
        { provide: AlertController, useValue: alertControllerMock },
        { provide: ToastController, useValue: toastControllerMock },
      ],
    });

    component = TestBed.runInInjectionContext(() => new ViewsPage());
  });

  afterEach(() => {
    // ionViewDidEnter starts a heartbeat interval; tear it down so timers never
    // leak into later tests.
    component.ngOnDestroy();
    vi.clearAllMocks();
    vi.useRealTimers();
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
    it('logs a diagnostic checkpoint on the first views emission', () => {
      const views = [makeView()];
      gameShelfServiceMock.watchViews.mockReturnValue(of(views));

      component.ngOnInit();
      component.views$.subscribe();

      expect(debugLogServiceMock.info).toHaveBeenCalledWith('views.page.views_emit', {
        count: 1,
      });
    });

    it('logs the views_emit checkpoint only once across multiple subscriptions', () => {
      gameShelfServiceMock.watchViews.mockReturnValue(of([makeView()]));

      component.ngOnInit();
      component.views$.subscribe();
      component.views$.subscribe();

      const emitCalls = debugLogServiceMock.info.mock.calls.filter(
        ([event]) => event === 'views.page.views_emit'
      );
      expect(emitCalls).toHaveLength(1);
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

  describe('heartbeat diagnostics', () => {
    it('emits a heartbeat with the change-detection count every interval', () => {
      vi.useFakeTimers();
      component.ionViewDidEnter();
      component.ngDoCheck();
      component.ngDoCheck();

      vi.advanceTimersByTime(2000);

      const heartbeat = debugLogServiceMock.info.mock.calls.find(
        ([event]) => event === 'views.page.heartbeat'
      );
      expect(heartbeat?.[1]).toEqual({ elapsedMs: 2000, docheckCount: 2 });
    });

    it('stops the heartbeat when the view leaves', () => {
      vi.useFakeTimers();
      component.ionViewDidEnter();
      component.ionViewDidLeave();

      vi.advanceTimersByTime(6000);

      const heartbeats = debugLogServiceMock.info.mock.calls.filter(
        ([event]) => event === 'views.page.heartbeat'
      );
      expect(heartbeats).toHaveLength(0);
    });

    it('resets elapsed time and the change-detection count on re-entry', () => {
      vi.useFakeTimers();
      component.ionViewDidEnter();
      component.ngDoCheck();
      vi.advanceTimersByTime(2000);
      component.ionViewDidLeave();

      // Re-enter a cached instance: counters should start from zero, not carry
      // over from the previous visit.
      component.ionViewDidEnter();
      component.ngDoCheck();
      vi.advanceTimersByTime(2000);

      const heartbeats = debugLogServiceMock.info.mock.calls.filter(
        ([event]) => event === 'views.page.heartbeat'
      );
      expect(heartbeats.at(-1)?.[1]).toEqual({ elapsedMs: 2000, docheckCount: 1 });
    });

    it('stops the heartbeat on destroy', () => {
      vi.useFakeTimers();
      component.ionViewDidEnter();
      component.ngOnDestroy();

      vi.advanceTimersByTime(6000);

      const heartbeats = debugLogServiceMock.info.mock.calls.filter(
        ([event]) => event === 'views.page.heartbeat'
      );
      expect(heartbeats).toHaveLength(0);
    });

    it('is safe to destroy when the view never entered', () => {
      expect(() => {
        component.ngOnDestroy();
      }).not.toThrow();
    });

    it('self-terminates after the bounded diagnostic window', () => {
      vi.useFakeTimers();
      component.ionViewDidEnter();

      // Run well past the 60-tick (~2min) bound; the heartbeat should stop on
      // its own so an extended session can't crowd out other diagnostics.
      vi.advanceTimersByTime(2000 * 200);

      const heartbeats = debugLogServiceMock.info.mock.calls.filter(
        ([event]) => event === 'views.page.heartbeat'
      );
      expect(heartbeats).toHaveLength(60);
    });
  });

  describe('view actions popover', () => {
    it('opens the popover for the selected view and stops event propagation', () => {
      const view = makeView();
      const stopPropagation = vi.fn();
      const event = { stopPropagation } as unknown as Event;

      component.openViewActions(view, event);

      expect(stopPropagation).toHaveBeenCalledOnce();
      expect(component.isViewActionsPopoverOpen).toBe(true);
      expect(component.viewActionsPopoverEvent).toBe(event);
      expect(component.selectedViewForActions).toBe(view);
    });

    it('resets popover state on dismiss', () => {
      const view = makeView();
      component.openViewActions(view, { stopPropagation: vi.fn() } as unknown as Event);

      component.onViewActionsDismiss();

      expect(component.isViewActionsPopoverOpen).toBe(false);
      expect(component.viewActionsPopoverEvent).toBeUndefined();
      expect(component.selectedViewForActions).toBeNull();
    });
  });

  describe('renameViewFromPopover', () => {
    it('opens the rename modal seeded from the selected view', async () => {
      const view = makeView({ id: 5, name: 'Backlog' });
      component.openViewActions(view, { stopPropagation: vi.fn() } as unknown as Event);

      await component.renameViewFromPopover();

      expect(component.isRenameMode).toBe(true);
      expect(component.editingViewId).toBe(5);
      expect(component.draftName).toBe('Backlog');
      expect(component.isNameModalOpen).toBe(true);
    });

    it('does nothing when no view is selected', async () => {
      component.selectedViewForActions = null;

      await component.renameViewFromPopover();

      expect(component.isNameModalOpen).toBe(false);
    });

    it('does nothing when the selected view has no numeric id', async () => {
      const view = makeView();
      delete (view as Partial<GameListView>).id;
      component.selectedViewForActions = view;

      await component.renameViewFromPopover();

      expect(component.isNameModalOpen).toBe(false);
    });
  });

  describe('updateViewFromPopover', () => {
    it('updates the configuration and toasts when a context is available', async () => {
      gameShelfServiceMock.updateViewConfiguration.mockResolvedValue(undefined);
      const view = makeView({ id: 9 });
      component.hasCurrentConfiguration = true;
      component.selectedViewForActions = view;

      await component.updateViewFromPopover();

      expect(gameShelfServiceMock.updateViewConfiguration).toHaveBeenCalledWith(
        9,
        component.currentFilters,
        component.currentGroupBy
      );
      expect(toastControllerMock.create).toHaveBeenCalled();
    });

    it('warns and skips the update without a current configuration', async () => {
      const view = makeView({ id: 9 });
      component.hasCurrentConfiguration = false;
      component.selectedViewForActions = view;

      await component.updateViewFromPopover();

      expect(gameShelfServiceMock.updateViewConfiguration).not.toHaveBeenCalled();
      expect(toastControllerMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ color: 'warning' })
      );
    });

    it('does nothing when no view is selected', async () => {
      component.selectedViewForActions = null;

      await component.updateViewFromPopover();

      expect(gameShelfServiceMock.updateViewConfiguration).not.toHaveBeenCalled();
    });
  });

  describe('deleteViewFromPopover', () => {
    it('deletes the view when the confirmation is accepted', async () => {
      gameShelfServiceMock.deleteView.mockResolvedValue(undefined);
      alertControllerMock.create.mockResolvedValue({
        present: vi.fn().mockResolvedValue(undefined),
        onDidDismiss: vi.fn().mockResolvedValue({ role: 'confirm' }),
      });
      component.selectedViewForActions = makeView({ id: 3 });

      await component.deleteViewFromPopover();

      expect(gameShelfServiceMock.deleteView).toHaveBeenCalledWith(3);
    });

    it('does not delete when the confirmation is cancelled', async () => {
      alertControllerMock.create.mockResolvedValue({
        present: vi.fn().mockResolvedValue(undefined),
        onDidDismiss: vi.fn().mockResolvedValue({ role: 'cancel' }),
      });
      component.selectedViewForActions = makeView({ id: 3 });

      await component.deleteViewFromPopover();

      expect(gameShelfServiceMock.deleteView).not.toHaveBeenCalled();
    });

    it('does nothing when no view is selected', async () => {
      component.selectedViewForActions = null;

      await component.deleteViewFromPopover();

      expect(alertControllerMock.create).not.toHaveBeenCalled();
    });
  });
});
