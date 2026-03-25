import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_GAME_LIST_FILTERS } from '../core/models/game.models';
import {
  escapeCsvValue,
  normalizeColor,
  normalizeCoverSource,
  normalizeGroupBy,
  normalizeListType,
  normalizeRating,
  normalizeStatus,
  parseFilters,
  parseGameIdArray,
  parseOptionalCustomCoverUrl,
  parseOptionalDataImage,
  parseOptionalDecimal,
  parseOptionalGameType,
  parseOptionalNumber,
  parseOptionalText,
  parsePositiveInteger,
  parsePositiveIntegerArray,
  parseStringArray,
} from './settings-import-export.utils';

describe('settings-import-export.utils', () => {
  afterEach(() => {
    delete window.__GAME_SHELF_RUNTIME_CONFIG__;
  });

  it('parses string and game id arrays safely', () => {
    expect(parseStringArray('   ')).toEqual([]);
    expect(parseStringArray('{"items":[]}')).toEqual([]);
    expect(parseStringArray('[" Action ", "", "Action", 1]')).toEqual(['Action']);
    expect(parseStringArray('not-json')).toEqual([]);

    expect(parseGameIdArray('   ')).toEqual([]);
    expect(parseGameIdArray('[1,"2"," x ",2]')).toEqual(['1', '2']);
    expect(parseGameIdArray('{"a":1}')).toEqual([]);
    expect(parseGameIdArray('not-json')).toEqual([]);
  });

  it('parses optional field primitives', () => {
    expect(parseOptionalText('  test  ')).toBe('test');
    expect(parseOptionalText('  ')).toBeNull();

    expect(parseOptionalDataImage('   ')).toBeNull();
    expect(parseOptionalDataImage('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    expect(parseOptionalDataImage('https://x')).toBeNull();
    expect(parseOptionalCustomCoverUrl('   ')).toBeNull();
    expect(parseOptionalCustomCoverUrl('data:image/png;base64,abc')).toBe(
      'data:image/png;base64,abc'
    );
    expect(parseOptionalCustomCoverUrl(' https://x ')).toBe('https://x/');
    expect(parseOptionalCustomCoverUrl('https://user:pass@x')).toBeNull();
    expect(parseOptionalCustomCoverUrl('ftp://x')).toBeNull();

    expect(parseOptionalGameType('   ')).toBeNull();
    expect(parseOptionalGameType(' remake ')).toBe('remake');
    expect(parseOptionalGameType('invalid')).toBeNull();

    expect(parseOptionalNumber(' 42 ')).toBe(42);
    expect(parseOptionalNumber('')).toBeNull();
    expect(parseOptionalNumber('4.7')).toBe(4);
    expect(parseOptionalDecimal('8.6')).toBe(8.6);
    expect(parseOptionalDecimal('0')).toBeNull();
    expect(parseOptionalDecimal('')).toBeNull();

    expect(parsePositiveInteger('7')).toBe(7);
    expect(parsePositiveInteger('-1')).toBeNull();
    expect(parsePositiveInteger('')).toBeNull();
    expect(parsePositiveIntegerArray('   ')).toEqual([]);
    expect(parsePositiveIntegerArray('{"items":[]}')).toEqual([]);
    expect(parsePositiveIntegerArray('not-json')).toEqual([]);
    expect(parsePositiveIntegerArray('[1,2,2,0,-1,\"3\"]')).toEqual([1, 2, 3]);
  });

  it('normalizes list/group/status/rating/cover/color fields', () => {
    expect(normalizeListType('collection')).toBe('collection');
    expect(normalizeListType('x')).toBeNull();

    expect(normalizeGroupBy('platform')).toBe('platform');
    expect(normalizeGroupBy('x')).toBeNull();

    expect(normalizeStatus('replay')).toBe('replay');
    expect(normalizeStatus('x')).toBeNull();

    expect(normalizeRating('')).toBeNull();
    expect(normalizeRating('5')).toBe(5);
    expect(normalizeRating('4.5')).toBe(4.5);
    expect(normalizeRating('4.7')).toBeNull();
    expect(normalizeRating('9')).toBeNull();

    expect(normalizeCoverSource('igdb')).toBe('igdb');
    expect(normalizeCoverSource('x')).toBe('none');

    expect(normalizeColor('#aBc123')).toBe('#aBc123');
    expect(normalizeColor('bad')).toBe('#3880ff');
  });

  it('escapes CSV fields when needed', () => {
    expect(escapeCsvValue('plain')).toBe('plain');
    expect(escapeCsvValue('has,comma')).toBe('"has,comma"');
    expect(escapeCsvValue('has "quote"')).toBe('"has ""quote"""');
  });

  it('parses filters with normalization and backward-compatible metacritic sort', () => {
    const parsed = parseFilters(
      JSON.stringify({
        platform: ['SNES', 123],
        gameTypes: ['main_game', 'bad'],
        statuses: ['none', 'playing', 'replay', 'bad'],
        excludedStatuses: ['replay', 'bad'],
        ratings: ['none', 1, 4.5, 5, 7],
        excludedTags: ['tag-a', '__none__'],
        sortField: 'metacritic',
        sortDirection: 'desc',
        hltbMainHoursMin: 20.2,
        hltbMainHoursMax: 10.1,
      }),
      DEFAULT_GAME_LIST_FILTERS
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.platform).toEqual(['SNES']);
    expect(parsed?.gameTypes).toEqual(['main_game']);
    expect(parsed?.statuses).toEqual(['none', 'playing', 'replay']);
    expect(parsed?.excludedStatuses).toEqual(['replay']);
    expect(parsed?.ratings).toEqual(['none', 1, 4.5, 5]);
    expect(parsed?.excludedTags).toEqual(['tag-a']);
    expect(parsed?.sortField).toBe('review');
    expect(parsed?.sortDirection).toBe('desc');
    expect(parsed?.hltbMainHoursMin).toBe(10.1);
    expect(parsed?.hltbMainHoursMax).toBe(20.2);
  });

  it('returns defaults for empty filters and null for invalid json', () => {
    expect(parseFilters('', DEFAULT_GAME_LIST_FILTERS)).toEqual({ ...DEFAULT_GAME_LIST_FILTERS });
    expect(parseFilters('not-json', DEFAULT_GAME_LIST_FILTERS)).toBeNull();
  });

  it('falls back from tas sort field in parsed filters when tas feature is disabled', () => {
    const parsed = parseFilters(
      JSON.stringify({
        sortField: 'tas',
        sortDirection: 'asc',
      }),
      DEFAULT_GAME_LIST_FILTERS
    );

    expect(parsed?.sortField).toBe(DEFAULT_GAME_LIST_FILTERS.sortField);
    expect(parsed?.sortDirection).toBe('asc');
  });

  it('accepts tas sort field in parsed filters when tas feature is enabled', () => {
    window.__GAME_SHELF_RUNTIME_CONFIG__ = { featureFlags: { tasEnabled: true } };
    const parsed = parseFilters(
      JSON.stringify({
        sortField: 'tas',
        sortDirection: 'asc',
      }),
      DEFAULT_GAME_LIST_FILTERS
    );

    expect(parsed?.sortField).toBe('tas');
    expect(parsed?.sortDirection).toBe('asc');
  });

  it('falls back from price sort field for collection views during import parsing', () => {
    const parsed = parseFilters(
      JSON.stringify({
        sortField: 'price',
        sortDirection: 'desc',
      }),
      DEFAULT_GAME_LIST_FILTERS,
      { listType: 'collection' }
    );

    expect(parsed?.sortField).toBe(DEFAULT_GAME_LIST_FILTERS.sortField);
    expect(parsed?.sortDirection).toBe('desc');
  });

  it('accepts price sort field for wishlist views during import parsing', () => {
    const parsed = parseFilters(
      JSON.stringify({
        sortField: 'price',
        sortDirection: 'desc',
      }),
      DEFAULT_GAME_LIST_FILTERS,
      { listType: 'wishlist' }
    );

    expect(parsed?.sortField).toBe('price');
    expect(parsed?.sortDirection).toBe('desc');
  });

  it('parses optional filter arrays and drops invalid excluded game types', () => {
    const parsed = parseFilters(
      JSON.stringify({
        collections: ['Collection A', 1],
        developers: ['Nintendo', 2],
        franchises: ['Mario', null],
        publishers: ['Nintendo', false],
        genres: ['Action', 1],
        tags: ['tag-a', 2],
        excludedPlatform: ['SNES', false],
        excludedGenres: ['Puzzle', null],
        excludedGameTypes: ['expansion', 'invalid'],
      }),
      DEFAULT_GAME_LIST_FILTERS
    );

    expect(parsed?.genres).toEqual(['Action']);
    expect(parsed?.tags).toEqual(['tag-a']);
    expect(parsed?.collections).toEqual(['Collection A']);
    expect(parsed?.developers).toEqual(['Nintendo']);
    expect(parsed?.franchises).toEqual(['Mario']);
    expect(parsed?.publishers).toEqual(['Nintendo']);
    expect(parsed?.excludedPlatform).toEqual(['SNES']);
    expect(parsed?.excludedGenres).toEqual(['Puzzle']);
    expect(parsed?.excludedGameTypes).toEqual(['expansion']);
  });
});
