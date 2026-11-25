import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTasteSignalModel } from './signal.js';
import { computeCorrelation, tuneRecommendationWeights } from './tuning.js';
import { NormalizedGameRecord, TunedRecommendationWeights } from './types.js';

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
    themes: [],
    keywords: [],
    ...overrides,
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
    runtimeWeight: 1,
  };

  const tuned = tuneRecommendationWeights({
    games: [buildGame({ rating: 5 })],
    semanticSimilarityByGame: new Map(),
    minimumRated: 8,
    defaults,
  });

  assert.deepEqual(tuned, defaults);
});

void test('tuneRecommendationWeights preserves mobygames 0-100 critic variance', () => {
  const defaults = {
    tasteWeight: 1,
    semanticWeight: 2,
    criticWeight: 1,
    runtimeWeight: 1,
  };

  const games: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: 'g1', rating: 5, reviewScore: 90, reviewSource: 'mobygames' }),
    buildGame({ igdbGameId: 'g2', rating: 4.5, reviewScore: 85, reviewSource: 'mobygames' }),
    buildGame({ igdbGameId: 'g3', rating: 4, reviewScore: 80, reviewSource: 'mobygames' }),
    buildGame({ igdbGameId: 'g4', rating: 3.5, reviewScore: 70, reviewSource: 'mobygames' }),
    buildGame({ igdbGameId: 'g5', rating: 3, reviewScore: 60, reviewSource: 'mobygames' }),
    buildGame({ igdbGameId: 'g6', rating: 2.5, reviewScore: 50, reviewSource: 'mobygames' }),
    buildGame({ igdbGameId: 'g7', rating: 2, reviewScore: 40, reviewSource: 'mobygames' }),
    buildGame({ igdbGameId: 'g8', rating: 1.5, reviewScore: 30, reviewSource: 'mobygames' }),
  ];

  const tuned = tuneRecommendationWeights({
    games,
    semanticSimilarityByGame: new Map(),
    minimumRated: 8,
    defaults,
  });

  assert.equal(tuned.criticWeight > 0, true);
});

void test('computeCorrelation handles mismatched and zero-variance inputs', () => {
  assert.equal(computeCorrelation([1, 2], [1]), 0);
  assert.equal(computeCorrelation([1, 1, 1], [2, 2, 2]), 0);
});

void test('tuneRecommendationWeights handles NaN ratings and alternate critic fallbacks', () => {
  const defaults = {
    tasteWeight: 1,
    semanticWeight: 2,
    criticWeight: 1,
    runtimeWeight: 1,
  };

  const games: NormalizedGameRecord[] = [
    buildGame({
      igdbGameId: 'g1',
      rating: Number.NaN,
      metacriticScore: 88,
      runtimeHours: 70,
      genres: ['RPG'],
    }),
    buildGame({
      igdbGameId: 'g2',
      rating: 4.5,
      metacriticScore: 82,
      runtimeHours: 12,
      genres: ['RPG'],
    }),
    buildGame({
      igdbGameId: 'g3',
      rating: 4,
      mobyScore: 8.2,
      runtimeHours: 25,
      genres: ['Action'],
    }),
    buildGame({
      igdbGameId: 'g4',
      rating: 3.5,
      reviewScore: 8.5,
      reviewSource: 'mobygames',
      runtimeHours: 5,
      genres: ['Action'],
    }),
    buildGame({ igdbGameId: 'g5', rating: 3, reviewScore: 60, runtimeHours: 18, genres: ['RPG'] }),
    buildGame({
      igdbGameId: 'g6',
      rating: 2.5,
      metacriticScore: 50,
      runtimeHours: null,
      genres: [],
    }),
    buildGame({ igdbGameId: 'g7', rating: 2, mobyScore: 5.5, runtimeHours: 55, genres: [] }),
    buildGame({ igdbGameId: 'g8', rating: 1.5, reviewScore: 35, runtimeHours: 3, genres: [] }),
  ];

  const tuned = tuneRecommendationWeights({
    games,
    semanticSimilarityByGame: new Map([
      ['g2::1', 0.9],
      ['g3::1', 0.7],
      ['g4::1', 0.6],
      ['g5::1', 0.4],
      ['g6::1', 0.2],
      ['g7::1', 0.1],
      ['g8::1', 0.05],
    ]),
    minimumRated: 7,
    defaults,
  });

  assert.equal(Number.isFinite(tuned.tasteWeight), true);
  assert.equal(Number.isFinite(tuned.semanticWeight), true);
  assert.equal(Number.isFinite(tuned.criticWeight), true);
  assert.equal(Number.isFinite(tuned.runtimeWeight), true);
});

