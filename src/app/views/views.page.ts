import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AlertController,
  PopoverController,
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
export class ViewsPage implements OnInit {
  views$!: Observable<GameListView[]>;
  listType: ListType = 'collection';
  hasCurrentConfiguration = false;
  currentFilters: GameListFilters = { ...DEFAULT_GAME_LIST_FILTERS };
  currentGroupBy: GameGroupByField = 'none';

  isNameModalOpen = false;
  isRenameMode = false;
  editingViewId: number | null = null;
  draftName = '';

  private readonly gameShelfService = inject(GameShelfService);
  private readonly router = inject(Router);
  private readonly popoverController = inject(PopoverController);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);
  private readonly debugLogService = inject(DebugLogService);
  private readonly viewsContextService = inject(ViewsContextService);

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
        this.debugLogService.info('views.page.views_emit', { count: views.length });
        // Only force a flush when a malformed row is detected. The expensive,
        // main-thread part of flush() is the synchronous JSON.stringify (the
        // native storage write is scheduled async), so flushing on every
        // emission would add serialization work to a hot observable — the
        // routine checkpoint is left to the debounced persist instead.
        if (this.warnMalformedViews(views)) {
          void this.debugLogService.flush();
        }
      })
    );
    this.debugLogService.info('views.page.ngoninit.end', { listType: this.listType });
    void this.debugLogService.flush();
  }

  ionViewWillEnter(): void {
    this.debugLogService.info('views.page.will_enter');
    void this.debugLogService.flush();
  }

  ionViewDidEnter(): void {
    this.debugLogService.info('views.page.did_enter');
    void this.debugLogService.flush();
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

  async renameViewFromPopover(view: GameListView): Promise<void> {
    await this.popoverController.dismiss();

    if (typeof view.id !== 'number') {
      return;
    }

    this.isRenameMode = true;
    this.editingViewId = view.id;
    this.draftName = view.name;
    this.isNameModalOpen = true;
  }

  async updateViewFromPopover(view: GameListView): Promise<void> {
    await this.popoverController.dismiss();

    if (typeof view.id !== 'number') {
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

  async deleteViewFromPopover(view: GameListView): Promise<void> {
    await this.popoverController.dismiss();

    if (typeof view.id !== 'number') {
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

  getActionsTriggerId(view: GameListView): string {
    return `view-actions-trigger-${String(view.id ?? view.name).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
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
  // rather than per change-detection render. Returns true if any malformed row
  // was found so the caller can force-flush only in that case. The flush is
  // left to the caller.
  private warnMalformedViews(views: readonly GameListView[]): boolean {
    let foundMalformed = false;
    for (const view of views) {
      const looseView = view as Partial<Pick<GameListView, 'filters' | 'groupBy'>>;
      if (!looseView.filters || !looseView.groupBy) {
        foundMalformed = true;
        this.debugLogService.warn('views.page.view_malformed', {
          id: view.id,
          name: view.name,
          hasFilters: Boolean(looseView.filters),
          hasGroupBy: Boolean(looseView.groupBy),
        });
      }
    }
    return foundMalformed;
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
