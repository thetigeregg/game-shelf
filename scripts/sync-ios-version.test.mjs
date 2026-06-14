import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveEnvFirebasePlistSources,
  resolveFirebasePlistMappings,
} from './bootstrap-ios-firebase-plists.mjs';
import {
  parseSyncIosVersionArgs,
  readPackageVersion,
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

test('readPackageVersion returns package.json version', () => {
  const version = readPackageVersion(new URL('../package.json', import.meta.url));
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

test('parseSyncIosVersionArgs rejects --pbxproj without a path', () => {
  assert.throws(
    () => parseSyncIosVersionArgs(['--build-number', '42', '--pbxproj']),
    /--pbxproj requires a path/
  );
});
