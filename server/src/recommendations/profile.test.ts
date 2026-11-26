import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPreferenceProfile } from './profile.js';
import { buildTasteSignalModel } from './signal.js';
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

void test('preference profile uses cleaned structured keywords when provided', () => {
  const game = buildGame({ igdbGameId: '1', rating: 5, keywords: ['Turn-based'] });
  const structuredKeywordsByGame = new Map([['1::1', ['turn-based combat']]]);

  const raw = buildPreferenceProfile([game]);
  const cleaned = buildPreferenceProfile([game], { structuredKeywordsByGame });

  assert.ok(raw.weights.has('keywords:turn-based'));
  assert.equal(cleaned.weights.has('keywords:turn-based'), false);
  assert.ok(cleaned.weights.has('keywords:turn-based combat'));
});

void test('preference profile uses the signal model, including status-only games', () => {
  const games: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: '1', rating: 4, genres: ['RPG'] }),
    buildGame({ igdbGameId: '2', status: 'dropped', genres: ['Sport'] }),
    buildGame({ igdbGameId: '3', status: 'wantToPlay', genres: ['Racing'] }),
    buildGame({ igdbGameId: '4', status: 'completed', genres: ['RPG'] }),
  ];

  const withoutStatus = buildPreferenceProfile(games);
  assert.equal(withoutStatus.ratedGameCount, 1);
  assert.equal(withoutStatus.weights.get('genres:sport'), undefined);

  const signalModel = buildTasteSignalModel(games, {
    ratingMeanCenterWeight: 0,
    statusSignalWeight: 1,
  });
  const withStatus = buildPreferenceProfile(games, { signalModel });
  // Status-only games feed the weights but not the rated-games gate.
  assert.equal(withStatus.ratedGameCount, 1);
  // The unrated completed RPG is a neutral sighting: it adds to the count, not the sum.
  assert.equal(withStatus.weights.get('genres:rpg')?.sum, 0.5);
  assert.equal(withStatus.weights.get('genres:rpg')?.count, 2);
  assert.equal(withStatus.weights.get('genres:sport')?.sum, -0.75);
  assert.equal(withStatus.weights.get('genres:racing'), undefined);
});
