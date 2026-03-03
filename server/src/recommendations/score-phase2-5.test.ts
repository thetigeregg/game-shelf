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
    runtimeHours: 12,
    summary: null,
    storyline: null,
    reviewScore: 80,
    reviewSource: 'metacritic',
    metacriticScore: 80,
    mobyScore: null,
    genres: ['RPG'],
    developers: ['Foo'],
    publishers: [],
    franchises: [],
    collections: [],
    ...overrides
  };
}

void test('phase2.5 scoring integrates new components with bounded penalties', () => {
  const history: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: 'h1', rating: 5 }),
    buildGame({ igdbGameId: 'h2', rating: 4.5 }),
    buildGame({ igdbGameId: 'h3', rating: 4 }),
    buildGame({ igdbGameId: 'h4', rating: 3.5 }),
    buildGame({ igdbGameId: 'h5', rating: 3 })
  ];
  const candidates: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: 'c1', status: 'wantToPlay' })
  ];

  const ranked = buildRankedScores({
    candidates,
    profile: buildPreferenceProfile([...history, ...candidates]),
    target: 'BACKLOG',
    runtimeMode: 'SHORT',
    limit: 20,
    semanticSimilarityByGame: new Map([['c1::1', 0.5]]),
    tunedWeights: {
      tasteWeight: 1,
      semanticWeight: 2,
      criticWeight: 1,
      runtimeWeight: 1
    },
    explorationWeight: 0.3,
    diversityPenaltyWeight: 0.5,
    similarityStructuredWeight: 0.6,
    similaritySemanticWeight: 0.4,
    repeatPenaltyStep: 0.2,
    historyByGame: new Map([['c1::1', { recommendationCount: 2 }]])
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.components.repeatPenalty, -0.4);
  assert.equal((ranked[0]?.components.diversityPenalty ?? 1) <= 0, true);
  assert.equal((ranked[0]?.components.exploration ?? 0) >= 0, true);
});
