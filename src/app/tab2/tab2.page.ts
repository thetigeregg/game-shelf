import { Component } from '@angular/core';
import { DEFAULT_GAME_LIST_FILTERS, GameListFilters, ListType } from '../core/models/game.models';

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

  filters: GameListFilters = { ...DEFAULT_GAME_LIST_FILTERS };
  platformOptions: string[] = [];

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
}
