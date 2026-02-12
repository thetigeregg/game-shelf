import {
  isGameRatingFilterOption,
  isGameStatusFilterOption,
  isGameType,
  normalizeGameRatingFilterList,
  normalizeGameStatusFilterList,
  normalizeGameTypeList,
  normalizeNonNegativeNumber,
  normalizeStringList,
  normalizeTagFilterList,
} from './game-filter-utils';

describe('game-filter-utils', () => {
  it('normalizes string lists', () => {
    expect(normalizeStringList([' A ', 'A', '', 'B', 123] as unknown)).toEqual(['A', 'B']);
    expect(normalizeStringList('not-array')).toEqual([]);
  });

  it('validates and normalizes game types', () => {
    expect(isGameType('main_game')).toBe(true);
    expect(isGameType('unknown')).toBe(false);
    expect(normalizeGameTypeList(['main_game', 'expansion', 'main_game', 'bad'])).toEqual(['main_game', 'expansion']);
    expect(normalizeGameTypeList('not-array')).toEqual([]);
  });

  it('validates and normalizes status filters', () => {
    expect(isGameStatusFilterOption('none')).toBe(true);
    expect(isGameStatusFilterOption('playing')).toBe(true);
    expect(isGameStatusFilterOption('invalid')).toBe(false);
    expect(normalizeGameStatusFilterList(['playing', 'none', 'playing', 'x'])).toEqual(['playing', 'none']);
    expect(normalizeGameStatusFilterList(null)).toEqual([]);
  });

  it('validates and normalizes rating filters', () => {
    expect(isGameRatingFilterOption('none')).toBe(true);
    expect(isGameRatingFilterOption(5)).toBe(true);
    expect(isGameRatingFilterOption(6)).toBe(false);
    expect(normalizeGameRatingFilterList([1, 2, 'none', 2, 99])).toEqual([1, 2, 'none']);
    expect(normalizeGameRatingFilterList(undefined)).toEqual([]);
  });

  it('normalizes non-negative numbers', () => {
    expect(normalizeNonNegativeNumber(1.26)).toBe(1.3);
    expect(normalizeNonNegativeNumber(0)).toBe(0);
    expect(normalizeNonNegativeNumber(-1)).toBeNull();
    expect(normalizeNonNegativeNumber(Number.NaN)).toBeNull();
    expect(normalizeNonNegativeNumber('1.2')).toBeNull();
  });

  it('normalizes tag filter list and keeps none first', () => {
    expect(normalizeTagFilterList(['Action', '__none__', ' Action '], '__none__')).toEqual(['__none__', 'Action']);
    expect(normalizeTagFilterList(['Action', 'RPG'], '__none__')).toEqual(['Action', 'RPG']);
  });
});