const TUNING_DEFAULTS = {
  tasteWeight: 1,
  semanticWeight: 2,
  criticWeight: 1,
  runtimeWeight: 1,
};
const RATINGS = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5];

void test('tuneRecommendationWeights never tunes the runtime weight away', () => {
  // Ratings fall as runtime grows: the old tuner turned this into runtimeWeight 0,
  // which silently disabled SHORT mode for exactly this user.
  const games = RATINGS.map((rating, index) =>
    buildGame({ igdbGameId: `g${String(index)}`, rating, runtimeHours: 5 + index * 10 })
  );

  const tuned = tuneRecommendationWeights({
    games,
    semanticSimilarityByGame: new Map(),
    minimumRated: 8,
    defaults: TUNING_DEFAULTS,
  });

  assert.equal(tuned.runtimeWeight, TUNING_DEFAULTS.runtimeWeight);
});

void test('tuneRecommendationWeights scores taste leave-one-out so unique tags cannot self-predict', () => {
  // Every game has its own developer. Including each game's own rating in the
  // profile made taste correlate perfectly with ratings; held out, no game
  // shares a tag with any other, so taste carries no signal.
  const games = RATINGS.map((rating, index) =>
    buildGame({ igdbGameId: `g${String(index)}`, rating, developers: [`Dev ${String(index)}`] })
  );

  const tuned = tuneRecommendationWeights({
    games,
    semanticSimilarityByGame: new Map(),
    minimumRated: 8,
    defaults: TUNING_DEFAULTS,
  });

  assert.equal(tuned.tasteWeight, 0.5);
});

void test('tuneRecommendationWeights still rewards taste tags shared across rated games', () => {
  const games = RATINGS.map((rating, index) =>
    buildGame({ igdbGameId: `g${String(index)}`, rating, genres: [index < 4 ? 'RPG' : 'Sport'] })
  );

  const tuned = tuneRecommendationWeights({
    games,
    semanticSimilarityByGame: new Map(),
    minimumRated: 8,
    defaults: TUNING_DEFAULTS,
  });

  assert.ok(tuned.tasteWeight > 2);
});

void test('tuneRecommendationWeights lets status-only games inform taste without being targets', () => {
  // Each rated game has its own developer, shared only with an unrated
  // companion that was completed (if the rated game was liked) or dropped.
  const games = RATINGS.flatMap((rating, index) => [
    buildGame({ igdbGameId: `g${String(index)}`, rating, developers: [`Dev ${String(index)}`] }),
    buildGame({
      igdbGameId: `s${String(index)}`,
      status: rating >= 3.5 ? 'completed' : 'dropped',
      developers: [`Dev ${String(index)}`],
    }),
  ]);
  const signalModel = buildTasteSignalModel(games, {
    ratingMeanCenterWeight: 0,
    statusSignalWeight: 1,
  });
  const tune = (minimumRated: number, withStatus: boolean): TunedRecommendationWeights =>
    tuneRecommendationWeights({
      games,
      semanticSimilarityByGame: new Map(),
      minimumRated,
      defaults: TUNING_DEFAULTS,
      signalModel: withStatus ? signalModel : undefined,
    });

  assert.equal(tune(8, false).tasteWeight, 0.5);
  assert.ok(tune(8, true).tasteWeight > 2);
  // Only the 8 rated games are prediction targets.
  assert.deepEqual(tune(9, true), TUNING_DEFAULTS);
});

void test('tuneRecommendationWeights computes semantic similarity leave-one-out from embeddings', () => {
  const unitVector = (axis: number): number[] =>
    Array.from({ length: 8 }, (_, index) => (index === axis ? 1 : 0));
  const games = RATINGS.map((rating, index) =>
    buildGame({ igdbGameId: `g${String(index)}`, rating })
  );

  // Orthogonal embeddings: each liked game only resembles itself.
  const orthogonal = new Map(
    games.map((game, index) => [`${game.igdbGameId}::1`, unitVector(index)])
  );
  const isolated = tuneRecommendationWeights({
    games,
    semanticSimilarityByGame: new Map(),
    embeddingsByGame: orthogonal,
    minimumRated: 8,
    defaults: TUNING_DEFAULTS,
  });
  assert.equal(isolated.semanticWeight, 0.5);

  // Liked games share a direction, disliked games point elsewhere.
  const clustered = new Map(
    games.map((game, index) => [
      `${game.igdbGameId}::1`,
      index < 4 ? [1, 0.1 * index, 0, 0] : [0, 0.1 * index, 1, 0],
    ])
  );
  const tuned = tuneRecommendationWeights({
    games,
    semanticSimilarityByGame: new Map(),
    embeddingsByGame: clustered,
    minimumRated: 8,
    defaults: TUNING_DEFAULTS,
  });
  assert.ok(tuned.semanticWeight > 2);
});
