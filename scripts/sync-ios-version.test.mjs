import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveEnvFirebasePlistSources,
  resolveFirebasePlistMappings,
} from './bootstrap-ios-firebase-plists.mjs';
import {
  assertMarketingVersionsMatchPackage,
  parseSyncIosVersionArgs,
  readPackageVersion,
  readPbxprojMarketingVersions,
  syncIosMarketingVersion,
  updateAllMarketingVersionsInPbxproj,
  updateProdTargetVersionsInPbxproj,
} from './sync-ios-version.mjs';

const SAMPLE_PBXPROJ = `\
\t\t3A0B10B92FDB3A630015969E /* Debug */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tCURRENT_PROJECT_VERSION = 1;
\t\t\t\tMARKETING_VERSION = 1.0.0;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = io.github.thetigeregg.gameshelf;
\t\t\t};
\t\t\tname = Debug;
\t\t};
\t\t3A0B10BA2FDB3A630015969E /* Release */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tCURRENT_PROJECT_VERSION = 1;
\t\t\t\tMARKETING_VERSION = 1.0.0;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = io.github.thetigeregg.gameshelf;
\t\t\t};
\t\t\tname = Release;
\t\t};
\t\t504EC3171FED79650016851F /* Debug */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tCURRENT_PROJECT_VERSION = 1;
\t\t\t\tMARKETING_VERSION = 1.0.0;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = io.github.thetigeregg.gameshelf.dev;
\t\t\t};
\t\t\tname = Debug;
\t\t};`;

test('updateAllMarketingVersionsInPbxproj updates all targets', () => {
  const updated = updateAllMarketingVersionsInPbxproj(SAMPLE_PBXPROJ, {
    marketingVersion: '2.3.4',
  });

  assert.equal((updated.match(/MARKETING_VERSION = 2\.3\.4;/g) ?? []).length, 3);
  assert.deepEqual(readPbxprojMarketingVersions(updated), ['2.3.4']);
  assert.match(updated, /CURRENT_PROJECT_VERSION = 1;/g);
  assert.equal((updated.match(/CURRENT_PROJECT_VERSION = 1;/g) ?? []).length, 3);
});

test('updateProdTargetVersionsInPbxproj updates only App PROD build settings', () => {
  const updated = updateProdTargetVersionsInPbxproj(SAMPLE_PBXPROJ, {
    marketingVersion: '2.3.4',
    buildNumber: 42,
  });

  assert.match(updated, /MARKETING_VERSION = 2\.3\.4;/g);
  assert.equal((updated.match(/MARKETING_VERSION = 2\.3\.4;/g) ?? []).length, 2);
  assert.match(updated, /CURRENT_PROJECT_VERSION = 42;/g);
  assert.equal((updated.match(/CURRENT_PROJECT_VERSION = 42;/g) ?? []).length, 2);
  assert.match(updated, /PRODUCT_BUNDLE_IDENTIFIER = io\.github\.thetigeregg\.gameshelf\.dev;/);
  assert.match(
    updated,
    /MARKETING_VERSION = 1\.0\.0;\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = io\.github\.thetigeregg\.gameshelf\.dev;/
  );
});

test('resolveEnvFirebasePlistSources reads prod and dev override paths', () => {
  const sources = resolveEnvFirebasePlistSources({
    IOS_FIREBASE_PROD_PLIST_PATH: '/tmp/prod.plist',
    IOS_FIREBASE_DEV_PLIST_PATH: '/tmp/dev.plist',
  });

  assert.equal(sources.prod, '/tmp/prod.plist');
  assert.equal(sources.dev, '/tmp/dev.plist');
});

test('resolveFirebasePlistMappings prefers env source paths when configured', () => {
  const [prodMapping] = resolveFirebasePlistMappings({
    sharedDir: '/shared',
    repoRoot: '/repo',
    envSources: { prod: '/tmp/prod.plist' },
  }).filter((mapping) => mapping.variant === 'prod');

  assert.equal(prodMapping.sharedPath, '/tmp/prod.plist');
  assert.equal(prodMapping.source, 'env');
  assert.equal(
    prodMapping.destinationPath,
    '/repo/ios/App/App/Firebase/Prod/GoogleService-Info.plist'
  );
});

