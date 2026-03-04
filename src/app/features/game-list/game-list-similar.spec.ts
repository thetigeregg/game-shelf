import { describe, expect, it } from 'vitest';

import type { GameEntry } from '../../core/models/game.models';
import { findSimilarLibraryGames, normalizeSimilarGameIds } from './game-list-similar';

function makeGame(overrides: Partial<GameEntry> = {}): GameEntry {
  return {
    igdbGameId: '1',
    title: 'Base',
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

describe('game-list-similar', () => {
  it('normalizes similar game ids to trimmed numeric unique values', () => {
    expect(normalizeSimilarGameIds(undefined)).toEqual([]);
    expect(normalizeSimilarGameIds([' 123 ', 'abc', '001', '123', ' '])).toEqual(['123', '001']);
  });

  it('finds similar games in library excluding current platform+game', () => {
    const current = makeGame({ igdbGameId: '10', platformIgdbId: 19, title: 'Chrono Trigger' });
    const dsVariant = makeGame({
      igdbGameId: '10',
      platformIgdbId: 37,
      title: 'Chrono Trigger DS'
    });
    const earthbound = makeGame({ igdbGameId: '11', title: 'EarthBound' });
    const superMetroid = makeGame({ igdbGameId: '12', title: 'Super Metroid' });
    const whitespaceId = makeGame({ igdbGameId: ' 11 ', title: 'EarthBound Copy' });

    const result = findSimilarLibraryGames({
      currentGame: current,
      libraryGames: [current, dsVariant, earthbound, superMetroid, whitespaceId],
      similarIds: ['11', '10'],
      compareTitles: (left, right) => left.localeCompare(right)
    });

    expect(result.map((game) => game.title)).toEqual([
      'Chrono Trigger DS',
      'EarthBound',
      'EarthBound Copy'
    ]);
  });
});
