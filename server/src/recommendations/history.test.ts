import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHistoryKey, computeRepeatPenalty } from './history.js';

void test('buildHistoryKey is stable', () => {
  assert.equal(buildHistoryKey('123', 6), '123::6');
});

void test('computeRepeatPenalty clamps to -1', () => {
  assert.equal(computeRepeatPenalty(1, 0.2), -0.2);
  assert.equal(computeRepeatPenalty(100, 0.2), -1);
  assert.equal(computeRepeatPenalty(-1, 0.2), 0);
});
