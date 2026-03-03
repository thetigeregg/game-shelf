import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSimilarityGraph } from './similarity.js';
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
    developers: [],
    publishers: [],
    franchises: [],
    collections: [],
    themes: [],
    keywords: [],
    ...overrides
  };
}

void test('similarity graph stores only top K entries per source', () => {
  const games: NormalizedGameRecord[] = [
    buildGame({
      igdbGameId: '1',
      title: 'Mario A',
      collections: ['Mario'],
      genres: ['Platformer'],
      developers: ['Nintendo']
    }),
    buildGame({
      igdbGameId: '2',
      title: 'Mario B',
      collections: ['Mario'],
      genres: ['Platformer'],
      developers: ['Nintendo']
    }),
    buildGame({
      igdbGameId: '3',
      title: 'Zelda',
      collections: ['Zelda'],
      genres: ['Adventure'],
      developers: ['Nintendo']
    })
  ];

  const edges = buildSimilarityGraph({ games, topK: 1 });

  const sourceOne = edges.filter((edge) => edge.sourceIgdbGameId === '1');
  assert.equal(sourceOne.length, 1);
  assert.equal(sourceOne[0].similarIgdbGameId, '2');
  assert.equal(sourceOne[0].reasons.summary.includes('same series'), true);
  assert.equal(sourceOne[0].reasons.blendedSimilarity > 0, true);
  assert.deepEqual(sourceOne[0].reasons.sharedTokens.themes, []);
  assert.deepEqual(sourceOne[0].reasons.sharedTokens.keywords, []);
});

void test('similarity graph excludes same game across different platforms', () => {
  const games: NormalizedGameRecord[] = [
    buildGame({
      igdbGameId: '1',
      platformIgdbId: 6,
      title: 'Game One (PC)',
      collections: ['Series A']
    }),
    buildGame({
      igdbGameId: '1',
      platformIgdbId: 48,
      title: 'Game One (PS5)',
      collections: ['Series A']
    }),
    buildGame({
      igdbGameId: '2',
      platformIgdbId: 6,
      title: 'Game Two',
      collections: ['Series A']
    })
  ];

  const edges = buildSimilarityGraph({ games, topK: 5 });

  assert.equal(
    edges.some(
      (edge) =>
        edge.sourceIgdbGameId === '1' &&
        edge.sourcePlatformIgdbId === 6 &&
        edge.similarIgdbGameId === '1' &&
        edge.similarPlatformIgdbId === 48
    ),
    false
  );
});
