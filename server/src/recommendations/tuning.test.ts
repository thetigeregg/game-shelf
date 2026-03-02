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
