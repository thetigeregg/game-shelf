import assert from 'node:assert/strict';
import test from 'node:test';
import { findBestTitleMatch, getTitleSimilarityScore } from './title-similarity.js';

void test('getTitleSimilarityScore scores an exact match highest', () => {
  const exact = getTitleSimilarityScore('Super Mario Sunshine', 'Super Mario Sunshine');
  const different = getTitleSimilarityScore('Super Mario Sunshine', 'Metroid Prime');
  assert.ok(exact > different);
  assert.ok(exact > 150);
});

void test('getTitleSimilarityScore is case- and punctuation-insensitive', () => {
  const score = getTitleSimilarityScore('Super Mario Sunshine', 'SUPER, MARIO: SUNSHINE!!');
  assert.ok(score > 150);
});

void test('getTitleSimilarityScore returns -1 when either title is empty after normalization', () => {
  assert.equal(getTitleSimilarityScore('', 'Metroid Prime'), -1);
  assert.equal(getTitleSimilarityScore('Metroid Prime', '   '), -1);
  assert.equal(getTitleSimilarityScore('!!!', 'Metroid Prime'), -1);
});

void test('getTitleSimilarityScore rewards substring containment and token overlap', () => {
  const containment = getTitleSimilarityScore(
    'The Legend of Zelda: Wind Waker',
    'The Legend of Zelda'
  );
  const unrelated = getTitleSimilarityScore('The Legend of Zelda: Wind Waker', 'Pikmin 2');
  assert.ok(containment > unrelated);
});

void test('findBestTitleMatch returns null for an empty candidate list', () => {
  assert.equal(
    findBestTitleMatch('Metroid Prime', [], (candidate: string) => candidate),
    null
  );
});

void test('findBestTitleMatch picks the highest scoring candidate', () => {
  const candidates = ['Metroid Prime 2: Echoes', 'Metroid Prime', 'Super Mario Sunshine'];
  const best = findBestTitleMatch('Metroid Prime', candidates, (candidate) => candidate);
  assert.ok(best);
  assert.equal(best.candidate, 'Metroid Prime');
});
