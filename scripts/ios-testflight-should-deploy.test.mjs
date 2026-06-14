import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateTestFlightDeploy,
  manifestDiffHasNativeDependencyChanges,
  matchesNativeShellPath,
} from './ios-testflight-should-deploy.mjs';

test('matchesNativeShellPath matches ios tree and exact native-shell files', () => {
  assert.equal(matchesNativeShellPath('ios/App/App.xcodeproj/project.pbxproj'), true);
  assert.equal(matchesNativeShellPath('capacitor.config.ts'), true);
  assert.equal(matchesNativeShellPath('scripts/sync-ios-version.mjs'), true);
  assert.equal(matchesNativeShellPath('server/foo.ts'), false);
  assert.equal(matchesNativeShellPath('src/app/foo.ts'), false);
  assert.equal(matchesNativeShellPath('package.json'), false);
});

test('manifestDiffHasNativeDependencyChanges detects Capacitor and Ionic dependency bumps', () => {
  const versionOnlyDiff = `
--- a/package.json
+++ b/package.json
@@
-  "version": "1.55.0",
+  "version": "1.56.0",
`;

  const capacitorDiff = `
--- a/package.json
+++ b/package.json
@@
-    "@capacitor/core": "8.4.0",
+    "@capacitor/core": "8.5.0",
`;

  assert.equal(manifestDiffHasNativeDependencyChanges(versionOnlyDiff), false);
  assert.equal(manifestDiffHasNativeDependencyChanges(capacitorDiff), true);
});

test('manifestDiffHasNativeDependencyChanges detects Capawesome dependency bumps', () => {
  const capawesomeDiff = `
--- a/package.json
+++ b/package.json
@@
-    "@capawesome/capacitor-live-update": "8.3.0",
+    "@capawesome/capacitor-live-update": "8.4.0",
`;

  assert.equal(manifestDiffHasNativeDependencyChanges(capawesomeDiff), true);
});

test('evaluateTestFlightDeploy skips backend-only changes', () => {
  const decision = evaluateTestFlightDeploy({
    changedFiles: ['server/foo.ts', 'package.json', 'CHANGELOG.md'],
    manifestDiff: `
--- a/package.json
+++ b/package.json
@@
-  "version": "1.55.0",
+  "version": "1.56.0",
`,
    hasPreviousTag: true,
  });

  assert.equal(decision.shouldDeploy, false);
  assert.match(decision.skippedReason, /native-shell/i);
});

test('evaluateTestFlightDeploy skips src-only changes', () => {
  const decision = evaluateTestFlightDeploy({
    changedFiles: ['src/app/foo.ts', 'package.json', 'CHANGELOG.md'],
    manifestDiff: '',
    hasPreviousTag: true,
  });

  assert.equal(decision.shouldDeploy, false);
});

test('evaluateTestFlightDeploy deploys for ios native changes', () => {
  const decision = evaluateTestFlightDeploy({
    changedFiles: ['ios/App/App.xcodeproj/project.pbxproj', 'CHANGELOG.md'],
    manifestDiff: '',
    hasPreviousTag: true,
  });

  assert.equal(decision.shouldDeploy, true);
  assert.deepEqual(decision.matchedPaths, ['ios/App/App.xcodeproj/project.pbxproj']);
});

test('evaluateTestFlightDeploy deploys for capacitor.config.ts changes', () => {
  const decision = evaluateTestFlightDeploy({
    changedFiles: ['capacitor.config.ts'],
    hasPreviousTag: true,
  });

  assert.equal(decision.shouldDeploy, true);
});

test('evaluateTestFlightDeploy deploys for Capacitor dependency bumps', () => {
  const decision = evaluateTestFlightDeploy({
    changedFiles: ['package.json', 'package-lock.json', 'CHANGELOG.md'],
    manifestDiff: `
--- a/package.json
+++ b/package.json
@@
-    "@capacitor/core": "8.4.0",
+    "@capacitor/core": "8.5.0",
`,
    hasPreviousTag: true,
  });

  assert.equal(decision.shouldDeploy, true);
  assert.ok(decision.matchedPaths.includes('package.json'));
});

test('evaluateTestFlightDeploy deploys when native and src changes are mixed', () => {
  const decision = evaluateTestFlightDeploy({
    changedFiles: ['src/app/foo.ts', 'ios/App/App.prod.entitlements'],
    hasPreviousTag: true,
  });

  assert.equal(decision.shouldDeploy, true);
  assert.deepEqual(decision.matchedPaths, ['ios/App/App.prod.entitlements']);
});

test('evaluateTestFlightDeploy deploys when no previous tag exists', () => {
  const decision = evaluateTestFlightDeploy({
    changedFiles: ['server/foo.ts'],
    hasPreviousTag: false,
  });

  assert.equal(decision.shouldDeploy, true);
});
