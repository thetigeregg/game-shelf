import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRecommendationRuntimeMode, scoreRuntimeFit } from './runtime.js';

void test('parseRecommendationRuntimeMode accepts enum values case-insensitively', () => {
  assert.equal(parseRecommendationRuntimeMode('NEUTRAL'), 'NEUTRAL');
  assert.equal(parseRecommendationRuntimeMode('short'), 'SHORT');
  assert.equal(parseRecommendationRuntimeMode(' Long '), 'LONG');
  assert.equal(parseRecommendationRuntimeMode('foo'), null);
});

void test('scoreRuntimeFit responds to mode-specific runtime preference', () => {
  assert.equal(scoreRuntimeFit(10, 'NEUTRAL'), 0);
  assert.equal(scoreRuntimeFit(5, 'SHORT') > 0, true);
  assert.equal(scoreRuntimeFit(60, 'SHORT') < 0, true);
  assert.equal(scoreRuntimeFit(60, 'LONG') > 0, true);
  assert.equal(scoreRuntimeFit(5, 'LONG') < 0, true);
});
