import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHistoryKey, computeRepeatPenalty, decayRecommendationCount } from './history.js';

void test('buildHistoryKey is stable', () => {
  assert.equal(buildHistoryKey('123', 6), '123::6');
});

void test('computeRepeatPenalty clamps to -1', () => {
  assert.equal(computeRepeatPenalty(1, 0.2), -0.2);
  assert.equal(computeRepeatPenalty(100, 0.2), -1);
  assert.equal(computeRepeatPenalty(-1, 0.2), 0);
});

void test('decayRecommendationCount halves the count every half-life', () => {
  const now = Date.parse('2026-03-01T00:00:00.000Z');
  const daysAgo = (days: number): string =>
    new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

  assert.equal(decayRecommendationCount(4, daysAgo(0), now), 4);
  assert.equal(decayRecommendationCount(4, daysAgo(7), now), 2);
  assert.equal(decayRecommendationCount(4, daysAgo(14), now), 1);
  assert.equal(decayRecommendationCount(4, daysAgo(-1), now), 4);
  assert.equal(decayRecommendationCount(4, 'not a date', now), 4);
  assert.equal(decayRecommendationCount(-3, daysAgo(7), now), 0);
  assert.equal(decayRecommendationCount(4, daysAgo(7), now, 0), 4);
});
