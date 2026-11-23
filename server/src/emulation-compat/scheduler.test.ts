import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { startEmulationCompatMonitor } from './scheduler.js';

void test('startEmulationCompatMonitor returns an inert monitor when disabled', async () => {
  const monitor = startEmulationCompatMonitor({} as unknown as Pool);
  await assert.doesNotReject(monitor.stop());
});
