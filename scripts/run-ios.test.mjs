import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildCapLiveReloadArgs,
  buildCapRunArgs,
  buildNgServeArgs,
  ensureLocalEnvironmentFile,
  loadRunIosEnv,
  resolveLiveReloadHost,
  resolveScheme,
  resolveVariant,
} from './run-ios.mjs';

test('resolveVariant accepts local, prod, and live', () => {
  assert.equal(resolveVariant('local'), 'local');
  assert.equal(resolveVariant('prod'), 'prod');
  assert.equal(resolveVariant('live'), 'live');
  assert.equal(resolveVariant(' PROD '), 'prod');
});

test('resolveVariant rejects invalid values', () => {
  assert.throws(() => resolveVariant('staging'), /Expected "local", "prod", or "live"/);
  assert.throws(() => resolveVariant(''), /Expected "local", "prod", or "live"/);
});

test('resolveScheme maps variants to Xcode schemes', () => {
  assert.equal(resolveScheme('local'), 'App DEV');
  assert.equal(resolveScheme('prod'), 'App PROD');
  assert.equal(resolveScheme('live'), 'App DEV');
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

test('ensureLocalEnvironmentFile returns existing local environment file', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'run-ios-env-'));
  const envDir = path.join(cwd, 'src/environments');
  const localPath = path.join(envDir, 'environment.local.ts');

  mkdirSync(envDir, { recursive: true });
  writeFileSync(localPath, 'export const environment = {};\n', 'utf8');

  assert.equal(ensureLocalEnvironmentFile(cwd), localPath);
});

test('ensureLocalEnvironmentFile bootstraps from example when missing', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'run-ios-env-'));
  const envDir = path.join(cwd, 'src/environments');
  const examplePath = path.join(envDir, 'environment.local.example.ts');
  const localPath = path.join(envDir, 'environment.local.ts');
  const lines = [];

  mkdirSync(envDir, { recursive: true });
  writeFileSync(examplePath, 'export const environment = { bootstrapped: true };\n', 'utf8');

  assert.equal(
    ensureLocalEnvironmentFile(cwd, {
      log: (line) => lines.push(line),
      copyFile: (source, destination) => {
        writeFileSync(destination, `copied:${source}`, 'utf8');
      },
    }),
    localPath
  );
  assert.match(lines[0], /Created src\/environments\/environment\.local\.ts/);
});

test('resolveLiveReloadHost prefers IOS_LAN_HOST', () => {
  assert.equal(resolveLiveReloadHost({ IOS_LAN_HOST: '192.168.0.21' }), '192.168.0.21');
});

test('resolveLiveReloadHost throws when LAN host cannot be resolved', () => {
  assert.throws(
    () =>
      resolveLiveReloadHost(
        {},
        {
          networkInterfaces: () => ({
            lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
          }),
        }
      ),
    /Unable to resolve LAN host/
  );
});

test('buildNgServeArgs uses worktree frontend port, external bind host, and ios-live configuration', () => {
  const context = {
    config: {
      worktree: {
        frontend: {
          externalHost: '0.0.0.0',
        },
      },
    },
    runtime: {
      ports: {
        FRONTEND_PORT: 14146,
      },
    },
  };

  assert.deepEqual(buildNgServeArgs(context, '/tmp/proxy.worktree.feat-plug-one.json'), [
    '--port',
    '14146',
    '--host',
    '0.0.0.0',
    '--proxy-config',
    '/tmp/proxy.worktree.feat-plug-one.json',
    '--configuration',
    'ios-live',
  ]);
});

test('buildCapLiveReloadArgs includes live reload flags and App DEV scheme', () => {
  assert.deepEqual(
    buildCapLiveReloadArgs({
      env: { IOS_TARGET_ID: '00008110-ABCDEF' },
      frontendPort: 14146,
      lanHost: '192.168.0.21',
    }),
    [
      'run',
      'ios',
      '--no-sync',
      '--scheme',
      'App DEV',
      '--target',
      '00008110-ABCDEF',
      '--live-reload',
      '--host',
      '192.168.0.21',
      '--port',
      '14146',
    ]
  );
});

test('buildCapLiveReloadArgs prefers IOS_TARGET_ID over IOS_TARGET_NAME', () => {
  const args = buildCapLiveReloadArgs({
    env: {
      IOS_TARGET_ID: '00008110-ABCDEF',
      IOS_TARGET_NAME: 'Your iPhone',
    },
    frontendPort: 14146,
    lanHost: '192.168.0.21',
  });

  assert.ok(args.includes('--target'));
  assert.ok(args.includes('00008110-ABCDEF'));
  assert.equal(args.includes('--target-name'), false);
});

test('buildCapLiveReloadArgs forwards extra cap run args', () => {
  assert.deepEqual(
    buildCapLiveReloadArgs({
      env: {},
      frontendPort: 14146,
      lanHost: '192.168.0.21',
      extraArgs: ['--configuration', 'Debug'],
    }),
    [
      'run',
      'ios',
      '--no-sync',
      '--scheme',
      'App DEV',
      '--live-reload',
      '--host',
      '192.168.0.21',
      '--port',
      '14146',
      '--configuration',
      'Debug',
    ]
  );
});
