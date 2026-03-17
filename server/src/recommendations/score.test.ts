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

void test('ranking is deterministic for the same input data', () => {
  const history: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: 'h1', rating: 5, genres: ['RPG'], developers: ['Alpha'] }),
    buildGame({ igdbGameId: 'h2', rating: 5, genres: ['RPG'], developers: ['Alpha'] }),
    buildGame({ igdbGameId: 'h3', rating: 4.5, genres: ['RPG'], developers: ['Beta'] }),
    buildGame({ igdbGameId: 'h4', rating: 4, genres: ['Action'], developers: ['Gamma'] }),
    buildGame({ igdbGameId: 'h5', rating: 2, genres: ['Puzzle'], developers: ['Delta'] }),
  ];
  const candidates: NormalizedGameRecord[] = [
    buildGame({
      igdbGameId: 'c1',
      title: 'RPG Prime',
      status: 'wantToPlay',
      genres: ['RPG'],
      developers: ['Alpha'],
      runtimeHours: 14,
      reviewScore: 90,
      reviewSource: 'metacritic',
    }),
    buildGame({
      igdbGameId: 'c2',
      title: 'Puzzle Quest',
      status: 'wantToPlay',
      genres: ['Puzzle'],
      developers: ['Delta'],
      runtimeHours: 42,
      reviewScore: 70,
      reviewSource: 'metacritic',
    }),
  ];

  const profile = buildPreferenceProfile([...history, ...candidates]);
  const semanticSimilarityByGame = new Map<string, number>([
    ['c1::1', 0.3],
    ['c2::1', -0.4],
  ]);
  const params = {
    candidates,
    profile,
    target: 'BACKLOG' as const,
    runtimeMode: 'SHORT' as const,
    limit: 20,
    semanticSimilarityByGame,
    tunedWeights: {
      tasteWeight: 1,
      semanticWeight: 2,
      criticWeight: 1,
      runtimeWeight: 1,
    },
    explorationWeight: 0.3,
    diversityPenaltyWeight: 0.5,
    similarityStructuredWeight: 0.6,
    similaritySemanticWeight: 0.4,
    repeatPenaltyStep: 0.2,
    historyByGame: new Map<string, { recommendationCount: number }>(),
  };

  const first = buildRankedScores(params);
  const second = buildRankedScores(params);

  assert.deepEqual(first, second);
  assert.equal(first[0]?.game.igdbGameId, 'c1');
  assert.equal(first[0]?.components.semantic, 0.6);
  assert.equal(typeof first[0]?.components.runtimeFit, 'number');
  assert.equal(typeof first[0]?.components.exploration, 'number');
});

void test('cold start disables taste contribution when rated games are fewer than five', () => {
  const history: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: 'h1', rating: 5, genres: ['RPG'], developers: ['Alpha'] }),
  ];
  const candidates: NormalizedGameRecord[] = [
    buildGame({
      igdbGameId: 'c1',
      title: 'RPG Prime',
      status: 'wantToPlay',
      genres: ['RPG'],
      developers: ['Alpha'],
      runtimeHours: 12,
    }),
  ];

  const profile = buildPreferenceProfile([...history, ...candidates]);
  const ranked = buildRankedScores({
    candidates,
    profile,
    target: 'BACKLOG',
    runtimeMode: 'NEUTRAL',
    limit: 20,
    semanticSimilarityByGame: new Map([['c1::1', 0.2]]),
    tunedWeights: {
      tasteWeight: 1,
      semanticWeight: 2,
      criticWeight: 1,
      runtimeWeight: 1,
    },
    explorationWeight: 0.3,
    diversityPenaltyWeight: 0.5,
    similarityStructuredWeight: 0.6,
    similaritySemanticWeight: 0.4,
    repeatPenaltyStep: 0.2,
    historyByGame: new Map([['c1::1', { recommendationCount: 3 }]]),
  });

  assert.equal(ranked[0]?.components.taste, 0);
  assert.equal(ranked[0]?.components.semantic, 0.4);
  assert.equal(ranked[0]?.components.repeatPenalty, -0.6);
});

