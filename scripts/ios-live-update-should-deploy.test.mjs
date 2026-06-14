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

test('evaluateIosLiveUpdateDeploy publishes for root angular dependency bumps', () => {
  const angularDiff = `
--- a/package.json
+++ b/package.json
@@
-    "@angular/core": "21.2.15",
+    "@angular/core": "21.2.16",
`;

  const decision = evaluateIosLiveUpdateDeploy({
    changedFiles: ['package.json', 'package-lock.json'],
    manifestDiff: angularDiff,
    hasPreviousTag: true,
    nativeShellChanged: false,
  });

  assert.equal(decision.shouldDeploy, true);
  assert.ok(decision.matchedPaths.includes('package.json'));
});

test('evaluateIosLiveUpdateDeploy skips version-only manifest bumps', () => {
  const versionOnlyDiff = `
--- a/package.json
+++ b/package.json
@@
-  "version": "1.55.0",
+  "version": "1.56.0",
`;

  const decision = evaluateIosLiveUpdateDeploy({
    changedFiles: ['package.json', 'package-lock.json', 'CHANGELOG.md'],
    manifestDiff: versionOnlyDiff,
    hasPreviousTag: true,
    nativeShellChanged: false,
  });

  assert.equal(decision.shouldDeploy, false);
});

test('evaluateIosLiveUpdateDeploy skips web dep bump when native shell changed on same tag', () => {
  const angularDiff = `
--- a/package.json
+++ b/package.json
@@
-    "@angular/core": "21.2.15",
+    "@angular/core": "21.2.16",
`;

  const decision = evaluateIosLiveUpdateDeploy({
    changedFiles: ['package.json', 'package-lock.json', 'src/app/foo.ts'],
    manifestDiff: angularDiff,
    hasPreviousTag: true,
    nativeShellChanged: true,
  });

  assert.equal(decision.shouldDeploy, false);
  assert.match(decision.skippedReason, /TestFlight/i);
});

test('evaluateIosLiveUpdateDeploy skips OTA public key rotation when native shell changed', () => {
  const decision = evaluateIosLiveUpdateDeploy({
    changedFiles: ['config/ios-live-update-public.pem'],
    hasPreviousTag: true,
    nativeShellChanged: true,
  });

  assert.equal(decision.shouldDeploy, false);
  assert.match(decision.skippedReason, /TestFlight/i);
});
