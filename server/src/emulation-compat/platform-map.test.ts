import assert from 'node:assert/strict';
import test from 'node:test';
import { getCompatPlatformConfig, isCompatEligiblePlatform } from './platform-map.js';

void test('isCompatEligiblePlatform is true only for configured platforms', () => {
  assert.equal(isCompatEligiblePlatform(5), true);
  assert.equal(isCompatEligiblePlatform(21), true);
  assert.equal(isCompatEligiblePlatform(8), false);
});

void test('getCompatPlatformConfig returns the Dolphin config for GameCube/Wii', () => {
  const wii = getCompatPlatformConfig(5);
  const gamecube = getCompatPlatformConfig(21);

  assert.ok(wii);
  assert.equal(wii.emulator, 'dolphin');
  assert.equal(wii.displayName, 'Wii');
  assert.equal(wii.bestStatus, 'perfect');

  assert.ok(gamecube);
  assert.equal(gamecube.displayName, 'GameCube');
});

void test('getCompatPlatformConfig returns null for a platform with no compat source', () => {
  assert.equal(getCompatPlatformConfig(8), null);
});
