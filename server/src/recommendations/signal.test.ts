import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTasteSignalModel,
  DEFAULT_TASTE_SIGNAL_MODEL,
  RATING_MEAN_PRIOR_COUNT,
  stepRating,
} from './signal.js';
import { GameStatus, NormalizedGameRecord } from './types.js';

function game(
  rating: number | null,
  status: GameStatus | null = null,
  listType: NormalizedGameRecord['listType'] = 'collection'
): NormalizedGameRecord {
  return { rating, status, listType } as NormalizedGameRecord;
}

function ratings(values: number[]): NormalizedGameRecord[] {
  return values.map((value) => game(value, 'completed'));
}

void test('default model maps 1..5 half-step ratings to (rating - 3) / 2 and ignores status', () => {
  const signalOf = (rating: number | null, status: GameStatus | null = null): number | null =>
    DEFAULT_TASTE_SIGNAL_MODEL.signalOf(game(rating, status));

  assert.equal(DEFAULT_TASTE_SIGNAL_MODEL.center, 3);
  assert.equal(signalOf(1), -1);
  assert.equal(signalOf(3), 0);
  assert.equal(signalOf(5), 1);
  assert.equal(signalOf(2.5), -0.25);
  assert.equal(signalOf(4.2), 0.5);
  assert.equal(signalOf(0.5), null);
  assert.equal(signalOf(null), null);
  assert.equal(signalOf(null, 'completed'), null);
  assert.equal(signalOf(null, 'dropped'), null);
});

void test('mean centring moves neutral to the shrunk personal mean and keeps the ends at ±1', () => {
  // Twenty 4.5★ ratings: shrunk mean = (20 × 4.5 + 5 × 3) / 25 = 4.2.
  const library = ratings(Array.from({ length: 20 }, () => 4.5));
  const full = buildTasteSignalModel(library, { ratingMeanCenterWeight: 1, statusSignalWeight: 0 });

  assert.equal(RATING_MEAN_PRIOR_COUNT, 5);
  assert.ok(Math.abs(full.center - 4.2) < 1e-9);
  assert.equal(full.signalOf(game(5)), 1);
  assert.equal(full.signalOf(game(1)), -1);
  // A 4★ from a generous rater is now slightly below their norm, and 3★ a clear miss.
  assert.ok(Math.abs((full.signalOf(game(4)) ?? 0) - -0.2 / 3.2) < 1e-9);
  assert.ok(Math.abs((full.signalOf(game(3)) ?? 0) - -1.2 / 3.2) < 1e-9);

  const half = buildTasteSignalModel(library, {
    ratingMeanCenterWeight: 0.5,
    statusSignalWeight: 0,
  });
  assert.ok(Math.abs(half.center - 3.6) < 1e-9);

  const clampedWeight = buildTasteSignalModel(library, {
    ratingMeanCenterWeight: 7,
    statusSignalWeight: 0,
  });
  assert.equal(clampedWeight.center, full.center);

  const off = buildTasteSignalModel(library, { ratingMeanCenterWeight: 0, statusSignalWeight: 0 });
  assert.equal(off.center, 3);
});

void test('mean centring shrinks small libraries toward 3★ and stays inside the scale', () => {
  const single = buildTasteSignalModel(ratings([5]), {
    ratingMeanCenterWeight: 1,
    statusSignalWeight: 0,
  });
  assert.ok(Math.abs(single.center - 20 / 6) < 1e-9);

  const allFives = buildTasteSignalModel(ratings(Array.from({ length: 1000 }, () => 5)), {
    ratingMeanCenterWeight: 1,
    statusSignalWeight: 0,
  });
  assert.equal(allFives.center, 4.5);
  assert.equal(allFives.signalOf(game(5)), 1);

  const empty = buildTasteSignalModel([], { ratingMeanCenterWeight: 1, statusSignalWeight: 0 });
  assert.equal(empty.center, 3);

  const invalid = buildTasteSignalModel(ratings([5, 5]), {
    ratingMeanCenterWeight: Number.NaN,
    statusSignalWeight: Number.NaN,
  });
  assert.equal(invalid.center, 3);
  assert.equal(invalid.signalOf(game(null, 'completed')), null);
});

void test('status signals give unrated played games a weak, scaled signal', () => {
  const model = buildTasteSignalModel([], { ratingMeanCenterWeight: 0, statusSignalWeight: 0.5 });

  assert.equal(model.signalOf(game(null, 'replay')), 0.375);
  // Completed is neutral but still a signal (it records the tags as played).
  assert.equal(model.signalOf(game(null, 'completed')), 0);
  assert.equal(model.signalOf(game(null, 'dropped')), -0.375);
  assert.equal(model.signalOf(game(null, 'playing')), null);
  assert.equal(model.signalOf(game(null, 'paused')), null);
  assert.equal(model.signalOf(game(null, 'wantToPlay')), null);
  assert.equal(model.signalOf(game(null)), null);
  // Wishlist games are candidates themselves: their status must not boost them.
  assert.equal(model.signalOf(game(null, 'replay', 'wishlist')), null);
  assert.equal(model.signalOf(game(null, 'dropped', 'discovery')), null);
  assert.equal(model.signalOf(game(4, 'replay', 'wishlist')), 0.5);
  // A rating always wins over status.
  assert.equal(model.signalOf(game(3, 'dropped')), 0);
  assert.equal(model.signalOf(game(0.5, 'completed')), null);
});

void test('stepRating snaps to half stars within 1..5', () => {
  assert.equal(stepRating(3.74), 3.5);
  assert.equal(stepRating(3.76), 4);
  assert.equal(stepRating(5.2), 5);
  assert.equal(stepRating(5.3), null);
  assert.equal(stepRating(Number.POSITIVE_INFINITY), null);
  assert.equal(stepRating(null), null);
});
