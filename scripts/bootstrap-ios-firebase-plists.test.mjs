import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bootstrapIosFirebasePlists,
  DEFAULT_FIREBASE_PLISTS,
  expandUserPath,
  formatFirebasePlistStatusLines,
  formatMissingFirebasePlistMessage,
  resolveFirebasePlistMappings,
  resolveSharedFirebaseDir,
} from './bootstrap-ios-firebase-plists.mjs';

test('expandUserPath expands tilde-prefixed paths', () => {
  const expanded = expandUserPath('~/config/game-shelf/ios');
  assert.ok(expanded.endsWith('/config/game-shelf/ios'));
});

test('resolveSharedFirebaseDir prefers WORKTREE_IOS_FIREBASE_DIR override', () => {
  assert.equal(
    resolveSharedFirebaseDir({ WORKTREE_IOS_FIREBASE_DIR: '~/custom/firebase' }),
    expandUserPath('~/custom/firebase')
  );
});

test('resolveFirebasePlistMappings resolves shared and destination paths', () => {
  const mappings = resolveFirebasePlistMappings({
    sharedDir: '/shared/ios',
    repoRoot: '/repo',
    plists: DEFAULT_FIREBASE_PLISTS,
  });

  assert.equal(mappings.length, 2);
  assert.equal(mappings[0].sharedPath, '/shared/ios/GoogleService-Info.dev.plist');
  assert.equal(
    mappings[0].destinationPath,
    '/repo/ios/App/App/Firebase/Dev/GoogleService-Info.plist'
  );
});

test('bootstrapIosFirebasePlists copies missing destination files', () => {
  const copied = [];
  const exists = new Set(['/shared/GoogleService-Info.dev.plist']);

  const result = bootstrapIosFirebasePlists({
    sharedDir: '/shared',
    repoRoot: '/repo',
    plists: {
      dev: DEFAULT_FIREBASE_PLISTS.dev,
    },
    existsSyncFn: (filePath) => exists.has(filePath),
    mkdirSyncFn: () => undefined,
    copyFileSyncFn: (source, destination) => {
      copied.push({ source, destination });
      exists.add(destination);
    },
    log: () => undefined,
    warn: () => undefined,
  });

  assert.deepEqual(copied, [
    {
      source: '/shared/GoogleService-Info.dev.plist',
      destination: '/repo/ios/App/App/Firebase/Dev/GoogleService-Info.plist',
    },
  ]);
  assert.equal(result.copied.length, 1);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.missing.length, 0);
});

test('bootstrapIosFirebasePlists skips existing destinations unless forced', () => {
  const copied = [];
  const exists = new Set([
    '/shared/GoogleService-Info.dev.plist',
    '/repo/ios/App/App/Firebase/Dev/GoogleService-Info.plist',
  ]);

  const skipped = bootstrapIosFirebasePlists({
    sharedDir: '/shared',
    repoRoot: '/repo',
    plists: {
      dev: DEFAULT_FIREBASE_PLISTS.dev,
    },
    existsSyncFn: (filePath) => exists.has(filePath),
    mkdirSyncFn: () => undefined,
    copyFileSyncFn: (source, destination) => copied.push({ source, destination }),
    log: () => undefined,
    warn: () => undefined,
  });

  assert.equal(skipped.copied.length, 0);
  assert.equal(skipped.skipped.length, 1);
  assert.equal(copied.length, 0);

  bootstrapIosFirebasePlists({
    sharedDir: '/shared',
    repoRoot: '/repo',
    plists: {
      dev: DEFAULT_FIREBASE_PLISTS.dev,
    },
    force: true,
    existsSyncFn: (filePath) => exists.has(filePath),
    mkdirSyncFn: () => undefined,
    copyFileSyncFn: (source, destination) => copied.push({ source, destination }),
    log: () => undefined,
    warn: () => undefined,
  });

  assert.equal(copied.length, 1);
});

test('bootstrapIosFirebasePlists warns when shared files are missing', () => {
  const warnings = [];

  const result = bootstrapIosFirebasePlists({
    sharedDir: '/shared',
    repoRoot: '/repo',
    plists: DEFAULT_FIREBASE_PLISTS,
    existsSyncFn: () => false,
    mkdirSyncFn: () => undefined,
    copyFileSyncFn: () => undefined,
    log: () => undefined,
    warn: (message) => warnings.push(message),
  });

  assert.equal(result.missing.length, 2);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Missing shared Firebase plist/);
});

test('bootstrapIosFirebasePlists fails when required shared files are missing', () => {
  assert.throws(
    () =>
      bootstrapIosFirebasePlists({
        sharedDir: '/shared',
        repoRoot: '/repo',
        plists: DEFAULT_FIREBASE_PLISTS,
        failOnMissing: true,
        existsSyncFn: () => false,
        mkdirSyncFn: () => undefined,
        copyFileSyncFn: () => undefined,
        log: () => undefined,
        warn: () => undefined,
      }),
    /Missing shared Firebase plist/
  );
});

test('formatMissingFirebasePlistMessage includes setup instructions', () => {
  const message = formatMissingFirebasePlistMessage(
    resolveFirebasePlistMappings({
      sharedDir: '/shared',
      repoRoot: '/repo',
      plists: { dev: DEFAULT_FIREBASE_PLISTS.dev },
    }),
    '/shared'
  );

  assert.match(message.join('\n'), /mkdir -p \/shared/);
  assert.match(message.join('\n'), /GoogleService-Info\.dev\.plist/);
});

test('formatFirebasePlistStatusLines reports shared and destination presence', () => {
  const exists = new Set([
    '/shared/GoogleService-Info.dev.plist',
    '/repo/ios/App/App/Firebase/Dev/GoogleService-Info.plist',
  ]);

  const lines = formatFirebasePlistStatusLines({
    sharedDir: '/shared',
    repoRoot: '/repo',
    plists: DEFAULT_FIREBASE_PLISTS,
    existsSyncFn: (filePath) => exists.has(filePath),
  });

  assert.match(lines[0], /Firebase shared dir: \/shared/);
  assert.match(lines[1], /dev: shared \[present\].*\[present\]/);
  assert.match(lines[2], /prod: shared \[missing\].*\[missing\]/);
});
