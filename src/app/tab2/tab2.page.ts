import { Component, ViewChild, inject } from '@angular/core';
import { MenuController, PopoverController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { DEFAULT_GAME_LIST_FILTERS, GameEntry, GameListFilters, ListType } from '../core/models/game.models';
import { GameListComponent } from '../features/game-list/game-list.component';

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss'],
  standalone: false,
})
export class Tab2Page {
  readonly listType: ListType = 'wishlist';
  readonly menuId = 'wishlist-filters-menu';
  readonly contentId = 'wishlist-content';
  readonly headerActionsTriggerId = 'wishlist-header-actions';

  filters: GameListFilters = { ...DEFAULT_GAME_LIST_FILTERS };
  platformOptions: string[] = [];
  displayedGames: GameEntry[] = [];
  listSearchQuery = '';
  isAddGameModalOpen = false;
  @ViewChild(GameListComponent) private gameListComponent?: GameListComponent;
  private readonly menuController = inject(MenuController);
  private readonly popoverController = inject(PopoverController);
  private readonly toastController = inject(ToastController);
  private readonly router = inject(Router);

  onFiltersChange(filters: GameListFilters): void {
    this.filters = { ...filters };
  }

  onPlatformOptionsChange(platformOptions: string[]): void {
    this.platformOptions = platformOptions;

    if (this.filters.platform !== 'all' && !platformOptions.includes(this.filters.platform)) {
      this.filters = {
        ...this.filters,
        platform: 'all',
      };
    }
  }

  onListSearchChange(value: string | null | undefined): void {
    this.listSearchQuery = (value ?? '').replace(/^\s+/, '');
  }

  onDisplayedGamesChange(games: GameEntry[]): void {
    this.displayedGames = [...games];
  }

  openAddGameModal(): void {
    this.isAddGameModalOpen = true;
  }

  closeAddGameModal(): void {
    this.isAddGameModalOpen = false;
  }

  async openFiltersMenu(): Promise<void> {
    await this.menuController.open(this.menuId);
  }

  async pickRandomGameFromPopover(): Promise<void> {
    await this.popoverController.dismiss();

    if (this.displayedGames.length === 0) {
      await this.presentToast('No games available in current results.', 'warning');
      return;
    }

    const randomIndex = Math.floor(Math.random() * this.displayedGames.length);
    const randomGame = this.displayedGames[randomIndex];
    this.gameListComponent?.openGameDetail(randomGame);
  }

  async openSettingsFromPopover(): Promise<void> {
    await this.popoverController.dismiss();
    await this.router.navigateByUrl('/settings');
  }

  getDisplayedGamesLabel(): string {
    return this.displayedGames.length === 1 ? '1 game' : `${this.displayedGames.length} games`;
  }

  private async presentToast(message: string, color: 'primary' | 'warning' = 'primary'): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 1500,
      position: 'bottom',
      color,
    });

    await toast.present();
  }
}
