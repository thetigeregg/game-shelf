import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCapRunArgs, loadRunIosEnv, resolveScheme, resolveVariant } from './run-ios.mjs';

test('resolveVariant accepts local and prod', () => {
  assert.equal(resolveVariant('local'), 'local');
  assert.equal(resolveVariant('prod'), 'prod');
  assert.equal(resolveVariant(' PROD '), 'prod');
});

test('resolveVariant rejects invalid values', () => {
  assert.throws(() => resolveVariant('staging'), /Expected "local" or "prod"/);
  assert.throws(() => resolveVariant(''), /Expected "local" or "prod"/);
});

test('resolveScheme maps variants to Xcode schemes', () => {
  assert.equal(resolveScheme('local'), 'App DEV');
  assert.equal(resolveScheme('prod'), 'App PROD');
});

test('buildCapRunArgs includes scheme and no-sync', () => {
  assert.deepEqual(buildCapRunArgs({ variant: 'local', env: {} }), [
    'run',
    'ios',
    '--no-sync',
    '--scheme',
    'App DEV',
  ]);
  assert.deepEqual(buildCapRunArgs({ variant: 'prod', env: {} }), [
    'run',
    'ios',
    '--no-sync',
    '--scheme',
    'App PROD',
  ]);
});

test('buildCapRunArgs prefers IOS_TARGET_ID over IOS_TARGET_NAME', () => {
  assert.deepEqual(
    buildCapRunArgs({
      variant: 'local',
      env: {
        IOS_TARGET_ID: '00008110-ABCDEF',
        IOS_TARGET_NAME: 'Your iPhone',
      },
    }),
    ['run', 'ios', '--no-sync', '--scheme', 'App DEV', '--target', '00008110-ABCDEF']
  );
});

test('buildCapRunArgs uses IOS_TARGET_NAME when ID is unset', () => {
  assert.deepEqual(
    buildCapRunArgs({
      variant: 'prod',
      env: { IOS_TARGET_NAME: 'Your iPhone' },
    }),
    ['run', 'ios', '--no-sync', '--scheme', 'App PROD', '--target-name', 'Your iPhone']
  );
});

test('loadRunIosEnv merges .env values and lets process env override', () => {
  const env = loadRunIosEnv(
    {
      IOS_TARGET_NAME: 'Shell iPhone',
      PATH: '/usr/bin',
    },
    {
      dotenvValues: {
        IOS_TARGET_NAME: 'Dotenv iPhone',
        IOS_TARGET_ID: '00008110-ABCDEF',
      },
    }
  );

  assert.equal(env.IOS_TARGET_NAME, 'Shell iPhone');
  assert.equal(env.IOS_TARGET_ID, '00008110-ABCDEF');
  assert.equal(env.PATH, '/usr/bin');
});

test('buildCapRunArgs forwards extra cap run args', () => {
  assert.deepEqual(buildCapRunArgs({ variant: 'local', env: {}, extraArgs: ['--live-reload'] }), [
    'run',
    'ios',
    '--no-sync',
    '--scheme',
    'App DEV',
    '--live-reload',
  ]);
});