void test('critic boost handles mobygames reviewScore values on 0-100 scale', () => {
  const history: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: 'h1', rating: 5, genres: ['RPG'] }),
    buildGame({ igdbGameId: 'h2', rating: 4.5, genres: ['RPG'] }),
    buildGame({ igdbGameId: 'h3', rating: 4, genres: ['RPG'] }),
    buildGame({ igdbGameId: 'h4', rating: 3.5, genres: ['RPG'] }),
    buildGame({ igdbGameId: 'h5', rating: 3, genres: ['RPG'] }),
  ];
  const candidates: NormalizedGameRecord[] = [
    buildGame({
      igdbGameId: 'c1',
      status: 'wantToPlay',
      reviewScore: 87,
      reviewSource: 'mobygames',
      mobyScore: 8.7,
    }),
  ];

  const ranked = buildRankedScores({
    candidates,
    profile: buildPreferenceProfile([...history, ...candidates]),
    target: 'BACKLOG',
    runtimeMode: 'NEUTRAL',
    limit: 20,
    semanticSimilarityByGame: new Map(),
    tunedWeights: {
      tasteWeight: 1,
      semanticWeight: 2,
      criticWeight: 1,
      runtimeWeight: 1,
    },
    explorationWeight: 0.3,
    diversityPenaltyWeight: 0.5,
    similarityStructuredWeight: 0.6,
    similaritySemanticWeight: 0.4,
    repeatPenaltyStep: 0.2,
    historyByGame: new Map(),
  });

  assert.equal((ranked[0]?.components.criticBoost ?? 0) > 0, true);
});

void test('exploration uses raw semantic similarity, not weighted semantic score', () => {
  const history: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: 'h1', rating: 5, genres: ['RPG'] }),
    buildGame({ igdbGameId: 'h2', rating: 4.5, genres: ['RPG'] }),
    buildGame({ igdbGameId: 'h3', rating: 4, genres: ['RPG'] }),
    buildGame({ igdbGameId: 'h4', rating: 3.5, genres: ['RPG'] }),
    buildGame({ igdbGameId: 'h5', rating: 3, genres: ['RPG'] }),
  ];
  const candidates: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: 'c1', status: 'wantToPlay' }),
  ];

  const ranked = buildRankedScores({
    candidates,
    profile: buildPreferenceProfile([...history, ...candidates]),
    target: 'BACKLOG',
    runtimeMode: 'NEUTRAL',
    limit: 20,
    semanticSimilarityByGame: new Map([['c1::1', 0.7]]),
    tunedWeights: {
      tasteWeight: 1,
      semanticWeight: 2,
      criticWeight: 1,
      runtimeWeight: 1,
    },
    explorationWeight: 0.3,
    diversityPenaltyWeight: 0.5,
    similarityStructuredWeight: 0.6,
    similaritySemanticWeight: 0.4,
    repeatPenaltyStep: 0.2,
    historyByGame: new Map(),
  });

  assert.equal(ranked[0]?.components.exploration, 0.045);
});

void test('taste overlap discount reduces duplicate collection+franchise lift', () => {
  const history: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: 'h1', rating: 5, collections: ['Mario'], franchises: ['Mario'] }),
    buildGame({ igdbGameId: 'h2', rating: 4.5, collections: ['Mario'], franchises: ['Mario'] }),
    buildGame({ igdbGameId: 'h3', rating: 4, collections: ['Mario'], franchises: ['Mario'] }),
    buildGame({ igdbGameId: 'h4', rating: 3.5, collections: ['Mario'], franchises: ['Mario'] }),
    buildGame({ igdbGameId: 'h5', rating: 3, collections: ['Mario'], franchises: ['Mario'] }),
  ];

  const withOverlap = buildRankedScores({
    candidates: [
      buildGame({
        igdbGameId: 'c1',
        status: 'wantToPlay',
        collections: ['Mario'],
        franchises: ['Mario'],
      }),
    ],
    profile: buildPreferenceProfile(history),
    target: 'BACKLOG',
    runtimeMode: 'NEUTRAL',
    limit: 20,
    semanticSimilarityByGame: new Map(),
    tunedWeights: {
      tasteWeight: 1,
      semanticWeight: 2,
      criticWeight: 1,
      runtimeWeight: 1,
    },
    explorationWeight: 0.3,
    diversityPenaltyWeight: 0.5,
    similarityStructuredWeight: 0.6,
    similaritySemanticWeight: 0.4,
    repeatPenaltyStep: 0.2,
    historyByGame: new Map(),
  });

  const collectionOnly = buildRankedScores({
    candidates: [
      buildGame({
        igdbGameId: 'c2',
        status: 'wantToPlay',
        collections: ['Mario'],
        franchises: [],
      }),
    ],
    profile: buildPreferenceProfile(history),
    target: 'BACKLOG',
    runtimeMode: 'NEUTRAL',
    limit: 20,
    semanticSimilarityByGame: new Map(),
    tunedWeights: {
      tasteWeight: 1,
      semanticWeight: 2,
      criticWeight: 1,
      runtimeWeight: 1,
    },
    explorationWeight: 0.3,
    diversityPenaltyWeight: 0.5,
    similarityStructuredWeight: 0.6,
    similaritySemanticWeight: 0.4,
    repeatPenaltyStep: 0.2,
    historyByGame: new Map(),
  });

  assert.equal(
    (withOverlap[0]?.components.taste ?? 0) > (collectionOnly[0]?.components.taste ?? 0),
    true
  );
  assert.equal((withOverlap[0]?.components.taste ?? 0) < 1.4, true);
});
