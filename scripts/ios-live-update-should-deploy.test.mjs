import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateIosLiveUpdateDeploy,
  nativeShellChangedFromFiles,
} from './ios-live-update-should-deploy.mjs';

test('evaluateIosLiveUpdateDeploy publishes for src-only edge changes', () => {
  const decision = evaluateIosLiveUpdateDeploy({
    changedFiles: ['src/app/foo.ts', 'package.json'],
    hasPreviousTag: true,
    nativeShellChanged: false,
  });

  assert.equal(decision.shouldDeploy, true);
  assert.deepEqual(decision.matchedPaths, ['src/app/foo.ts']);
});

test('evaluateIosLiveUpdateDeploy skips when native shell changed on same tag', () => {
  const decision = evaluateIosLiveUpdateDeploy({
    changedFiles: ['src/app/foo.ts', 'ios/App/AppDelegate.swift'],
    hasPreviousTag: true,
    nativeShellChanged: true,
  });

  assert.equal(decision.shouldDeploy, false);
  assert.match(decision.skippedReason, /TestFlight/i);
});

test('evaluateIosLiveUpdateDeploy skips backend-only changes', () => {
  const decision = evaluateIosLiveUpdateDeploy({
    changedFiles: ['server/foo.ts'],
    hasPreviousTag: true,
    nativeShellChanged: false,
  });

  assert.equal(decision.shouldDeploy, false);
});

test('nativeShellChangedFromFiles detects ios tree changes', () => {
  assert.equal(nativeShellChangedFromFiles(['src/app/foo.ts']), false);
  assert.equal(nativeShellChangedFromFiles(['ios/App/AppDelegate.swift']), true);
});
