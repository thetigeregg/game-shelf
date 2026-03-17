import { DEFAULT_GAME_LIST_FILTERS } from '../../core/models/game.models';
import {
  applyMetadataSelectionToFilters,
  getMetadataSelectionTitle,
  getMetadataSelectionValues
} from './metadata-filter.utils';

describe('game list metadata filter selection', () => {
  it('returns genre selector title and values', () => {
    expect(getMetadataSelectionTitle('genre')).toBe('Select Genre');
    expect(
      getMetadataSelectionValues(
        {
          collections: ['Series'],
          developers: ['Dev'],
          franchises: ['Franchise'],
          genres: ['RPG'],
          publishers: ['Pub']
        },
        'genre'
      )
    ).toEqual(['RPG']);
  });

  it('normalizes and applies selected genre filter', () => {
    expect(
      applyMetadataSelectionToFilters(
        {
          kind: 'genre',
          value: '  Action  '
        },
        DEFAULT_GAME_LIST_FILTERS
      )
    ).toEqual({
      ...DEFAULT_GAME_LIST_FILTERS,
      genres: ['Action']
    });
  });
});
