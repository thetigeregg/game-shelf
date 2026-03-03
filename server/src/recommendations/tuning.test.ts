import assert from 'node:assert/strict';
import test from 'node:test';
import { computeCorrelation, tuneRecommendationWeights } from './tuning.js';
import { NormalizedGameRecord } from './types.js';

function buildGame(overrides: Partial<NormalizedGameRecord>): NormalizedGameRecord {
  return {
    igdbGameId: '1',
    platformIgdbId: 1,
    title: 'Game',
    listType: 'collection',
    status: null,
    rating: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
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
    ...overrides
  };
}

void test('computeCorrelation returns expected sign', () => {
  assert.equal(computeCorrelation([1, 2, 3], [1, 2, 3]) > 0.99, true);
  assert.equal(computeCorrelation([1, 2, 3], [3, 2, 1]) < -0.99, true);
  assert.equal(computeCorrelation([1], [1]), 0);
});

void test('tuneRecommendationWeights falls back when sample is too small', () => {
  const defaults = {
    tasteWeight: 1,
    semanticWeight: 2,
    criticWeight: 1,
    runtimeWeight: 1
  };

  const tuned = tuneRecommendationWeights({
    games: [buildGame({ rating: 5 })],
    semanticSimilarityByGame: new Map(),
    minimumRated: 8,
    defaults
  });

  assert.deepEqual(tuned, defaults);
});

void test('tuneRecommendationWeights preserves mobygames 0-100 critic variance', () => {
  const defaults = {
    tasteWeight: 1,
    semanticWeight: 2,
    criticWeight: 1,
    runtimeWeight: 1
  };

  const games: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: 'g1', rating: 5, reviewScore: 90, reviewSource: 'mobygames' }),
    buildGame({ igdbGameId: 'g2', rating: 4.5, reviewScore: 85, reviewSource: 'mobygames' }),
    buildGame({ igdbGameId: 'g3', rating: 4, reviewScore: 80, reviewSource: 'mobygames' }),
    buildGame({ igdbGameId: 'g4', rating: 3.5, reviewScore: 70, reviewSource: 'mobygames' }),
    buildGame({ igdbGameId: 'g5', rating: 3, reviewScore: 60, reviewSource: 'mobygames' }),
    buildGame({ igdbGameId: 'g6', rating: 2.5, reviewScore: 50, reviewSource: 'mobygames' }),
    buildGame({ igdbGameId: 'g7', rating: 2, reviewScore: 40, reviewSource: 'mobygames' }),
    buildGame({ igdbGameId: 'g8', rating: 1.5, reviewScore: 30, reviewSource: 'mobygames' })
  ];

  const tuned = tuneRecommendationWeights({
    games,
    semanticSimilarityByGame: new Map(),
    minimumRated: 8,
    defaults
  });

  assert.equal(tuned.criticWeight > 0, true);
});
