import { describe, expect, it } from 'vitest';

import type { GameEntry, Tag } from '../../core/models/game.models';
import {
  buildTagInput,
  hasHltbData,
  hasMetacriticData,
  hasReviewData,
  normalizeGameRating,
  normalizeGameStatus,
  normalizeTagIds,
  parseTagSelection
} from './game-list-detail-actions';

function makeGame(overrides: Partial<GameEntry> = {}): GameEntry {
  return {
    igdbGameId: '1',
    title: 'Chrono Trigger',
    coverUrl: null,
    coverSource: 'none',
    platform: 'SNES',
    platformIgdbId: 19,
    releaseDate: null,
    releaseYear: 1995,
    listType: 'collection',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('game-list-detail-actions', () => {
  it('detects hltb and review data', () => {
    expect(hasHltbData(makeGame({ hltbMainHours: 10 }))).toBe(true);
    expect(hasHltbData(makeGame({ hltbMainHours: 0 }))).toBe(false);

    expect(hasReviewData(makeGame({ reviewScore: 90 }))).toBe(true);
    expect(hasReviewData(makeGame({ reviewScore: 0 }))).toBe(false);
    expect(hasMetacriticData(makeGame({ metacriticScore: 88 }))).toBe(true);
  });

  it('normalizes status and rating values', () => {
    expect(normalizeGameStatus('playing')).toBe('playing');
    expect(normalizeGameStatus('invalid')).toBeNull();

    expect(normalizeGameRating(5)).toBe(5);
    expect(normalizeGameRating('3')).toBe(3);
    expect(normalizeGameRating('0')).toBeNull();
  });

  it('builds and parses tag selections', () => {
    const tag: Tag = {
      id: 5,
      name: 'JRPG',
      color: '#fff',
      createdAt: 'x',
      updatedAt: 'x'
    };
    expect(buildTagInput(tag, [5])).toEqual({
      type: 'checkbox',
      label: 'JRPG',
      value: '5',
      checked: true
    });
    expect(buildTagInput({ ...tag, id: 0 }, [0]).value).toBe('-1');

    expect(parseTagSelection(['1', '2', 'abc'])).toEqual([1, 2]);
    expect(parseTagSelection('3')).toEqual([3]);
    expect(parseTagSelection(null)).toEqual([]);
    expect(normalizeTagIds([1, 2, 2, 0, -1, 3.6])).toEqual([1, 2]);
  });
});
