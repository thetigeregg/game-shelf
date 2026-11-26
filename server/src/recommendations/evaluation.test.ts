import assert from 'node:assert/strict';
import test from 'node:test';
import { computeAuc, computePercentile, evaluateRecommendationQuality } from './evaluation.js';
import { RECOMMENDATION_SCORING_DEFAULTS } from './scoring-defaults.js';
import { NormalizedGameRecord } from './types.js';

function buildGame(overrides: Partial<NormalizedGameRecord>): NormalizedGameRecord {
  return {
    igdbGameId: '1',
    platformIgdbId: 6,
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
    similarGameIgdbIds: [],
    ...overrides,
  };
}

function buildLibrary(): NormalizedGameRecord[] {
  const games: NormalizedGameRecord[] = [];

  for (let index = 0; index < 8; index += 1) {
    games.push(
      buildGame({
        igdbGameId: `rpg-${String(index)}`,
        title: `RPG ${String(index)}`,
        status: 'completed',
        rating: 5,
        genres: ['Role-playing (RPG)'],
        themes: ['Fantasy'],
      })
    );
    games.push(
      buildGame({
        igdbGameId: `sport-${String(index)}`,
        title: `Sport ${String(index)}`,
        status: 'dropped',
        rating: 1.5,
        genres: ['Sport'],
        themes: ['Comedy'],
      })
    );
  }

  for (let index = 0; index < 20; index += 1) {
    const isRpg = index % 4 === 0;
    games.push(
      buildGame({
        igdbGameId: `backlog-${String(index)}`,
        title: `Backlog ${String(index)}`,
        genres: isRpg ? ['Role-playing (RPG)'] : ['Racing'],
        themes: isRpg ? ['Fantasy'] : ['Action'],
      })
    );
  }

  return games;
}

void test('computePercentile counts strictly-higher scores and half of ties', () => {
  const pool = [{ total: 3 }, { total: 2 }, { total: 2 }, { total: 1 }];

  assert.equal(computePercentile(4, pool), 0);
  assert.equal(computePercentile(2, pool), (1 + 1) / 4);
  assert.equal(computePercentile(0, pool), 1);
  assert.equal(computePercentile(1, []), 0);
});

void test('computeAuc measures pairwise ordering and needs both classes', () => {
  assert.equal(computeAuc([3, 4], [1, 2]), 1);
  assert.equal(computeAuc([1], [2]), 0);
  assert.equal(computeAuc([2], [2]), 0.5);
  assert.equal(computeAuc([1], []), null);
});

void test('evaluateRecommendationQuality rewards a profile that separates liked from disliked', () => {
  const result = evaluateRecommendationQuality({
    games: buildLibrary(),
    embeddingsByGame: new Map(),
    structuredKeywordsByGame: new Map(),
    options: RECOMMENDATION_SCORING_DEFAULTS,
    ks: [5, 10, 5, 0],
  });

  assert.equal(result.ratedCount, 16);
  assert.equal(result.likedCount, 8);
  assert.equal(result.dislikedCount, 8);
  assert.equal(result.candidatePoolSize, 20);
  assert.deepEqual(
    result.hitRate.map((entry) => entry.k),
    [5, 10]
  );
  // Held-out RPGs share tags with the other loved RPGs, so they tie the five
  // RPG-tagged backlog games at the top; held-out sports games score below.
  assert.equal(result.hitRate[1].rate, 1);
  assert.equal(result.meanLikedPercentile, 2.5 / 20);
  assert.equal(result.auc, 1);
  assert.ok(result.meanReciprocalRank > 0);
});

void test('evaluateRecommendationQuality skips ambiguous ratings and handles no liked games', () => {
  const games = buildLibrary().map((game) => (game.rating === 5 ? { ...game, rating: 3.5 } : game));

  const result = evaluateRecommendationQuality({
    games,
    embeddingsByGame: new Map(),
    structuredKeywordsByGame: new Map(),
    options: RECOMMENDATION_SCORING_DEFAULTS,
    ks: [],
  });

  assert.equal(result.likedCount, 0);
  assert.equal(result.dislikedCount, 8);
  assert.deepEqual(result.hitRate, []);
  assert.equal(result.meanReciprocalRank, 0);
  assert.equal(result.medianLikedPercentile, 0);
  assert.equal(result.auc, null);
});

void test('evaluateRecommendationQuality ranks a rated backlog game once, as its hidden copy', () => {
  // A loved RPG still sitting in the backlog (status null) is already a
  // candidate. Held out, it must replace that entry, not tie with it.
  const games: NormalizedGameRecord[] = [
    buildGame({
      igdbGameId: 'rpg-backlog',
      rating: 5,
      genres: ['Role-playing (RPG)'],
      themes: ['Fantasy'],
    }),
    buildGame({
      igdbGameId: 'rpg-done',
      status: 'completed',
      rating: 5,
      genres: ['Role-playing (RPG)'],
      themes: ['Fantasy'],
    }),
  ];
  for (let index = 0; index < 8; index += 1) {
    games.push(
      buildGame({
        igdbGameId: `sport-${String(index)}`,
        status: 'dropped',
        rating: 1.5,
        genres: ['Sport'],
        themes: ['Comedy'],
      })
    );
  }
  for (let index = 0; index < 10; index += 1) {
    games.push(
      buildGame({
        igdbGameId: `racing-${String(index)}`,
        genres: ['Racing'],
        themes: ['Action'],
      })
    );
  }

  const result = evaluateRecommendationQuality({
    games,
    embeddingsByGame: new Map(),
    structuredKeywordsByGame: new Map(),
    options: RECOMMENDATION_SCORING_DEFAULTS,
    ks: [2],
  });

  assert.equal(result.likedCount, 2);
  assert.equal(result.candidatePoolSize, 11);
  assert.equal(result.hitRate[0].rate, 1);
  // Held out, rpg-backlog has no RPG rival left in the pool (percentile 0).
  // Held out, rpg-done genuinely ties with rpg-backlog (half of 1 in 11).
  // Ranking a duplicate would score both games 0.5 / 11.
  assert.equal(result.meanLikedPercentile, Math.round((0.5 / 11 / 2) * 10000) / 10000);
});
