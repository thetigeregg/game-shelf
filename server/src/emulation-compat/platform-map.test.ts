import assert from 'node:assert/strict';
import test from 'node:test';
import { getCompatPlatformConfig, isCompatEligiblePlatform } from './platform-map.js';

void test('isCompatEligiblePlatform is true only for configured platforms', () => {
  assert.equal(isCompatEligiblePlatform(5), true);
  assert.equal(isCompatEligiblePlatform(21), true);
  assert.equal(isCompatEligiblePlatform(8), true);
  assert.equal(isCompatEligiblePlatform(11), true);
  assert.equal(isCompatEligiblePlatform(12), true);
  assert.equal(isCompatEligiblePlatform(9), true);
  assert.equal(isCompatEligiblePlatform(41), true);
  assert.equal(isCompatEligiblePlatform(46), true);
  assert.equal(isCompatEligiblePlatform(37), true);
  assert.equal(isCompatEligiblePlatform(999), false);
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

void test('getCompatPlatformConfig returns the PCSX2 config for PlayStation 2', () => {
  const ps2 = getCompatPlatformConfig(8);

  assert.ok(ps2);
  assert.equal(ps2.emulator, 'pcsx2');
  assert.equal(ps2.displayName, 'PlayStation 2');
  assert.equal(ps2.notificationDisplayName, 'PS2');
  assert.equal(ps2.bestStatus, 'perfect');
});

void test('getCompatPlatformConfig returns the xemu config for Xbox', () => {
  const xbox = getCompatPlatformConfig(11);

  assert.ok(xbox);
  assert.equal(xbox.emulator, 'xemu');
  assert.equal(xbox.displayName, 'Xbox');
  assert.equal(xbox.bestStatus, 'perfect');
});

void test('getCompatPlatformConfig returns the Xenia config for Xbox 360 with a non-perfect bestStatus', () => {
  const xbox360 = getCompatPlatformConfig(12);

  assert.ok(xbox360);
  assert.equal(xbox360.emulator, 'xenia');
  assert.equal(xbox360.displayName, 'Xbox 360');
  assert.equal(xbox360.notificationDisplayName, undefined);
  assert.equal(xbox360.bestStatus, 'playable');
});

void test('getCompatPlatformConfig returns the RPCS3 config for PlayStation 3 with a non-perfect bestStatus', () => {
  const ps3 = getCompatPlatformConfig(9);

  assert.ok(ps3);
  assert.equal(ps3.emulator, 'rpcs3');
  assert.equal(ps3.displayName, 'PlayStation 3');
  assert.equal(ps3.notificationDisplayName, 'PS3');
  assert.equal(ps3.bestStatus, 'playable');
});

void test('getCompatPlatformConfig returns the Cemu config for Wii U', () => {
  const wiiu = getCompatPlatformConfig(41);

  assert.ok(wiiu);
  assert.equal(wiiu.emulator, 'cemu');
  assert.equal(wiiu.displayName, 'Wii U');
  assert.equal(wiiu.bestStatus, 'perfect');
});

void test('getCompatPlatformConfig returns the Vita3K config for PlayStation Vita with a non-perfect bestStatus', () => {
  const psvita = getCompatPlatformConfig(46);

  assert.ok(psvita);
  assert.equal(psvita.emulator, 'vita3k');
  assert.equal(psvita.displayName, 'PlayStation Vita');
  assert.equal(psvita.notificationDisplayName, 'PSV');
  assert.equal(psvita.bestStatus, 'playable');
});

void test('getCompatPlatformConfig returns the Azahar config for 3DS', () => {
  const threeDs = getCompatPlatformConfig(37);

  assert.ok(threeDs);
  assert.equal(threeDs.emulator, 'azahar');
  assert.equal(threeDs.displayName, '3DS');
  assert.equal(threeDs.bestStatus, 'perfect');
});

void test('getCompatPlatformConfig returns null for a platform with no compat source', () => {
  assert.equal(getCompatPlatformConfig(999), null);
});
