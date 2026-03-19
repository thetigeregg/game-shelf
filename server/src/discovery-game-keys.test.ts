import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDiscoveryGameKeys,
  parseDiscoveryGameKey,
  parseDiscoveryGameKeys,
} from './discovery-game-keys.js';

void test('parseDiscoveryGameKey parses valid discovery keys', () => {
  assert.deepEqual(parseDiscoveryGameKey('game-123::48'), {
    igdbGameId: 'game-123',
    platformIgdbId: 48,
  });
});

void test('parseDiscoveryGameKey rejects blank and non-positive platform ids', () => {
  assert.equal(parseDiscoveryGameKey(''), null);
  assert.equal(parseDiscoveryGameKey('game-123::0'), null);
  assert.equal(parseDiscoveryGameKey('game-123::-1'), null);
  assert.equal(parseDiscoveryGameKey('game-123::abc'), null);
});

void test('parseDiscoveryGameKeys filters invalid values and deduplicates normalized keys', () => {
  assert.deepEqual(
    parseDiscoveryGameKeys([' game-123::48 ', 'game-123::48', 'game-123::0', 'game-123::-1']),
    [{ igdbGameId: 'game-123', platformIgdbId: 48 }]
  );
});

void test('normalizeDiscoveryGameKeys returns only valid normalized keys', () => {
  assert.deepEqual(normalizeDiscoveryGameKeys(['game-123::48', 'game-123::0', 'game-123::-1']), [
    'game-123::48',
  ]);
});
