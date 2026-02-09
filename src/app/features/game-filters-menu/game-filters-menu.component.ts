import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { DEFAULT_GAME_LIST_FILTERS, GameListFilters } from '../../core/models/game.models';

type SortOption =
  | 'title:asc'
  | 'title:desc'
  | 'releaseDate:asc'
  | 'releaseDate:desc'
  | 'createdAt:asc'
  | 'createdAt:desc'
  | 'platform:asc'
  | 'platform:desc';

@Component({
  selector: 'app-game-filters-menu',
  templateUrl: './game-filters-menu.component.html',
  styleUrls: ['./game-filters-menu.component.scss'],
  standalone: false,
})
export class GameFiltersMenuComponent implements OnChanges {
  @Input({ required: true }) menuId!: string;
  @Input({ required: true }) contentId!: string;
  @Input() platformOptions: string[] = [];
  @Input() genreOptions: string[] = [];
  @Input() tagOptions: string[] = [];
  @Input() filters: GameListFilters = { ...DEFAULT_GAME_LIST_FILTERS };

  @Output() filtersChange = new EventEmitter<GameListFilters>();

  draftFilters: GameListFilters = { ...DEFAULT_GAME_LIST_FILTERS };
  sortOption: SortOption = 'title:asc';

  ngOnChanges(): void {
    this.draftFilters = {
      ...DEFAULT_GAME_LIST_FILTERS,
      ...this.filters,
    };
    this.sortOption = `${this.draftFilters.sortField}:${this.draftFilters.sortDirection}` as SortOption;
  }

  updateFilters(): void {
    this.filtersChange.emit({ ...this.draftFilters });
  }

  resetFilters(): void {
    this.draftFilters = { ...DEFAULT_GAME_LIST_FILTERS };
    this.sortOption = 'title:asc';
    this.updateFilters();
  }

  onSortOptionChange(value: SortOption | string): void {
    if (!this.isSortOption(value)) {
      return;
    }

    const [sortField, sortDirection] = value.split(':') as [GameListFilters['sortField'], GameListFilters['sortDirection']];
    this.sortOption = value;
    this.draftFilters = {
      ...this.draftFilters,
      sortField,
      sortDirection,
    };
    this.updateFilters();
  }

  onPlatformSelectionChange(value: string[] | string | null | undefined): void {
    const normalized = this.normalizeSelection(value);
    this.draftFilters = {
      ...this.draftFilters,
      platform: normalized,
    };
    this.updateFilters();
  }

  onGenreSelectionChange(value: string[] | string | null | undefined): void {
    const normalized = this.normalizeSelection(value);
    this.draftFilters = {
      ...this.draftFilters,
      genres: normalized,
    };
    this.updateFilters();
  }

  onTagSelectionChange(value: string[] | string | null | undefined): void {
    const normalized = this.normalizeSelection(value);
    this.draftFilters = {
      ...this.draftFilters,
      tags: normalized,
    };
    this.updateFilters();
  }

  onReleaseDateFromChange(value: string | string[] | null | undefined): void {
    this.draftFilters = {
      ...this.draftFilters,
      releaseDateFrom: this.toDateOnly(value),
    };
    this.updateFilters();
  }

  onReleaseDateToChange(value: string | string[] | null | undefined): void {
    this.draftFilters = {
      ...this.draftFilters,
      releaseDateTo: this.toDateOnly(value),
    };
    this.updateFilters();
  }

  get releaseDateFromDatetimeId(): string {
    return `${this.menuId}-release-date-from`;
  }

  get releaseDateToDatetimeId(): string {
    return `${this.menuId}-release-date-to`;
  }

  private toDateOnly(value: string | string[] | null | undefined): string | null {
    if (typeof value !== 'string' || value.length < 10) {
      return null;
    }

    return value.slice(0, 10);
  }

  private normalizeSelection(value: string[] | string | null | undefined): string[] {
    const normalizedValues = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? [value]
        : [];

    return [...new Set(
      normalizedValues
        .map(platform => platform.trim())
        .filter(platform => platform.length > 0)
    )];
  }

  private isSortOption(value: string): value is SortOption {
    return value === 'title:asc'
      || value === 'title:desc'
      || value === 'releaseDate:asc'
      || value === 'releaseDate:desc'
      || value === 'createdAt:asc'
      || value === 'createdAt:desc'
      || value === 'platform:asc'
      || value === 'platform:desc';
  }
}
