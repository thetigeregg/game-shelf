import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPreferenceProfile } from './profile.js';
import { buildRankedScores } from './score.js';
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
    similarGameIgdbIds: [],
    ...overrides,
  };
}

function rank(
  candidates: NormalizedGameRecord[],
  limit: number,
  embeddingsByGame?: Map<string, number[]>
) {
  return buildRankedScores({
    candidates,
    profile: buildPreferenceProfile([]),
    target: 'WISHLIST',
    runtimeMode: 'NEUTRAL',
    limit,
    semanticSimilarityByGame: new Map(),
    tunedWeights: {
      tasteWeight: 1,
      semanticWeight: 2,
      criticWeight: 1,
      runtimeWeight: 1,
      igdbSimilarWeight: 0,
    },
    explorationWeight: 0.3,
    diversityPenaltyWeight: 0.5,
    similarityStructuredWeight: 0.6,
    similaritySemanticWeight: 0.4,
    repeatPenaltyStep: 0.2,
    historyByGame: new Map(),
    embeddingsByGame,
    cosineCalibration: { low: 0, high: 1 },
  });
}

void test('buildRankedScores penalises near-duplicates of picks beyond the first five', () => {
  // Critic score sets the base order; each game has its own genre except B1/B2.
  const candidates = [
    ...[1, 2, 3, 4, 5].map((index) =>
      buildGame({
        igdbGameId: `a${String(index)}`,
        title: `A${String(index)}`,
        metacriticScore: 100,
        genres: [`A${String(index)}`],
      })
    ),
    buildGame({ igdbGameId: 'b1', title: 'B1', metacriticScore: 95, genres: ['B'] }),
    buildGame({ igdbGameId: 'b2', title: 'B2', metacriticScore: 94, genres: ['B'] }),
    buildGame({ igdbGameId: 'c', title: 'C', metacriticScore: 61, genres: ['C'] }),
  ];

  const order = rank(candidates, candidates.length).map((entry) => entry.game.igdbGameId);

  // B2 duplicates B1 (pick #6). Only comparing against the first five picks let
  // it through ahead of C; now it falls behind.
  assert.deepEqual(order.slice(5), ['b1', 'c', 'b2']);
});

void test('buildRankedScores separates near-duplicates by their own embeddings', () => {
  const candidates = [
    buildGame({ igdbGameId: 'x', title: 'X', metacriticScore: 100 }),
    buildGame({ igdbGameId: 'x-twin', title: 'X twin', metacriticScore: 99 }),
    buildGame({ igdbGameId: 'y', title: 'Y', metacriticScore: 98 }),
  ];
  const embeddings = new Map([
    ['x::1', [1, 0]],
    ['x-twin::1', [1, 0]],
    ['y::1', [0, 1]],
  ]);

  const ranked = rank(candidates, 3, embeddings);

  assert.deepEqual(
    ranked.map((entry) => entry.game.igdbGameId),
    ['x', 'y', 'x-twin']
  );
  assert.equal(ranked[1].components.diversityPenalty, 0);
  // No shared tags, identical embedding: 0.4 semantic share × weight 0.5.
  assert.equal(ranked[2].components.diversityPenalty, -0.2);
});

void test('buildRankedScores pruning never changes the top of the list', () => {
  const candidates = Array.from({ length: 60 }, (_, index) =>
    buildGame({
      igdbGameId: `g${String(index)}`,
      title: `G${String(index).padStart(2, '0')}`,
      metacriticScore: 60 + ((index * 37) % 41),
      genres: [`Genre ${String(index % 7)}`],
      themes: [`Theme ${String(index % 3)}`],
    })
  );

  const full = rank(candidates, candidates.length);
  const top = rank(candidates, 8);

  assert.deepEqual(
    top.map((entry) => entry.game.igdbGameId),
    full.slice(0, 8).map((entry) => entry.game.igdbGameId)
  );
  assert.deepEqual(
    top.map((entry) => entry.total),
    full.slice(0, 8).map((entry) => entry.total)
  );
});
