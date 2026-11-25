import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDisplayedHistoryUpdates,
  buildHistoryKey,
  computeRepeatPenalty,
  decayRecommendationCount,
} from './history.js';
import { RankedRecommendationItem, RecommendationLaneCollection } from './types.js';

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

void test('buildDisplayedHistoryUpdates records every lane once per runtime mode', () => {
  const item = (igdbGameId: string, platformIgdbId = 6): RankedRecommendationItem =>
    ({ igdbGameId, platformIgdbId }) as RankedRecommendationItem;
  const overall = [item('a'), item('b')];
  // Hidden Gems and Exploration reach past the top of the overall list.
  const hiddenGems = [item('deep-gem'), item('a')];
  const exploration = [item('deep-explore'), item('b', 48)];
  const lanes: RecommendationLaneCollection = {
    overall,
    hiddenGems,
    exploration,
    blended: overall,
    popular: hiddenGems,
    recent: exploration,
  };
  const empty: RecommendationLaneCollection = {
    overall: [],
    hiddenGems: [],
    exploration: [],
    blended: [],
    popular: [],
    recent: [],
  };

  const updates = buildDisplayedHistoryUpdates('BACKLOG', {
    NEUTRAL: lanes,
    SHORT: empty,
    LONG: lanes,
  });

  const keysFor = (mode: string): string[] =>
    updates
      .filter((update) => update.runtimeMode === mode)
      .map((update) => buildHistoryKey(update.igdbGameId, update.platformIgdbId));
  // Aliased lanes and repeats across lanes count once; other platforms are
  // separate history rows.
  assert.deepEqual(keysFor('NEUTRAL'), ['a::6', 'b::6', 'deep-gem::6', 'deep-explore::6', 'b::48']);
  assert.deepEqual(keysFor('LONG'), keysFor('NEUTRAL'));
  assert.deepEqual(keysFor('SHORT'), []);
  assert.ok(updates.every((update) => update.target === 'BACKLOG'));
});
