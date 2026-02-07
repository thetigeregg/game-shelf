import { Component } from '@angular/core';
import { DEFAULT_GAME_LIST_FILTERS, GameListFilters, ListType } from '../core/models/game.models';

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  standalone: false,
})
export class Tab1Page {
  readonly listType: ListType = 'collection';
  readonly menuId = 'collection-filters-menu';
  readonly contentId = 'collection-content';

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
