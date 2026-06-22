import { Component, DoCheck, NgZone, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AlertController,
  ToastController,
  IonHeader,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonTitle,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonButton,
  IonIcon,
  IonFab,
  IonFabButton,
  IonPopover,
  IonModal,
  IonInput,
  IonNote,
} from '@ionic/angular/standalone';
import { Observable, tap } from 'rxjs';
import {
  DEFAULT_GAME_LIST_FILTERS,
  GameGroupByField,
  GameListFilters,
  GameListView,
  ListType,
} from '../core/models/game.models';
import { GameShelfService } from '../core/services/game-shelf.service';
import { DebugLogService } from '../core/services/debug-log.service';
import { ViewsContextService } from './views-context.service';
import { addIcons } from 'ionicons';
import { ellipsisVertical, add } from 'ionicons/icons';
import { isTasFeatureEnabled } from '../core/config/runtime-config';

@Component({
  selector: 'app-views',
  templateUrl: './views.page.html',
  styleUrls: ['./views.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonButton,
    IonIcon,
    IonFab,
    IonFabButton,
    IonPopover,
    IonModal,
    IonInput,
    IonNote,
  ],
})
export class ViewsPage implements OnInit, DoCheck, OnDestroy {
  views$!: Observable<GameListView[]>;
  listType: ListType = 'collection';
  hasCurrentConfiguration = false;
  currentFilters: GameListFilters = { ...DEFAULT_GAME_LIST_FILTERS };
  currentGroupBy: GameGroupByField = 'none';

  isNameModalOpen = false;
  isRenameMode = false;
  editingViewId: number | null = null;
  draftName = '';

  // Single root-level actions popover (one for the whole page), opened
  // programmatically per row. Replaces the previous per-item, in-content
  // `ion-popover` which froze the iOS WKWebView when the list rendered — the
  // same iOS backdrop freeze fixed in list-page by moving popovers to root.
  isViewActionsPopoverOpen = false;
  viewActionsPopoverEvent: Event | undefined = undefined;
  selectedViewForActions: GameListView | null = null;

  private loggedFirstViewsEmit = false;

  // Diagnostics for the iOS renderer crash on /views: a wall-clock heartbeat
  // plus a change-detection counter. If heartbeats keep firing while the page
  // is shown, the main thread is alive and the crash is native (memory/GPU);
  // if they stop, the main thread is blocked. A runaway docheckCount points to
  // a change-detection loop. The heartbeat is tied to the Ionic view lifecycle
  // (enter/leave) rather than ngOnInit/ngOnDestroy because IonicRouteStrategy
  // reuses cached page instances, so ngOnDestroy may not run on navigation —
  // an ngOnInit-scoped interval would keep firing while /views is offscreen.
  // Stop the heartbeat after this many ticks (2s each → ~2min). The freeze
  // shows up shortly after entry, so a bounded window captures it without
  // letting a long /views session evict other diagnostics from the 8000-entry
  // buffer or sustain storage-write pressure on iOS.
  private static readonly HEARTBEAT_MAX_TICKS = 60;
  private heartbeatHandle: ReturnType<typeof setInterval> | null = null;
  private heartbeatTicks = 0;
  private docheckCount = 0;
  private enteredAtMs = 0;

