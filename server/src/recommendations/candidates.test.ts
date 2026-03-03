import assert from 'node:assert/strict';
import test from 'node:test';
import { selectCandidates } from './candidates.js';
import { NormalizedGameRecord } from './types.js';

function buildGame(overrides: Partial<NormalizedGameRecord>): NormalizedGameRecord {
  return {
    igdbGameId: '1',
    platformIgdbId: 1,
    title: 'Game',
    listType: 'collection',
    status: null,
    rating: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    releaseYear: 2020,
    runtimeHours: null,
    summary: null,
    storyline: null,
    reviewScore: null,
    reviewSource: null,
    metacriticScore: null,
    mobyScore: null,
    genres: [],
    developers: [],
    publishers: [],
    franchises: [],
    collections: [],
    themes: [],
    keywords: [],
    ...overrides
  };
}

void test('BACKLOG candidates include only null and wantToPlay statuses', () => {
  const games: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: '1', status: null }),
    buildGame({ igdbGameId: '2', status: 'wantToPlay' }),
    buildGame({ igdbGameId: '3', status: 'playing' }),
    buildGame({ igdbGameId: '4', status: 'paused' }),
    buildGame({ igdbGameId: '5', status: 'replay' }),
    buildGame({ igdbGameId: '6', status: 'completed' }),
    buildGame({ igdbGameId: '7', status: 'dropped' }),
    buildGame({ igdbGameId: '8', listType: 'wishlist', status: 'wantToPlay' })
  ];

  const result = selectCandidates(games, 'BACKLOG');

  assert.deepEqual(
    result.map((game) => game.igdbGameId),
    ['1', '2']
  );
});

void test('WISHLIST candidates exclude completed and dropped', () => {
  const games: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: '1', listType: 'wishlist', status: null }),
    buildGame({ igdbGameId: '2', listType: 'wishlist', status: 'wantToPlay' }),
    buildGame({ igdbGameId: '3', listType: 'wishlist', status: 'paused' }),
    buildGame({ igdbGameId: '4', listType: 'wishlist', status: 'completed' }),
    buildGame({ igdbGameId: '5', listType: 'wishlist', status: 'dropped' }),
    buildGame({ igdbGameId: '6', listType: 'collection', status: null })
  ];

  const result = selectCandidates(games, 'WISHLIST');

  assert.deepEqual(
    result.map((game) => game.igdbGameId),
    ['1', '2', '3']
  );
});
