import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSharedEnv,
  ensureParentDirectories,
  isEntrypoint,
  printSuggestedIosLocalOrigin,
  waitForPostgresReady,
} from './worktree-dev.mjs';

test('printSuggestedIosLocalOrigin prints suggested local origin when LAN host is available', () => {
  const lines = [];

  printSuggestedIosLocalOrigin({
    processEnv: { IOS_LAN_HOST: '192.168.0.21' },
    log: (line) => lines.push(line),
  });

  assert.match(lines[0], /iOS local origin \(suggested\): http:\/\/192\.168\.0\.21:\d+/);
  assert.match(lines[1], /EDGE_BIND_HOST=0\.0\.0\.0/);
});

test('printSuggestedIosLocalOrigin reads IOS_LAN_HOST from .env when not exported', () => {
  const lines = [];

  printSuggestedIosLocalOrigin({
    processEnv: { PATH: '/usr/bin' },
    dotenvValues: { IOS_LAN_HOST: '192.168.0.55' },
    log: (line) => lines.push(line),
  });

  assert.match(lines[0], /iOS local origin \(suggested\): http:\/\/192\.168\.0\.55:\d+/);
});

test('printSuggestedIosLocalOrigin prints configured iOS run target from .env', () => {
  const lines = [];

  printSuggestedIosLocalOrigin({
    processEnv: { PATH: '/usr/bin' },
    dotenvValues: {
      IOS_LAN_HOST: '192.168.0.55',
      IOS_TARGET_ID: '00008140-0014444C1184801C',
      IOS_TARGET_NAME: "Jake's iPhone",
    },
    log: (line) => lines.push(line),
  });

  assert.match(lines[2], /iOS run target \(from \.env\): 00008140-0014444C1184801C/);
});

test('createSharedEnv keeps the dev manuals origin absolute by default', () => {
  const env = createSharedEnv({ processEnv: { PATH: '/usr/bin' } });

  assert.match(env.MANUALS_PUBLIC_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+\/manuals$/);
  assert.equal(env.PATH, '/usr/bin');
});

test('createSharedEnv preserves an explicit secrets host dir from the provided env', () => {
  const env = createSharedEnv({
    processEnv: {
      PATH: '/usr/bin',
      SECRETS_HOST_DIR: '/tmp/custom-secrets',
    },
  });

  assert.equal(env.SECRETS_HOST_DIR, '/tmp/custom-secrets');
});

test('ensureParentDirectories creates parent directories for each configured certificate output', () => {
  const createdDirectories = [];

  ensureParentDirectories(
    [
      '/tmp/custom-certs/nested/localhost.pem',
      '/tmp/custom-keys/other/localhost-key.pem',
      '/tmp/custom-certs/nested/localhost-copy.pem',
    ],
    {
      mkdir(directoryPath, options) {
        createdDirectories.push({ directoryPath, options });
      },
    }
  );

  assert.deepEqual(createdDirectories, [
    {
      directoryPath: '/tmp/custom-certs/nested',
      options: { recursive: true },
    },
    {
      directoryPath: '/tmp/custom-keys/other',
      options: { recursive: true },
    },
  ]);
});

test('isEntrypoint resolves relative script paths before comparing module urls', () => {
  assert.equal(
    isEntrypoint({
      argv1: 'scripts/worktree-dev.mjs',
      moduleUrl: new URL('./worktree-dev.mjs', import.meta.url).href,
    }),
    true
  );
});

test('waitForPostgresReady returns immediately when postgres is already accepting connections', () => {
  let attempts = 0;

  waitForPostgresReady({
    runCommand: () => {
      attempts += 1;
      return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
    },
    sleep: () => {
      throw new Error('sleep should not be called when postgres is ready');
    },
    log: () => undefined,
    error: () => undefined,
    exit: () => {
      throw new Error('exit should not be called when postgres is ready');
    },
  });

  assert.equal(attempts, 1);
});

test('waitForPostgresReady retries until postgres accepts connections', () => {
  let attempts = 0;
  const sleeps = [];

  waitForPostgresReady({
    maxAttempts: 3,
    delaySeconds: 1,
    runCommand: () => {
      attempts += 1;
      return { status: attempts >= 2 ? 0 : 1, stdout: Buffer.from(''), stderr: Buffer.from('') };
    },
    sleep: (seconds) => {
      sleeps.push(seconds);
    },
    log: () => undefined,
    error: () => undefined,
    exit: () => {
      throw new Error('exit should not be called when postgres becomes ready');
    },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [1]);
});

test('waitForPostgresReady exits when postgres never becomes ready', () => {
  let exitCode = null;

  waitForPostgresReady({
    maxAttempts: 2,
    delaySeconds: 1,
    runCommand: () => ({ status: 1, stdout: Buffer.from(''), stderr: Buffer.from('not ready') }),
    sleep: () => undefined,
    log: () => undefined,
    error: () => undefined,
    exit: (code) => {
      exitCode = code;
    },
  });

  assert.equal(exitCode, 1);
});
