import { describe, expect, it } from 'vitest';

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
  parseOptionalDataImage,
  parseOptionalDecimal,
  parseOptionalGameType,
  parseOptionalNumber,
  parseOptionalText,
  parsePositiveInteger,
  parsePositiveIntegerArray,
  parseStringArray
} from './settings-import-export.utils';

describe('settings-import-export.utils', () => {
  it('parses string and game id arrays safely', () => {
    expect(parseStringArray('[" Action ", "", "Action", 1]')).toEqual(['Action']);
    expect(parseStringArray('not-json')).toEqual([]);

    expect(parseGameIdArray('[1,"2"," x ",2]')).toEqual(['1', '2']);
    expect(parseGameIdArray('{"a":1}')).toEqual([]);
  });

  it('parses optional field primitives', () => {
    expect(parseOptionalText('  test  ')).toBe('test');
    expect(parseOptionalText('  ')).toBeNull();

    expect(parseOptionalDataImage('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    expect(parseOptionalDataImage('https://x')).toBeNull();

    expect(parseOptionalGameType(' remake ')).toBe('remake');
    expect(parseOptionalGameType('invalid')).toBeNull();

    expect(parseOptionalNumber(' 42 ')).toBe(42);
    expect(parseOptionalNumber('')).toBeNull();
    expect(parseOptionalDecimal('8.6')).toBe(8.6);
    expect(parseOptionalDecimal('0')).toBeNull();

    expect(parsePositiveInteger('7')).toBe(7);
    expect(parsePositiveInteger('-1')).toBeNull();
    expect(parsePositiveIntegerArray('[1,2,2,0,-1,\"3\"]')).toEqual([1, 2, 3]);
  });

  it('normalizes list/group/status/rating/cover/color fields', () => {
    expect(normalizeListType('collection')).toBe('collection');
    expect(normalizeListType('x')).toBeNull();

    expect(normalizeGroupBy('platform')).toBe('platform');
    expect(normalizeGroupBy('x')).toBeNull();

    expect(normalizeStatus('replay')).toBe('replay');
    expect(normalizeStatus('x')).toBeNull();

    expect(normalizeRating('5')).toBe(5);
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
        ratings: ['none', 1, 5, 7],
        excludedTags: ['tag-a', '__none__'],
        sortField: 'metacritic',
        sortDirection: 'desc',
        hltbMainHoursMin: 20.2,
        hltbMainHoursMax: 10.1
      }),
      DEFAULT_GAME_LIST_FILTERS
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.platform).toEqual(['SNES']);
    expect(parsed?.gameTypes).toEqual(['main_game']);
    expect(parsed?.statuses).toEqual(['none', 'playing', 'replay']);
    expect(parsed?.excludedStatuses).toEqual(['replay']);
    expect(parsed?.ratings).toEqual(['none', 1, 5]);
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
});
