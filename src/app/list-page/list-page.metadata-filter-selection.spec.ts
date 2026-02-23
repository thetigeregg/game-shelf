import { DEFAULT_GAME_LIST_FILTERS } from '../core/models/game.models';
import { applyMetadataSelectionToFilters } from '../features/game-list/metadata-filter.utils';

describe('List-page metadata filter selection', () => {
  it('applies genre selection as a list filter and resets search', () => {
    expect(
      applyMetadataSelectionToFilters({
        kind: 'genre',
        value: '  RPG '
      })
    ).toEqual({
      ...DEFAULT_GAME_LIST_FILTERS,
      genres: ['RPG']
    });
  });

  it('ignores empty metadata values', () => {
    expect(
      applyMetadataSelectionToFilters({
        kind: 'genre',
        value: '   '
      })
    ).toEqual(DEFAULT_GAME_LIST_FILTERS);
  });
});
