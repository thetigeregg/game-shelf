import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateTestFlightDeploy,
  manifestDiffHasNativeDependencyChanges,
  matchesNativeShellPath,
  pbxprojDiffIsMarketingVersionOnly,
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

test('pbxprojDiffIsMarketingVersionOnly detects marketing-only diffs', () => {
  const marketingOnlyDiff = `
--- a/ios/App/App.xcodeproj/project.pbxproj
+++ b/ios/App/App.xcodeproj/project.pbxproj
@@
-\t\t\t\tMARKETING_VERSION = 1.58.2;
+\t\t\t\tMARKETING_VERSION = 1.58.3;
`;

  const nativeDiff = `
--- a/ios/App/App.xcodeproj/project.pbxproj
+++ b/ios/App/App.xcodeproj/project.pbxproj
@@
-\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = io.github.thetigeregg.gameshelf;
+\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = io.github.thetigeregg.gameshelf.dev;
`;

  assert.equal(pbxprojDiffIsMarketingVersionOnly(marketingOnlyDiff), true);
  assert.equal(pbxprojDiffIsMarketingVersionOnly(nativeDiff), false);
});

test('evaluateTestFlightDeploy skips marketing-only pbxproj changes', () => {
  const decision = evaluateTestFlightDeploy({
    changedFiles: ['ios/App/App.xcodeproj/project.pbxproj', 'package.json', 'CHANGELOG.md'],
    manifestDiff: `
--- a/package.json
+++ b/package.json
@@
-  "version": "1.58.2",
+  "version": "1.58.3",
`,
    pbxprojDiff: `
--- a/ios/App/App.xcodeproj/project.pbxproj
+++ b/ios/App/App.xcodeproj/project.pbxproj
@@
-\t\t\t\tMARKETING_VERSION = 1.58.2;
+\t\t\t\tMARKETING_VERSION = 1.58.3;
`,
    hasPreviousTag: true,
  });

  assert.equal(decision.shouldDeploy, false);
  assert.match(decision.skippedReason, /native-shell/i);
});

test('evaluateTestFlightDeploy deploys for ios native changes', () => {
  const decision = evaluateTestFlightDeploy({
    changedFiles: ['ios/App/App.xcodeproj/project.pbxproj', 'CHANGELOG.md'],
    pbxprojDiff: `
--- a/ios/App/App.xcodeproj/project.pbxproj
+++ b/ios/App/App.xcodeproj/project.pbxproj
@@
-\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = io.github.thetigeregg.gameshelf;
+\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = io.github.thetigeregg.gameshelf.dev;
`,
    manifestDiff: '',
    hasPreviousTag: true,
  });

  assert.equal(decision.shouldDeploy, true);
  assert.deepEqual(decision.matchedPaths, ['ios/App/App.xcodeproj/project.pbxproj']);
});

test('evaluateTestFlightDeploy deploys when marketing-only pbxproj changes with other native files', () => {
  const decision = evaluateTestFlightDeploy({
    changedFiles: ['ios/App/App.xcodeproj/project.pbxproj', 'ios/fastlane/Fastfile'],
    pbxprojDiff: `
--- a/ios/App/App.xcodeproj/project.pbxproj
+++ b/ios/App/App.xcodeproj/project.pbxproj
@@
-\t\t\t\tMARKETING_VERSION = 1.58.2;
+\t\t\t\tMARKETING_VERSION = 1.58.3;
`,
    hasPreviousTag: true,
  });

  assert.equal(decision.shouldDeploy, true);
  assert.deepEqual(decision.matchedPaths, ['ios/fastlane/Fastfile']);
});

test('evaluateTestFlightDeploy deploys for capacitor.config.ts changes', () => {
  const decision = evaluateTestFlightDeploy({
    changedFiles: ['capacitor.config.ts'],
    hasPreviousTag: true,
  });

  assert.equal(decision.shouldDeploy, true);
});

test('evaluateTestFlightDeploy deploys for OTA public key rotation', () => {
  const decision = evaluateTestFlightDeploy({
    changedFiles: ['config/ios-live-update-public.pem'],
    hasPreviousTag: true,
  });

  assert.equal(decision.shouldDeploy, true);
  assert.deepEqual(decision.matchedPaths, ['config/ios-live-update-public.pem']);
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
