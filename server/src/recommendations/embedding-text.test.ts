import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmbeddingText } from './embedding-text.js';
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
    ...overrides,
  };
}

void test('buildEmbeddingText includes themes and keywords sections', () => {
  const text = buildEmbeddingText(
    buildGame({
      title: 'Metroid',
      themes: ['Science fiction'],
      keywords: ['space opera'],
      genres: ['Adventure'],
    })
  );

  assert.equal(text.includes('Themes: Science fiction'), true);
  assert.equal(text.includes('Keywords: space opera'), true);
});

void test('buildEmbeddingText supports keyword override list', () => {
  const text = buildEmbeddingText(
    buildGame({
      title: 'Metroid',
      keywords: ['should-not-appear'],
    }),
    {
      keywords: ['selected-keyword'],
    }
  );

  assert.equal(text.includes('Keywords: selected-keyword'), true);
  assert.equal(text.includes('should-not-appear'), false);
});