test('updateProdTargetVersionsInPbxproj rejects non-integer build numbers', () => {
  assert.throws(
    () =>
      updateProdTargetVersionsInPbxproj(SAMPLE_PBXPROJ, {
        marketingVersion: '2.3.4',
        buildNumber: 'abc',
      }),
    /buildNumber must be a positive integer/
  );
});

test('updateProdTargetVersionsInPbxproj rejects zero build numbers', () => {
  assert.throws(
    () =>
      updateProdTargetVersionsInPbxproj(SAMPLE_PBXPROJ, {
        marketingVersion: '2.3.4',
        buildNumber: 0,
      }),
    /buildNumber must be a positive integer/
  );
});

test('resolveFirebasePlistMappings rejects unknown variant keys', () => {
  assert.throws(
    () =>
      resolveFirebasePlistMappings({
        sharedDir: '/shared',
        repoRoot: '/repo',
        variants: ['staging'],
      }),
    /Unknown Firebase plist variant "staging"/
  );
});

test('readPackageVersion returns package.json version', () => {
  const version = readPackageVersion(new URL('../package.json', import.meta.url));
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

test('parseSyncIosVersionArgs accepts --marketing-only without build number', () => {
  const args = parseSyncIosVersionArgs(['--marketing-only']);

  assert.equal(args.marketingOnly, true);
  assert.equal(args.buildNumber, null);
});

test('parseSyncIosVersionArgs accepts --check', () => {
  const args = parseSyncIosVersionArgs(['--check']);

  assert.equal(args.check, true);
});

test('assertMarketingVersionsMatchPackage passes when versions match', () => {
  assert.doesNotThrow(() =>
    assertMarketingVersionsMatchPackage({
      packageJsonPath: '/tmp/package.json',
      pbxprojPath: '/tmp/project.pbxproj',
      readFileSyncFn: (filePath) => {
        if (filePath === '/tmp/package.json') {
          return JSON.stringify({ version: '2.3.4' });
        }

        return SAMPLE_PBXPROJ.replaceAll('1.0.0', '2.3.4');
      },
    })
  );
});

test('assertMarketingVersionsMatchPackage fails when versions mismatch', () => {
  assert.throws(
    () =>
      assertMarketingVersionsMatchPackage({
        packageJsonPath: '/tmp/package.json',
        pbxprojPath: '/tmp/project.pbxproj',
        readFileSyncFn: (filePath) => {
          if (filePath === '/tmp/package.json') {
            return JSON.stringify({ version: '2.3.4' });
          }

          return SAMPLE_PBXPROJ;
        },
      }),
    /MARKETING_VERSION mismatch/
  );
});

test('syncIosMarketingVersion writes all marketing versions from package.json', () => {
  let written = null;
  syncIosMarketingVersion({
    marketingVersion: '9.9.9',
    pbxprojPath: '/tmp/project.pbxproj',
    readFileSyncFn: () => SAMPLE_PBXPROJ,
    writeFileSyncFn: (_path, content) => {
      written = content;
    },
  });

  assert.equal((written.match(/MARKETING_VERSION = 9\.9\.9;/g) ?? []).length, 3);
});

test('parseSyncIosVersionArgs rejects --pbxproj without a path', () => {
  assert.throws(
    () => parseSyncIosVersionArgs(['--build-number', '42', '--pbxproj']),
    /--pbxproj requires a path/
  );
});

test('parseSyncIosVersionArgs defaults pbxproj path to repo root', () => {
  const args = parseSyncIosVersionArgs(['--build-number', '42']);

  assert.match(args.pbxprojPath, /ios\/App\/App\.xcodeproj\/project\.pbxproj$/);
  assert.doesNotMatch(args.pbxprojPath, /fastlane\/ios/);
});
