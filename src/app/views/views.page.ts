import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AlertController, PopoverController, ToastController } from '@ionic/angular/standalone';
import { IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonItem, IonLabel, IonButton, IonIcon, IonPopover, IonFab, IonFabButton, IonModal, IonInput, IonNote } from "@ionic/angular/standalone";
import { Observable } from 'rxjs';
import {
    DEFAULT_GAME_LIST_FILTERS,
    GameGroupByField,
    GameListFilters,
    GameListView,
    ListType
} from '../core/models/game.models';
import { GameShelfService } from '../core/services/game-shelf.service';
import { addIcons } from "ionicons";
import { ellipsisVertical, add } from "ionicons/icons";

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
        IonPopover,
        IonFab,
        IonFabButton,
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

    ngOnInit(): void {
        const state = window.history.state as Partial<{
            listType: ListType;
            filters: GameListFilters;
            groupBy: GameGroupByField;
        }>;

        if (state.listType === 'collection' || state.listType === 'wishlist') {
            this.listType = state.listType;
        }

        if (state.filters) {
            this.currentFilters = {
                ...DEFAULT_GAME_LIST_FILTERS,
                ...state.filters,
            };
            this.hasCurrentConfiguration = true;
        }

        if (state.groupBy) {
            this.currentGroupBy = this.normalizeGroupBy(state.groupBy);
            this.hasCurrentConfiguration = true;
        }

        this.views$ = this.gameShelfService.watchViews(this.listType);
    }

    get backHref(): string {
        return this.listType === 'wishlist' ? '/tabs/wishlist' : '/tabs/collection';
    }

    getCreateButtonLabel(): string {
        return this.hasCurrentConfiguration ? 'Save current as view' : 'Open from a list page to save current filters';
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
            await this.presentToast('Open Views from Collection or Wishlist to save current filters.', 'warning');
            return;
        }

        await this.gameShelfService.createView(
            normalizedName,
            this.listType,
            this.currentFilters,
            this.currentGroupBy,
        );
        await this.presentToast('View saved.');
        this.closeNameModal();
    }

    async applyView(view: GameListView): Promise<void> {
        if (typeof view.id !== 'number') {
            return;
        }

        const targetUrl = view.listType === 'wishlist' ? '/tabs/wishlist' : '/tabs/collection';
        await this.router.navigateByUrl(`${targetUrl}?applyView=${view.id}`);
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
            await this.presentToast('Open Views from Collection or Wishlist to update with current filters.', 'warning');
            return;
        }

        await this.gameShelfService.updateViewConfiguration(view.id, this.currentFilters, this.currentGroupBy);
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

        await alert.present();
        const { role } = await alert.onDidDismiss();

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
        const sortLabel = this.getSortLabel(view.filters.sortField, view.filters.sortDirection);
        const groupLabel = this.getGroupLabel(view.groupBy);
        return `${sortLabel} • Group: ${groupLabel}`;
    }

    trackByViewId(_: number, view: GameListView): string {
        return String(view.id ?? view.name);
    }

    private getSortLabel(sortField: GameListFilters['sortField'], sortDirection: GameListFilters['sortDirection']): string {
        const direction = sortDirection === 'desc' ? '↓' : '↑';

        if (sortField === 'releaseDate') {
            return `Release date ${direction}`;
        }

        if (sortField === 'createdAt') {
            return `Date added ${direction}`;
        }

        if (sortField === 'platform') {
            return `Platform ${direction}`;
        }

        return `Title ${direction}`;
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

    private normalizeGroupBy(value: GameGroupByField): GameGroupByField {
        if (
            value === 'none'
            || value === 'platform'
            || value === 'developer'
            || value === 'franchise'
            || value === 'collection'
            || value === 'tag'
            || value === 'genre'
            || value === 'publisher'
            || value === 'releaseYear'
        ) {
            return value;
        }

        return 'none';
    }

    private async presentToast(message: string, color: 'primary' | 'warning' = 'primary'): Promise<void> {
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
    }
}
