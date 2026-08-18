import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAME_LIST_FILTERS, type GameListFilters } from '../../core/models/game.models';
import { GameFiltersMenuComponent } from './game-filters-menu.component';

describe('GameFiltersMenuComponent', () => {
  afterEach(() => {
    delete window.__GAME_SHELF_RUNTIME_CONFIG__;
  });

  function createComponent(): GameFiltersMenuComponent {
    const component = new GameFiltersMenuComponent();
    component.menuId = 'filters';
    component.contentId = 'content';
    return component;
  }

  function createFilters(sortField: GameListFilters['sortField']): GameListFilters {
    return {
      ...DEFAULT_GAME_LIST_FILTERS,
      sortField,
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

  it('normalizes hidden ptas sort outside wishlist and emits corrected filters', () => {
    window.__GAME_SHELF_RUNTIME_CONFIG__ = { featureFlags: { tasEnabled: true } };
    const component = createComponent();
    const emitSpy = vi.spyOn(component.filtersChange, 'emit');

    component.filters = createFilters('ptas');
    component.listType = 'collection';
    component.ngOnChanges();

    expect(component.draftFilters.sortField).toBe(DEFAULT_GAME_LIST_FILTERS.sortField);
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sortField: DEFAULT_GAME_LIST_FILTERS.sortField })
    );
  });

  it('normalizes legacy metacritic sort to review and emits corrected filters', () => {
    const component = createComponent();
    const emitSpy = vi.spyOn(component.filtersChange, 'emit');

    component.filters = createFilters('metacritic');
    component.listType = 'wishlist';
    component.ngOnChanges();

    expect(component.draftFilters.sortField).toBe('review');
    expect(component.sortOption).toBe(`review:${component.draftFilters.sortDirection}`);
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ sortField: 'review' }));
  });

  it('shows the discounted filter only on the wishlist list type', () => {
    const component = createComponent();

    component.listType = 'collection';
    expect(component.showDiscountedFilter).toBe(false);

    component.listType = 'wishlist';
    expect(component.showDiscountedFilter).toBe(true);
  });

  it('clears a stale discounted filter outside wishlist and emits corrected filters', () => {
    const component = createComponent();
    const emitSpy = vi.spyOn(component.filtersChange, 'emit');

    component.filters = { ...DEFAULT_GAME_LIST_FILTERS, discounted: true };
    component.listType = 'collection';
    component.ngOnChanges();

    expect(component.draftFilters.discounted).toBe(false);
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ discounted: false }));
  });

  it('updates discounted via onDiscountedFilterChange', () => {
    const component = createComponent();
    const emitSpy = vi.spyOn(component.filtersChange, 'emit');

    component.listType = 'wishlist';
    component.onDiscountedFilterChange(true);

    expect(component.draftFilters.discounted).toBe(true);
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ discounted: true }));
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

  it('handles sort option guards, metacritic mapping, wishlist price sort, and wishlist ptas sort', () => {
    window.__GAME_SHELF_RUNTIME_CONFIG__ = { featureFlags: { tasEnabled: true } };
    const component = createComponent();
    const emitSpy = vi.spyOn(component.filtersChange, 'emit');

    component.listType = 'collection';
    component.onSortOptionChange('not-a-sort');
    component.onSortOptionChange('price:asc');
    expect(emitSpy).not.toHaveBeenCalled();

    component.onSortOptionChange('metacritic:desc');
    expect(component.sortOption).toBe('metacritic:desc');
    expect(component.draftFilters.sortField).toBe('review');
    expect(component.draftFilters.sortDirection).toBe('desc');

    component.listType = 'wishlist';
    component.onSortOptionChange('ptas:desc');
    expect(component.sortOption).toBe('ptas:desc');
    expect(component.draftFilters.sortField).toBe('ptas');
    expect(component.draftFilters.sortDirection).toBe('desc');

    component.onSortOptionChange('price:asc');
    expect(component.sortOption).toBe('price:asc');
    expect(component.draftFilters.sortField).toBe('price');
    expect(component.draftFilters.sortDirection).toBe('asc');
  });

  it('normalizes grouped and selection filters', () => {
    const component = createComponent();
    const filtersEmitSpy = vi.spyOn(component.filtersChange, 'emit');
    const groupByEmitSpy = vi.spyOn(component.groupByChange, 'emit');

    component.onGroupBySelectionChange('platform');
    component.onGroupBySelectionChange('not-real' as never);
    expect(groupByEmitSpy).toHaveBeenNthCalledWith(1, 'platform');
    expect(groupByEmitSpy).toHaveBeenNthCalledWith(2, 'none');

    component.onPlatformSelectionChange('  Switch  ');
    component.onTagSelectionChange([component.noneTagFilterValue, ' Action ', '']);
    component.onExcludedTagSelectionChange(['  Co-op ', component.noneTagFilterValue]);
    component.onStatusSelectionChange('playing');
    component.onExcludedStatusSelectionChange(['none', 'dropped']);
    component.onRatingSelectionChange(['none', 4.5]);
    component.onCompatibilitySelectionChange(['perfect', 'playable', 'perfect', 'bad'] as never);
    component.onGameTypeSelectionChange('main_game');

    expect(filtersEmitSpy).toHaveBeenCalled();
    expect(component.draftFilters.platform).toEqual(['Switch']);
    expect(component.draftFilters.tags).toEqual([component.noneTagFilterValue, 'Action']);
    expect(component.draftFilters.excludedTags).toEqual([component.noneTagFilterValue, 'Co-op']);
    expect(component.draftFilters.statuses).toEqual(['playing']);
    expect(component.draftFilters.excludedStatuses).toEqual(['none', 'dropped']);
    expect(component.draftFilters.ratings).toEqual(['none', 4.5]);
    expect(component.draftFilters.compatibility).toEqual(['perfect', 'playable']);
    expect(component.draftFilters.gameTypes).toEqual(['main_game']);
  });

  it('labels compatibility statuses', () => {
    const component = createComponent();
    expect(component.getCompatibilityLabel('perfect')).toBe('Perfect');
    expect(component.getCompatibilityLabel('playable')).toBe('Playable');
    expect(component.getCompatibilityLabel('incomplete')).toBe('Incomplete');
  });

  it('normalizes date and HLTB ranges, and reset restores defaults', () => {
    const component = createComponent();
    const emitSpy = vi.spyOn(component.filtersChange, 'emit');

    component.draftFilters = {
      ...component.draftFilters,
      hltbMainHoursMin: 12,
      hltbMainHoursMax: 5,
    };

    component.onReleaseDateFromChange('2026-04-05T12:30:00.000Z');
    component.onReleaseDateToChange(['2026-04-06']);
    component.onHltbMainHoursMinChange('9.35');
    component.onHltbMainHoursMaxChange('7');

    expect(component.draftFilters.releaseDateFrom).toBe('2026-04-05');
    expect(component.draftFilters.releaseDateTo).toBeNull();
    expect(component.draftFilters.hltbMainHoursMin).toBe(7);
    expect(component.draftFilters.hltbMainHoursMax).toBe(7);

    component.resetFilters();
    expect(component.draftFilters).toEqual({ ...DEFAULT_GAME_LIST_FILTERS });
    expect(component.sortOption).toBe('title:asc');
    expect(emitSpy).toHaveBeenCalled();
  });

  it('returns expected labels for statuses, ratings, and game types', () => {
    const component = createComponent();

    expect(component.getStatusLabel('none')).toBe('None');
    expect(component.getStatusLabel('playing')).toBe('Playing');
    expect(component.getStatusLabel('wantToPlay')).toBe('Want to Play');
    expect(component.getStatusLabel('completed')).toBe('Completed');
    expect(component.getStatusLabel('paused')).toBe('Paused');
    expect(component.getStatusLabel('dropped')).toBe('Dropped');
    expect(component.getStatusLabel('replay')).toBe('Replay');

    expect(component.getRatingLabel('none')).toBe('None');
    expect(component.getRatingLabel(4)).toBe('4');
    expect(component.getGameTypeLabel('main_game')).toBe('Main Game');
    expect(component.getGameTypeLabel('dlc_addon')).toBe('DLC Add-on');
    expect(component.getGameTypeLabel('standalone_expansion')).toBe('Standalone Expansion');
    expect(component.getGameTypeLabel('expanded_game')).toBe('Expanded Game');
    expect(component.getGameTypeLabel('mod')).toBe('Mod');
  });
});
