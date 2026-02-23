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

  it('returns the expected selector title for each metadata kind', () => {
    expect(getMetadataSelectionTitle('series')).toBe('Select Series');
    expect(getMetadataSelectionTitle('developer')).toBe('Select Developer');
    expect(getMetadataSelectionTitle('franchise')).toBe('Select Franchise');
    expect(getMetadataSelectionTitle('genre')).toBe('Select Genre');
    expect(getMetadataSelectionTitle('publisher')).toBe('Select Publisher');
  });

  it('returns values for each metadata kind', () => {
    const game = makeGame({
      collections: ['Series A'],
      developers: ['Dev A'],
      franchises: ['Franchise A'],
      genres: ['Action'],
      publishers: ['Publisher A']
    });

    expect(getMetadataSelectionValues(game, 'series')).toEqual(['Series A']);
    expect(getMetadataSelectionValues(game, 'developer')).toEqual(['Dev A']);
    expect(getMetadataSelectionValues(game, 'franchise')).toEqual(['Franchise A']);
    expect(getMetadataSelectionValues(game, 'genre')).toEqual(['Action']);
    expect(getMetadataSelectionValues(game, 'publisher')).toEqual(['Publisher A']);
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

  it('applies series/developer/franchise/publisher metadata selections', () => {
    expect(
      applyMetadataSelectionToFilters(
        { kind: 'series', value: '  Zelda ' },
        DEFAULT_GAME_LIST_FILTERS
      )
    ).toEqual({
      ...DEFAULT_GAME_LIST_FILTERS,
      collections: ['Zelda']
    });

    expect(
      applyMetadataSelectionToFilters(
        { kind: 'developer', value: '  Nintendo ' },
        DEFAULT_GAME_LIST_FILTERS
      )
    ).toEqual({
      ...DEFAULT_GAME_LIST_FILTERS,
      developers: ['Nintendo']
    });

    expect(
      applyMetadataSelectionToFilters(
        { kind: 'franchise', value: '  Mario ' },
        DEFAULT_GAME_LIST_FILTERS
      )
    ).toEqual({
      ...DEFAULT_GAME_LIST_FILTERS,
      franchises: ['Mario']
    });

    expect(
      applyMetadataSelectionToFilters(
        { kind: 'publisher', value: '  Nintendo ' },
        DEFAULT_GAME_LIST_FILTERS
      )
    ).toEqual({
      ...DEFAULT_GAME_LIST_FILTERS,
      publishers: ['Nintendo']
    });
  });
});
