import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAME_LIST_FILTERS, type GameListFilters } from '../../core/models/game.models';
import { GameFiltersMenuComponent } from './game-filters-menu.component';

describe('GameFiltersMenuComponent', () => {
  function createComponent(): GameFiltersMenuComponent {
    const component = new GameFiltersMenuComponent();
    component.menuId = 'filters';
    component.contentId = 'content';
    return component;
  }

  function createFilters(sortField: GameListFilters['sortField']): GameListFilters {
    return {
      ...DEFAULT_GAME_LIST_FILTERS,
      sortField
    };
  }

  it('normalizes legacy platform sort and emits corrected filters', () => {
    const component = createComponent();
    const emitSpy = vi.spyOn(component.filtersChange, 'emit');

    component.filters = createFilters('platform');
    component.listType = 'collection';
    component.ngOnChanges();

    expect(component.draftFilters.sortField).toBe(DEFAULT_GAME_LIST_FILTERS.sortField);
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sortField: DEFAULT_GAME_LIST_FILTERS.sortField })
    );
  });

  it('normalizes hidden price sort outside wishlist and emits corrected filters', () => {
    const component = createComponent();
    const emitSpy = vi.spyOn(component.filtersChange, 'emit');

    component.filters = createFilters('price');
    component.listType = 'collection';
    component.ngOnChanges();

    expect(component.draftFilters.sortField).toBe(DEFAULT_GAME_LIST_FILTERS.sortField);
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sortField: DEFAULT_GAME_LIST_FILTERS.sortField })
    );
  });

  it('does not emit when incoming sort field is already valid', () => {
    const component = createComponent();
    const emitSpy = vi.spyOn(component.filtersChange, 'emit');

    component.filters = createFilters('title');
    component.listType = 'collection';
    component.ngOnChanges();

    expect(component.draftFilters.sortField).toBe('title');
    expect(emitSpy).not.toHaveBeenCalled();
  });
});
