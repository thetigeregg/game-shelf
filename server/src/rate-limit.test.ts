import assert from 'node:assert/strict';
import test from 'node:test';

import { formatTimeWindow } from './rate-limit.ts';

void test('formatTimeWindow rounds partial seconds up to avoid shortening configured windows', () => {
  assert.equal(formatTimeWindow(1_500), '2 seconds');
  assert.equal(formatTimeWindow(1_000), '1 seconds');
  assert.equal(formatTimeWindow(1), '1 seconds');
});
