import { DEFAULT_GAME_LIST_FILTERS } from '../core/models/game.models';
import { ListPageComponent } from './list-page.component';

describe('ListPageComponent metadata filter selection', () => {
  it('applies genre selection as a list filter and resets search', () => {
    const persistPreferences = vi.fn();
    const componentLike = {
      filters: { ...DEFAULT_GAME_LIST_FILTERS, platform: ['Nintendo Switch'] },
      listSearchQueryInput: 'zelda',
      listSearchQuery: 'zelda',
      persistPreferences
    };

    ListPageComponent.prototype.onMetadataFilterSelected.call(componentLike, {
      kind: 'genre',
      value: '  RPG '
    });

    expect(componentLike.filters).toEqual({
      ...DEFAULT_GAME_LIST_FILTERS,
      genres: ['RPG']
    });
    expect(componentLike.listSearchQueryInput).toBe('');
    expect(componentLike.listSearchQuery).toBe('');
    expect(persistPreferences).toHaveBeenCalledTimes(1);
  });

  it('ignores empty metadata values', () => {
    const persistPreferences = vi.fn();
    const originalFilters = { ...DEFAULT_GAME_LIST_FILTERS, developers: ['Nintendo'] };
    const componentLike = {
      filters: originalFilters,
      listSearchQueryInput: 'mario',
      listSearchQuery: 'mario',
      persistPreferences
    };

    ListPageComponent.prototype.onMetadataFilterSelected.call(componentLike, {
      kind: 'genre',
      value: '   '
    });

    expect(componentLike.filters).toEqual(originalFilters);
    expect(componentLike.listSearchQueryInput).toBe('mario');
    expect(componentLike.listSearchQuery).toBe('mario');
    expect(persistPreferences).not.toHaveBeenCalled();
  });
});
