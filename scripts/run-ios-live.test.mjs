import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCapLiveReloadArgs,
  buildNgServeArgs,
  resolveLiveReloadHost,
} from './run-ios-live.mjs';

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
