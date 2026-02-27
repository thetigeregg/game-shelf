import { DEFAULT_GAME_LIST_FILTERS } from '../core/models/game.models';
import {
  normalizeListPageGroupBy,
  normalizeListPageStoredFilters,
  parseListPagePreferences,
  serializeListPagePreferences
} from './list-page-preferences';

describe('list-page-preferences', () => {
  it('returns null when no stored preferences exist', () => {
    expect(parseListPagePreferences(null, '__none__')).toBeNull();
    expect(parseListPagePreferences('', '__none__')).toBeNull();
    expect(parseListPagePreferences('  ', '__none__')).toBeNull();
  });

  it('returns null when stored preferences are invalid JSON or non-object JSON', () => {
    expect(parseListPagePreferences('{bad-json', '__none__')).toBeNull();
    expect(parseListPagePreferences('123', '__none__')).toBeNull();
  });

  it('parses legacy sort/group preference shape', () => {
    const parsed = parseListPagePreferences(
      JSON.stringify({
        sortField: 'platform',
        sortDirection: 'desc',
        groupBy: 'platform'
      }),
      '__none__'
    );

    expect(parsed).toEqual({
      filters: {
        ...DEFAULT_GAME_LIST_FILTERS,
        sortField: 'platform',
        sortDirection: 'desc'
      },
      groupBy: 'platform'
    });
  });

  it('normalizes full stored filters and invalid values', () => {
    const normalized = normalizeListPageStoredFilters(
      {
        sortField: 'createdAt',
        sortDirection: 'desc',
        platform: [' Switch ', 'Switch', '', 2],
        collections: [' Backlog ', 'Backlog'],
        developers: ['Nintendo'],
        franchises: ['Zelda'],
        publishers: ['Nintendo', ''],
        gameTypes: ['main_game', 'bad'],
        genres: ['RPG', 'RPG', ''],
        statuses: ['playing', 'invalid'],
        tags: ['Action', '__none__', 'Action', 'RPG'],
        excludedStatuses: ['none', 'playing'],
        excludedTags: ['__none__', 'Spoilers'],
        ratings: [1, 5, 'none', 8],
        hltbMainHoursMin: 25,
        hltbMainHoursMax: 10,
        releaseDateFrom: '2025-02-01T00:00:00.000Z',
        releaseDateTo: 'invalid'
      },
      '__none__'
    );

    expect(normalized).toEqual({
      sortField: 'createdAt',
      sortDirection: 'desc',
      platform: ['Switch'],
      collections: ['Backlog'],
      developers: ['Nintendo'],
      franchises: ['Zelda'],
      publishers: ['Nintendo'],
      gameTypes: ['main_game'],
      genres: ['RPG'],
      statuses: ['playing'],
      tags: ['__none__', 'Action', 'RPG'],
      excludedPlatform: [],
      excludedGenres: [],
      excludedStatuses: ['playing'],
      excludedTags: ['Spoilers'],
      excludedGameTypes: [],
      ratings: [1, 5, 'none'],
      hltbMainHoursMin: 10,
      hltbMainHoursMax: 25,
      releaseDateFrom: '2025-02-01',
      releaseDateTo: null
    });
  });

  it('falls back to defaults when stored filters are not an object', () => {
    const normalized = normalizeListPageStoredFilters(null, '__none__');
    expect(normalized).toEqual(DEFAULT_GAME_LIST_FILTERS);
  });

  it('serializes and restores preferences without dropping filters', () => {
    const original = {
      filters: {
        ...DEFAULT_GAME_LIST_FILTERS,
        sortField: 'releaseDate' as const,
        sortDirection: 'desc' as const,
        platform: ['Nintendo Switch'],
        tags: ['__none__']
      },
      groupBy: 'genre' as const
    };

    const restored = parseListPagePreferences(serializeListPagePreferences(original), '__none__');
    expect(restored).toEqual(original);
  });

  it('accepts hltb as a valid sort field from stored preferences', () => {
    const normalized = normalizeListPageStoredFilters(
      {
        sortField: 'hltb',
        sortDirection: 'asc'
      },
      '__none__'
    );

    expect(normalized.sortField).toBe('hltb');
    expect(normalized.sortDirection).toBe('asc');
  });

  it('accepts metacritic as a valid sort field from stored preferences', () => {
    const normalized = normalizeListPageStoredFilters(
      {
        sortField: 'metacritic',
        sortDirection: 'desc'
      },
      '__none__'
    );

    expect(normalized.sortField).toBe('metacritic');
    expect(normalized.sortDirection).toBe('desc');
  });

  it('normalizes unknown group values to none', () => {
    expect(normalizeListPageGroupBy('genre')).toBe('genre');
    expect(normalizeListPageGroupBy('not-a-group')).toBe('none');
    expect(normalizeListPageGroupBy(null)).toBe('none');
  });
});