  private readonly gameShelfService = inject(GameShelfService);
  private readonly router = inject(Router);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);
  private readonly debugLogService = inject(DebugLogService);
  private readonly viewsContextService = inject(ViewsContextService);
  private readonly ngZone = inject(NgZone);

  @ViewChild('viewActionsPopover') private viewActionsPopover?: IonPopover;

  ngOnInit(): void {
    // Diagnostic checkpoints: flush() serializes buffered entries on the main
    // thread (JSON.stringify) and then issues the storage write — async on
    // native, where Preferences.set() is scheduled rather than awaited here. It
    // is best-effort rather than guaranteed-synchronous persistence, but the
    // serialized snapshot helps localize the iOS Views-page freeze.
    this.debugLogService.info('views.page.ngoninit.start');
    void this.debugLogService.flush();
    const { context: ctx, hasContext } = this.viewsContextService.consume();
    this.listType = ctx.listType;
    this.currentFilters = { ...DEFAULT_GAME_LIST_FILTERS, ...ctx.filters };
    this.currentGroupBy = this.normalizeGroupBy(ctx.groupBy);
    this.hasCurrentConfiguration = hasContext;
    this.views$ = this.gameShelfService.watchViews(this.listType).pipe(
      tap((views) => {
        // Flush the first emission so the export confirms the list actually
        // rendered (distinguishes a transition hang from a list-render hang).
        // Subsequent emissions rely on the debounced persist to avoid adding
        // serialization work on every change.
        if (!this.loggedFirstViewsEmit) {
          this.loggedFirstViewsEmit = true;
          this.debugLogService.info('views.page.views_emit', { count: views.length });
          void this.debugLogService.flush();
        }
        this.warnMalformedViews(views);
      })
    );
    this.debugLogService.info('views.page.ngoninit.end', { listType: this.listType });
    void this.debugLogService.flush();
  }

  ngDoCheck(): void {
    this.docheckCount += 1;
  }

  ngOnDestroy(): void {
    // Safety net for the non-reused case; the heartbeat is normally stopped in
    // ionViewDidLeave.
    this.stopHeartbeat();
  }

  ionViewWillEnter(): void {
    this.debugLogService.info('views.page.will_enter');
    void this.debugLogService.flush();
  }

  ionViewDidEnter(): void {
    this.debugLogService.info('views.page.did_enter');
    void this.debugLogService.flush();
    this.startHeartbeat();
  }

  ionViewDidLeave(): void {
    // Pause diagnostics while the page is offscreen. With route reuse the
    // instance is cached, so without this the interval would keep logging and
    // flush-writing on the main thread for a page the user can't see.
    this.stopHeartbeat();
  }

  private startHeartbeat(): void {
    // Reset per-visit so elapsedMs/docheckCount reflect this visit, not the
    // cumulative lifetime of a reused instance.
    this.stopHeartbeat();
    this.enteredAtMs = Date.now();
    this.docheckCount = 0;
    this.heartbeatTicks = 0;
    // Run outside Angular so the tick itself doesn't trigger change detection:
    // an in-zone interval would both add main-thread work every 2s (worsening
    // the freeze under investigation) and inflate docheckCount, hiding the
    // change-detection signal we're trying to measure.
    this.ngZone.runOutsideAngular(() => {
      this.heartbeatHandle = setInterval(() => {
        // Rely on info()'s debounced persist rather than flush(); a synchronous
        // JSON.stringify of the full buffer every 2s is avoidable main-thread
        // jank on iOS.
        this.debugLogService.info('views.page.heartbeat', {
          elapsedMs: Date.now() - this.enteredAtMs,
          docheckCount: this.docheckCount,
        });
        this.heartbeatTicks += 1;
        if (this.heartbeatTicks >= ViewsPage.HEARTBEAT_MAX_TICKS) {
          // Self-terminate once the diagnostic window has elapsed so an
          // extended session can't crowd out other logs.
          this.stopHeartbeat();
        }
      }, 2000);
    });
  }

  private stopHeartbeat(): void {
    if (this.heartbeatHandle !== null) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
  }

  get backHref(): string {
    return this.listType === 'wishlist' ? '/tabs/wishlist' : '/tabs/collection';
  }

  getCreateButtonLabel(): string {
    return this.hasCurrentConfiguration
      ? 'Save current as view'
      : 'Open from a list page to save current filters';
  }

  openCreateViewModal(): void {
    this.isRenameMode = false;
    this.editingViewId = null;
    this.draftName = '';
    this.isNameModalOpen = true;
  }

  closeNameModal(): void {
    this.isNameModalOpen = false;
    this.isRenameMode = false;
    this.editingViewId = null;
    this.draftName = '';
  }

  async saveViewName(): Promise<void> {
    const normalizedName = this.draftName.trim();

    if (normalizedName.length === 0) {
      await this.presentToast('View name is required.', 'warning');
      return;
    }

    if (this.isRenameMode) {
      if (typeof this.editingViewId !== 'number') {
        return;
      }

      await this.gameShelfService.renameView(this.editingViewId, normalizedName);
      await this.presentToast('View renamed.');
      this.closeNameModal();
      return;
    }

    if (!this.hasCurrentConfiguration) {
      await this.presentToast(
        'Open Views from Collection or Wishlist to save current filters.',
        'warning'
      );
      return;
    }

    await this.gameShelfService.createView(
      normalizedName,
      this.listType,
      this.currentFilters,
      this.currentGroupBy
    );
    await this.presentToast('View saved.');
    this.closeNameModal();
  }

  async applyView(view: GameListView): Promise<void> {
    if (typeof view.id !== 'number') {
      return;
    }

    const targetUrl = view.listType === 'wishlist' ? '/tabs/wishlist' : '/tabs/collection';
    await this.router.navigateByUrl(`${targetUrl}?applyView=${String(view.id)}`);
  }

  openViewActions(view: GameListView, event: Event): void {
    event.stopPropagation();
    this.selectedViewForActions = view;
    this.viewActionsPopoverEvent = event;
    this.isViewActionsPopoverOpen = true;
  }

  onViewActionsDismiss(): void {
    this.isViewActionsPopoverOpen = false;
    this.viewActionsPopoverEvent = undefined;
    this.selectedViewForActions = null;
  }

  async renameViewFromPopover(): Promise<void> {
    const view = this.selectedViewForActions;
    await this.viewActionsPopover?.dismiss();

    if (!view || typeof view.id !== 'number') {
      return;
    }

    this.isRenameMode = true;
    this.editingViewId = view.id;
    this.draftName = view.name;
    this.isNameModalOpen = true;
  }

  async updateViewFromPopover(): Promise<void> {
    const view = this.selectedViewForActions;
    await this.viewActionsPopover?.dismiss();

    if (!view || typeof view.id !== 'number') {
      return;
    }

    if (!this.hasCurrentConfiguration) {
      await this.presentToast(
        'Open Views from Collection or Wishlist to update with current filters.',
        'warning'
      );
      return;
    }

    await this.gameShelfService.updateViewConfiguration(
      view.id,
      this.currentFilters,
      this.currentGroupBy
    );
    await this.presentToast('View updated.');
  }

  async deleteViewFromPopover(): Promise<void> {
    const view = this.selectedViewForActions;
    await this.viewActionsPopover?.dismiss();

    if (!view || typeof view.id !== 'number') {
      return;
    }

    const alert = await this.alertController.create({
      header: 'Delete View',
      message: `Delete view "${view.name}"?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Delete',
          role: 'confirm',
          cssClass: 'alert-button-danger',
        },
      ],
    });

    this.debugLogService.trace('ui.alert.presented', { type: 'view_delete_confirm' });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    this.debugLogService.trace('ui.alert.dismissed', { type: 'view_delete_confirm', role });

    if (role !== 'confirm') {
      return;
    }

    await this.gameShelfService.deleteView(view.id);
    await this.presentToast('View deleted.');
  }

  getViewSummary(view: GameListView): string {
    // Harden against malformed rows: a missing `filters` or `groupBy` would
    // otherwise throw here during render. The declared type says both are
    // always present, but synced/migrated data may not honor that, so read
    // through an optional view and fall back to defaults. This runs during
    // change detection, so it must stay side-effect free — malformed rows are
    // logged once per emission in `warnMalformedViews`, not here.
    const looseView = view as Partial<Pick<GameListView, 'filters' | 'groupBy'>>;
    const filters = looseView.filters ?? DEFAULT_GAME_LIST_FILTERS;
    const sortLabel = this.getSortLabel(filters.sortField, filters.sortDirection);
    const groupLabel = this.getGroupLabel(this.normalizeGroupBy(looseView.groupBy));
    return `${sortLabel} • Group: ${groupLabel}`;
  }

  // Logs malformed rows (missing `filters`/`groupBy`) once per views emission
  // rather than per change-detection render. The diagnostic flush is keyed to
  // the first emission, not malformed rows, so this no longer reports back to
  // the caller.
  private warnMalformedViews(views: readonly GameListView[]): void {
    for (const view of views) {
      const looseView = view as Partial<Pick<GameListView, 'filters' | 'groupBy'>>;
      if (!looseView.filters || !looseView.groupBy) {
        this.debugLogService.warn('views.page.view_malformed', {
          id: view.id,
          name: view.name,
          hasFilters: Boolean(looseView.filters),
          hasGroupBy: Boolean(looseView.groupBy),
        });
      }
    }
  }

  trackByViewId(_: number, view: GameListView): string {
    return String(view.id ?? view.name);
  }

  private getSortLabel(
    sortField: GameListFilters['sortField'],
    sortDirection: GameListFilters['sortDirection']
  ): string {
    const direction = sortDirection === 'desc' ? '↓' : '↑';

    if (sortField === 'releaseDate') {
      return `Release date ${direction}`;
    }

    if (sortField === 'createdAt') {
      return `Date added ${direction}`;
    }

    if (sortField === 'hltb') {
      return `Completion time ${direction}`;
    }

    if (sortField === 'tas' && isTasFeatureEnabled()) {
      return `TAS ${direction}`;
    }

    if (sortField === 'ptas' && isTasFeatureEnabled() && this.listType === 'wishlist') {
      return `PTAS ${direction}`;
    }

    if (sortField === 'metacritic' || sortField === 'review') {
      return `Review ${direction}`;
    }

    if (sortField === 'price') {
      return `Price ${direction}`;
    }

    if (sortField === 'platform') {
      return `Platform ${direction}`;
    }

    return `Game title ${direction}`;
  }

  private getGroupLabel(groupBy: GameGroupByField): string {
    if (groupBy === 'releaseYear') {
      return 'Release Year';
    }

    if (groupBy === 'none') {
      return 'None';
    }

    if (groupBy === 'collection') {
      return 'Series';
    }

    return groupBy.charAt(0).toUpperCase() + groupBy.slice(1);
  }

  private normalizeGroupBy(value: unknown): GameGroupByField {
    if (
      value === 'none' ||
      value === 'platform' ||
      value === 'developer' ||
      value === 'franchise' ||
      value === 'collection' ||
      value === 'tag' ||
      value === 'genre' ||
      value === 'publisher' ||
      value === 'releaseYear'
    ) {
      return value;
    }

    return 'none';
  }

  private async presentToast(
    message: string,
    color: 'primary' | 'warning' = 'primary'
  ): Promise<void> {
    this.debugLogService.trace('ui.toast.presented', { message, color });
    const toast = await this.toastController.create({
      message,
      duration: 1600,
      position: 'bottom',
      color,
    });

    await toast.present();
  }

  constructor() {
    addIcons({ ellipsisVertical, add });
    this.debugLogService.info('views.page.ctor');
    void this.debugLogService.flush();
  }
}
