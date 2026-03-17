import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPreferenceProfile, ratingToSignal } from './profile.js';
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
    genres: ['RPG'],
    developers: [],
    publishers: [],
    franchises: [],
    collections: [],
    themes: [],
    keywords: [],
    ...overrides,
  };
}

void test('ratingToSignal maps 1..5 half-step ratings to centered signal', () => {
  assert.equal(ratingToSignal(1), -1);
  assert.equal(ratingToSignal(3), 0);
  assert.equal(ratingToSignal(5), 1);
  assert.equal(ratingToSignal(2.5), -0.25);
  assert.equal(ratingToSignal(null), null);
});

void test('preference profile applies shrinkage to token weights', () => {
  const games: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: '1', rating: 5, genres: ['RPG'] }),
    buildGame({ igdbGameId: '2', rating: 5, genres: ['RPG', 'Action'] }),
    buildGame({ igdbGameId: '3', rating: 1, genres: ['Action'] }),
  ];

  const profile = buildPreferenceProfile(games);

  const rpg = profile.weights.get('genres:rpg');
  const action = profile.weights.get('genres:action');

  assert.equal(profile.ratedGameCount, 3);
  assert.ok(rpg);
  assert.ok(action);

  assert.equal(rpg.count, 2);
  assert.equal(action.count, 2);
  assert.equal(rpg.weight, 2 / 7);
  assert.equal(action.weight, 0);
});
