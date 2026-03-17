import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePositiveEnvInt } from './env-utils.mjs';

test('parsePositiveEnvInt returns parsed positive integers', () => {
  assert.equal(parsePositiveEnvInt('TIMEOUT_MS', 25_000, { TIMEOUT_MS: '5000' }), 5000);
});

test('parsePositiveEnvInt falls back for missing or invalid values', () => {
  assert.equal(parsePositiveEnvInt('TIMEOUT_MS', 25_000, {}), 25_000);
  assert.equal(parsePositiveEnvInt('TIMEOUT_MS', 25_000, { TIMEOUT_MS: 'abc' }), 25_000);
});

test('parsePositiveEnvInt falls back for zero and negative values', () => {
  assert.equal(parsePositiveEnvInt('TIMEOUT_MS', 25_000, { TIMEOUT_MS: '0' }), 25_000);
  assert.equal(parsePositiveEnvInt('TIMEOUT_MS', 25_000, { TIMEOUT_MS: '-1000' }), 25_000);
});
