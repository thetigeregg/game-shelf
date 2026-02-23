import { DEFAULT_GAME_LIST_FILTERS, GameEntry } from '../../core/models/game.models';
import {
  applyMetadataSelectionToFilters,
  getMetadataSelectionTitle,
  getMetadataSelectionValues
} from './metadata-filter.utils';

function makeGame(partial: Partial<GameEntry>): GameEntry {
  return {
    igdbGameId: '1',
    platformIgdbId: 130,
    title: 'Test',
    coverUrl: null,
    coverSource: 'none',
    platform: 'Nintendo Switch',
    releaseDate: null,
    releaseYear: null,
    listType: 'collection',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial
  };
}

describe('metadata-filter utils', () => {
  it('returns genre values and title for genre selection', () => {
    const game = makeGame({
      genres: ['RPG', 'Action']
    });

    expect(getMetadataSelectionValues(game, 'genre')).toEqual(['RPG', 'Action']);
    expect(getMetadataSelectionTitle('genre')).toBe('Select Genre');
  });

  it('applies genre metadata selection to list filters', () => {
    const nextFilters = applyMetadataSelectionToFilters(
      { kind: 'genre', value: '  RPG ' },
      DEFAULT_GAME_LIST_FILTERS
    );

    expect(nextFilters).toEqual({
      ...DEFAULT_GAME_LIST_FILTERS,
      genres: ['RPG']
    });
  });

  it('returns default filters when metadata selection is empty', () => {
    const nextFilters = applyMetadataSelectionToFilters(
      { kind: 'genre', value: '   ' },
      DEFAULT_GAME_LIST_FILTERS
    );

    expect(nextFilters).toEqual(DEFAULT_GAME_LIST_FILTERS);
  });
});
