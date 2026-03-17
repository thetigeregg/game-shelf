import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKeywordSelection } from './keyword-stats.js';
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
    genres: [],
    themes: [],
    keywords: [],
    developers: [],
    publishers: [],
    franchises: [],
    collections: [],
    ...overrides
  };
}

void test('buildKeywordSelection applies filtering and structured qualification', () => {
  const games = [
    buildGame({ igdbGameId: '1', listType: 'collection' }),
    buildGame({ igdbGameId: '2', listType: 'collection' }),
    buildGame({ igdbGameId: '3', listType: 'collection' }),
    buildGame({ igdbGameId: '4', listType: 'wishlist' }),
    buildGame({ igdbGameId: '5', listType: 'wishlist' })
  ];
  const prepared = new Map<string, string[]>([
    ['1::1', ['space opera', 'rare']],
    ['2::1', ['space opera', 'city builder']],
    ['3::1', ['space opera']],
    ['4::1', ['space opera', 'city builder']],
    ['5::1', ['space opera']]
  ]);

  const selected = buildKeywordSelection({
    games,
    preparedKeywordsByGame: prepared,
    options: {
      globalMaxRatio: 1,
      structuredMaxRatio: 1,
      minLibraryCount: 1,
      structuredMax: 10,
      embeddingMax: 10
    }
  });

  assert.deepEqual(selected.embeddingKeywordsByGame.get('1::1'), ['space opera']);
  assert.deepEqual(selected.embeddingKeywordsByGame.get('2::1'), ['space opera', 'city builder']);
  assert.deepEqual(selected.structuredKeywordsByGame.get('2::1'), ['space opera', 'city builder']);
  assert.deepEqual(selected.structuredKeywordsByGame.get('4::1'), ['space opera', 'city builder']);
});

void test('buildKeywordSelection enforces deterministic structured max cap ordering', () => {
  const games = [
    buildGame({ igdbGameId: '1', listType: 'collection' }),
    buildGame({ igdbGameId: '2', listType: 'collection' }),
    buildGame({ igdbGameId: '3', listType: 'collection' }),
    buildGame({ igdbGameId: '4', listType: 'wishlist' })
  ];
  const prepared = new Map<string, string[]>([
    ['1::1', ['alpha', 'beta']],
    ['2::1', ['alpha', 'beta']],
    ['3::1', ['alpha', 'gamma']],
    ['4::1', ['alpha', 'gamma']]
  ]);

  const selected = buildKeywordSelection({
    games,
    preparedKeywordsByGame: prepared,
    options: {
      globalMaxRatio: 1,
      structuredMaxRatio: 1,
      minLibraryCount: 2,
      structuredMax: 1,
      embeddingMax: 10
    }
  });

  assert.deepEqual(selected.structuredKeywordsByGame.get('1::1'), ['alpha']);
  assert.deepEqual(selected.structuredKeywordsByGame.get('2::1'), ['alpha']);
  assert.deepEqual(selected.structuredKeywordsByGame.get('3::1'), ['alpha']);
});
