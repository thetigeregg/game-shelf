import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateDockerPublishDeploy,
  IMAGE_KEYS,
  manifestDiffTriggersImage,
  matchesImagePath,
} from './docker-publish-should-deploy.mjs';
import { manifestDiffHasDependencyChanges } from './release-diff.mjs';

test('matchesImagePath maps paths to the expected images', () => {
  assert.equal(matchesImagePath('edge', 'src/app/foo.ts'), true);
  assert.equal(matchesImagePath('edge', 'server/foo.ts'), false);
  assert.equal(matchesImagePath('api', 'server/foo.ts'), true);
  assert.equal(matchesImagePath('api', 'worker/foo.ts'), true);
  assert.equal(matchesImagePath('hltb', 'shared/foo.ts'), true);
  assert.equal(matchesImagePath('metacritic', 'metacritic-scraper/src/foo.ts'), true);
  assert.equal(matchesImagePath('edge', 'metacritic-scraper/src/foo.ts'), true);
  assert.equal(matchesImagePath('backup', 'scripts/backup/foo.sh'), true);
  assert.equal(matchesImagePath('edge', 'scripts/backup/foo.sh'), true);
  assert.equal(matchesImagePath('edge', 'ios/foo'), false);
  assert.equal(matchesImagePath('edge', 'package.json'), false);
});

test('manifestDiffTriggersImage ignores root version-only bumps for edge', () => {
  const versionOnlyDiff = `
--- a/package.json
+++ b/package.json
@@
-  "version": "1.55.0",
+  "version": "1.56.0",
`;

  const angularDiff = `
--- a/package.json
+++ b/package.json
@@
-    "@angular/core": "21.2.15",
+    "@angular/core": "21.2.16",
`;

  assert.equal(manifestDiffTriggersImage('edge', versionOnlyDiff), false);
  assert.equal(manifestDiffTriggersImage('edge', angularDiff), true);
  assert.equal(manifestDiffHasDependencyChanges(angularDiff, /@angular\//), true);
});

test('evaluateDockerPublishDeploy publishes api only for server changes', () => {
  const decision = evaluateDockerPublishDeploy({
    changedFiles: ['server/foo.ts', 'package.json', 'CHANGELOG.md'],
    manifestDiffs: {
      edge: `
--- a/package.json
+++ b/package.json
@@
-  "version": "1.55.0",
+  "version": "1.56.0",
`,
      api: '',
      hltb: '',
      metacritic: '',
      psprices: '',
    },
    hasPreviousTag: true,
  });

  assert.equal(decision.images.api.shouldPublish, true);
  assert.equal(decision.images.edge.shouldPublish, false);
  assert.equal(decision.images.backup.shouldPublish, false);
  assert.deepEqual(decision.skippedImages, ['edge', 'hltb', 'metacritic', 'psprices', 'backup']);
});

test('evaluateDockerPublishDeploy publishes edge only for src changes', () => {
  const decision = evaluateDockerPublishDeploy({
    changedFiles: ['src/app/foo.ts'],
    manifestDiffs: Object.fromEntries(
      ['edge', 'api', 'hltb', 'metacritic', 'psprices'].map((key) => [key, ''])
    ),
    hasPreviousTag: true,
  });

  assert.equal(decision.images.edge.shouldPublish, true);
  assert.equal(decision.images.api.shouldPublish, false);
});

test('evaluateDockerPublishDeploy skips ios-only changes', () => {
  const decision = evaluateDockerPublishDeploy({
    changedFiles: ['ios/App/foo', 'CHANGELOG.md'],
    manifestDiffs: Object.fromEntries(
      ['edge', 'api', 'hltb', 'metacritic', 'psprices'].map((key) => [key, ''])
    ),
    hasPreviousTag: true,
  });

  assert.equal(decision.skippedImages.length, IMAGE_KEYS.length);
});

test('evaluateDockerPublishDeploy fans out shared changes to api and scrapers', () => {
  const decision = evaluateDockerPublishDeploy({
    changedFiles: ['shared/foo.ts'],
    manifestDiffs: Object.fromEntries(
      ['edge', 'api', 'hltb', 'metacritic', 'psprices'].map((key) => [key, ''])
    ),
    hasPreviousTag: true,
  });

  assert.equal(decision.images.api.shouldPublish, true);
  assert.equal(decision.images.hltb.shouldPublish, true);
  assert.equal(decision.images.metacritic.shouldPublish, true);
  assert.equal(decision.images.psprices.shouldPublish, true);
  assert.equal(decision.images.edge.shouldPublish, false);
});

test('evaluateDockerPublishDeploy publishes edge and metacritic for metacritic src changes', () => {
  const decision = evaluateDockerPublishDeploy({
    changedFiles: ['metacritic-scraper/src/foo.ts'],
    manifestDiffs: Object.fromEntries(
      ['edge', 'api', 'hltb', 'metacritic', 'psprices'].map((key) => [key, ''])
    ),
    hasPreviousTag: true,
  });

  assert.equal(decision.images.edge.shouldPublish, true);
  assert.equal(decision.images.metacritic.shouldPublish, true);
});

test('evaluateDockerPublishDeploy publishes edge for root angular dependency bumps', () => {
  const decision = evaluateDockerPublishDeploy({
    changedFiles: ['package.json', 'package-lock.json'],
    manifestDiffs: {
      edge: `
--- a/package.json
+++ b/package.json
@@
-    "@angular/core": "21.2.15",
+    "@angular/core": "21.2.16",
`,
      api: '',
      hltb: '',
      metacritic: '',
      psprices: '',
    },
    hasPreviousTag: true,
  });

  assert.equal(decision.images.edge.shouldPublish, true);
  assert.equal(decision.images.api.shouldPublish, false);
});

test('evaluateDockerPublishDeploy publishes backup for backup script changes', () => {
  const decision = evaluateDockerPublishDeploy({
    changedFiles: ['scripts/backup/foo.sh'],
    manifestDiffs: Object.fromEntries(
      ['edge', 'api', 'hltb', 'metacritic', 'psprices'].map((key) => [key, ''])
    ),
    hasPreviousTag: true,
  });

  assert.equal(decision.images.backup.shouldPublish, true);
  assert.equal(decision.images.edge.shouldPublish, true);
});

test('evaluateDockerPublishDeploy publishes all images without a previous tag', () => {
  const decision = evaluateDockerPublishDeploy({
    changedFiles: ['server/foo.ts'],
    hasPreviousTag: false,
  });

  for (const imageKey of IMAGE_KEYS) {
    assert.equal(decision.images[imageKey].shouldPublish, true);
  }

  assert.deepEqual(decision.skippedImages, []);
});
