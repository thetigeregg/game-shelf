import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGameKey,
  buildTasteProfileEmbedding,
  clampSemanticScore,
  cosineSimilarity,
  dot,
  magnitude
} from './semantic.js';

void test('vector helpers compute expected values and guard invalid input', () => {
  assert.equal(buildGameKey('123', 6), '123::6');
  assert.equal(dot([1, 2], [3, 4]), 11);
  assert.equal(magnitude([3, 4]), 5);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosineSimilarity([1, 2], [1, 2]) - 1) < 1e-12);
  assert.equal(clampSemanticScore(2), 1);
  assert.equal(clampSemanticScore(-2), -1);
  assert.equal(clampSemanticScore(Number.NaN), 0);
});

void test('dot throws for mismatched vector dimensions', () => {
  assert.throws(() => dot([1, 2], [1]), /different dimensions/);
});

void test('buildTasteProfileEmbedding builds weighted centroid from positive rated games', () => {
  const games = [
    {
      igdbGameId: '1',
      platformIgdbId: 6,
      rating: 5
    },
    {
      igdbGameId: '2',
      platformIgdbId: 6,
      rating: 4
    },
    {
      igdbGameId: '3',
      platformIgdbId: 6,
      rating: 2
    }
  ] as const;

  const embeddingsByGame = new Map<string, number[]>([
    ['1::6', [1, 0, 0]],
    ['2::6', [0, 1, 0]],
    ['3::6', [0, 0, 1]]
  ]);

  const vector = buildTasteProfileEmbedding({
    games: games as never,
    embeddingsByGame
  });
  assert.ok(vector);
  assert.equal(vector.length, 3);
  assert.ok(vector[0] > vector[1]);
  assert.equal(vector[2], 0);
});

void test('buildTasteProfileEmbedding returns null for missing/invalid embeddings', () => {
  const noRated = buildTasteProfileEmbedding({
    games: [{ igdbGameId: '1', platformIgdbId: 6, rating: null }] as never,
    embeddingsByGame: new Map([['1::6', [1, 0]]])
  });
  assert.equal(noRated, null);

  const missingEmbedding = buildTasteProfileEmbedding({
    games: [{ igdbGameId: '1', platformIgdbId: 6, rating: 5 }] as never,
    embeddingsByGame: new Map()
  });
  assert.equal(missingEmbedding, null);

  const mismatchedDimensions = buildTasteProfileEmbedding({
    games: [
      { igdbGameId: '1', platformIgdbId: 6, rating: 5 },
      { igdbGameId: '2', platformIgdbId: 6, rating: 5 }
    ] as never,
    embeddingsByGame: new Map([
      ['1::6', [1, 0]],
      ['2::6', [1, 0, 0]]
    ])
  });
  assert.ok(mismatchedDimensions);
  assert.deepEqual(mismatchedDimensions, [1, 0]);
});
