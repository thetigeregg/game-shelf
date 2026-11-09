import assert from 'node:assert/strict';
import test from 'node:test';
import { createRevalidationCooldown } from './revalidation-cooldown.js';

void test('createRevalidationCooldown allows one attempt per key per window', () => {
  let nowMs = 1_000_000;
  const cooldown = createRevalidationCooldown({ cooldownMs: 60_000, now: () => nowMs });

  assert.equal(cooldown.tryAcquire('a'), true);
  assert.equal(cooldown.tryAcquire('a'), false);
  assert.equal(cooldown.tryAcquire('b'), true, 'keys are independent');
  nowMs += 59_999;
  assert.equal(cooldown.tryAcquire('a'), false);
  nowMs += 1;
  assert.equal(cooldown.tryAcquire('a'), true);
});

void test('createRevalidationCooldown release lets an attempt that never started retry', () => {
  const cooldown = createRevalidationCooldown({ cooldownMs: 60_000, now: () => 0 });
  assert.equal(cooldown.tryAcquire('a'), true);
  cooldown.release('a');
  assert.equal(cooldown.tryAcquire('a'), true);
});

void test('createRevalidationCooldown forgets the oldest attempts beyond its size cap', () => {
  const cooldown = createRevalidationCooldown({
    cooldownMs: 60_000,
    maxTrackedKeys: 2,
    now: () => 0,
  });
  cooldown.tryAcquire('a');
  cooldown.tryAcquire('b');
  cooldown.tryAcquire('c');
  assert.equal(cooldown.tryAcquire('a'), true, 'the oldest key was dropped');
  assert.equal(cooldown.tryAcquire('c'), false);
});

void test('createRevalidationCooldown with a zero window never blocks', () => {
  const cooldown = createRevalidationCooldown({ cooldownMs: 0 });
  assert.equal(cooldown.tryAcquire('a'), true);
  assert.equal(cooldown.tryAcquire('a'), true);
});
