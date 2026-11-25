import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDiversityPenalty, calculatePairSimilarity, jaccard } from './diversity.js';
import { NormalizedGameRecord } from './types.js';

function buildGame(overrides: Partial<NormalizedGameRecord>): NormalizedGameRecord {
  return {
    igdbGameId: '1',
    platformIgdbId: 1,
    title: 'Game',
    listType: 'collection',
    status: null,
    rating: null,
    createdAt: null,
    updatedAt: null,
    releaseYear: null,
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
    ...overrides,
  };
}

const WEIGHTS = { structuredWeight: 0.6, semanticWeight: 0.4, cosineCalibration: null };

void test('calculateDiversityPenalty applies negative penalty when overlap exists', () => {
  const candidate = {
    game: buildGame({ igdbGameId: '1' }),
    tokenKeys: new Set(['genres:rpg', 'developers:foo']),
    unitEmbedding: null,
  };
  const selected = [
    {
      game: buildGame({ igdbGameId: '2' }),
      tokenKeys: new Set(['genres:rpg', 'developers:foo']),
      unitEmbedding: null,
    },
  ];

  const penalty = calculateDiversityPenalty({
    candidate,
    selected,
    diversityPenaltyWeight: 0.5,
    ...WEIGHTS,
  });

  assert.equal(penalty, -0.5);
  assert.equal(
    calculateDiversityPenalty({ candidate, selected: [], diversityPenaltyWeight: 0.5, ...WEIGHTS }),
    0
  );
  assert.equal(
    calculateDiversityPenalty({ candidate, selected, diversityPenaltyWeight: 0, ...WEIGHTS }),
    0
  );
});

void test('calculatePairSimilarity compares the two games, not their scores against the profile', () => {
  // Same tags, opposite embeddings. The old code compared each game's
  // similarity to the taste centroid, so two unrelated games with equal
  // profile scores counted as semantic twins.
  const left = {
    game: buildGame({ igdbGameId: '1' }),
    tokenKeys: new Set<string>(),
    unitEmbedding: [1, 0],
  };
  const right = {
    game: buildGame({ igdbGameId: '2' }),
    tokenKeys: new Set<string>(),
    unitEmbedding: [0, 1],
  };
  const twin = {
    game: buildGame({ igdbGameId: '3' }),
    tokenKeys: new Set<string>(),
    unitEmbedding: [1, 0],
  };
  const calibration = { low: 0, high: 1 };

  const unrelated = calculatePairSimilarity(left, right, {
    ...WEIGHTS,
    cosineCalibration: calibration,
  });
  const identical = calculatePairSimilarity(left, twin, {
    ...WEIGHTS,
    cosineCalibration: calibration,
  });

  assert.equal(unrelated, 0);
  assert.equal(identical, 0.4);
});

void test('calculatePairSimilarity falls back to tags when an embedding is missing', () => {
  const left = {
    game: buildGame({ igdbGameId: '1' }),
    tokenKeys: new Set(['a', 'b']),
    unitEmbedding: [1, 0],
  };
  const right = {
    game: buildGame({ igdbGameId: '2' }),
    tokenKeys: new Set(['a']),
    unitEmbedding: null,
  };

  assert.equal(calculatePairSimilarity(left, right, WEIGHTS), 0.5);
  assert.equal(
    calculatePairSimilarity(
      left,
      { ...left, game: buildGame({ igdbGameId: '3' }) },
      {
        structuredWeight: 0,
        semanticWeight: 0,
        cosineCalibration: null,
      }
    ),
    1
  );
});

void test('calculateDiversityPenalty uses the closest selected item, not a sum', () => {
  const candidate = {
    game: buildGame({ igdbGameId: '1' }),
    tokenKeys: new Set(['a', 'b']),
    unitEmbedding: null,
  };
  const selected = [
    { game: buildGame({ igdbGameId: '2' }), tokenKeys: new Set(['a']), unitEmbedding: null },
    { game: buildGame({ igdbGameId: '3' }), tokenKeys: new Set(['b']), unitEmbedding: null },
    { game: buildGame({ igdbGameId: '4' }), tokenKeys: new Set(['c']), unitEmbedding: null },
  ];

  // Each overlapping pick has Jaccard 0.5; summing used to stack them toward the cap.
  assert.equal(
    calculateDiversityPenalty({ candidate, selected, diversityPenaltyWeight: 0.5, ...WEIGHTS }),
    -0.25
  );
});

void test('jaccard handles empty and partial overlap', () => {
  assert.equal(jaccard(new Set(), new Set()), 0);
  assert.equal(jaccard(new Set(['a', 'b', 'c']), new Set(['b'])), 1 / 3);
});
