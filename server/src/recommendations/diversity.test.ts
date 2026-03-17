import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDiversityPenalty } from './diversity.js';
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

void test('calculateDiversityPenalty applies negative penalty when overlap exists', () => {
  const candidate = {
    game: buildGame({ igdbGameId: '1' }),
    tokenKeys: new Set(['genres:rpg', 'developers:foo']),
  };
  const selected = [
    {
      game: buildGame({ igdbGameId: '2' }),
      tokenKeys: new Set(['genres:rpg', 'developers:foo']),
    },
  ];

  const penalty = calculateDiversityPenalty({
    candidate,
    selected,
    semanticSimilarityByGame: new Map([
      ['1::1', 0.9],
      ['2::1', 0.9],
    ]),
    diversityPenaltyWeight: 0.5,
    structuredWeight: 0.6,
    semanticWeight: 0.4,
  });

  assert.equal(penalty < 0, true);
});
