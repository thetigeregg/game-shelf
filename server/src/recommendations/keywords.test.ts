import assert from 'node:assert/strict';
import test from 'node:test';
import { isKeywordNoise, normalizeKeyword, prepareKeywords } from './keywords.js';

void test('normalizeKeyword applies canonical mappings', () => {
  assert.equal(normalizeKeyword(' turn-based '), 'turn-based combat');
  assert.equal(normalizeKeyword('turn-based RPG'), 'turn-based combat');
  assert.equal(normalizeKeyword('party system'), 'party-based combat');
  assert.equal(normalizeKeyword('PARTY-BASED'), 'party-based combat');
  assert.equal(normalizeKeyword('jrpg'), 'japanese rpg');
});

void test('prepareKeywords normalizes punctuation/spacing and dedupes', () => {
  const prepared = prepareKeywords(['  Action / Adventure ', 'action-adventure', '']);
  assert.deepEqual(prepared, ['action adventure', 'action-adventure']);
});

void test('isKeywordNoise filters structural patterns', () => {
  assert.equal(isKeywordNoise('gamescom 2024'), true);
  assert.equal(isKeywordNoise('award winner'), true);
  assert.equal(isKeywordNoise('conference demo'), true);
  assert.equal(isKeywordNoise('playstation classic'), true);
  assert.equal(isKeywordNoise('soundtrack release'), true);
  assert.equal(isKeywordNoise('steam achievements'), true);
  assert.equal(isKeywordNoise('steam cloud'), true);
  assert.equal(isKeywordNoise('playstation trophies'), true);
  assert.equal(isKeywordNoise('xbox controller support for pc'), true);
  assert.equal(isKeywordNoise('available on - luna plus'), true);
  assert.equal(isKeywordNoise('digital distribution'), true);
  assert.equal(isKeywordNoise('this keyword has more than five words'), true);
  assert.equal(isKeywordNoise('space opera'), false);
  assert.equal(isKeywordNoise('survival horror'), false);
});
