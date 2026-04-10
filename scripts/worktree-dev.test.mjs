import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPwaStackEnv,
  createSharedEnv,
  ensureParentDirectories,
  isEntrypoint,
  runPwa,
} from './worktree-dev.mjs';

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

test('createPwaStackEnv overrides manuals links to the local HTTPS proxy path', () => {
  const env = createPwaStackEnv({
    MANUALS_PUBLIC_BASE_URL: 'http://127.0.0.1:9999/manuals',
    NODE_ENV: 'development',
  });

  assert.equal(env.MANUALS_PUBLIC_BASE_URL, '/manuals');
  assert.equal(env.NODE_ENV, 'development');
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

test('runPwa serve exits with guidance when the edge service is unreachable', async () => {
  const errors = [];
  const exitCodes = [];
  const operations = [];

  await runPwa('serve', {
    isPortReachableFn: async () => false,
    reconcilePwaStackManualsBaseUrlFn() {
      operations.push('reconcile');
    },
    runPwaServeFn() {
      operations.push('serve');
    },
    portsConfig: {
      EDGE_HOST_PORT: 9080,
      PWA_ROOT_CA_PORT: 9300,
    },
    exitFn(code) {
      exitCodes.push(code);
    },
    logger: {
      log() {},
      error(message) {
        errors.push(message);
      },
    },
  });

  assert.deepEqual(exitCodes, [1]);
  assert.deepEqual(operations, []);
  assert.match(errors[0], /edge service is unavailable at http:\/\/127\.0\.0\.1:9080/);
  assert.match(errors[1], /npx devx worktree stack up/);
});

test('runPwa simulator reconciles the stack before building and serving', async () => {
  const operations = [];

  await runPwa('simulator', {
    isPortReachableFn: async () => true,
    reconcilePwaStackManualsBaseUrlFn() {
      operations.push('reconcile');
    },
    buildPwaFn() {
      operations.push('build');
    },
    runPwaServeFn() {
      operations.push('serve');
    },
    exitFn(code) {
      throw new Error(`unexpected exit: ${String(code)}`);
    },
    logger: console,
  });

  assert.deepEqual(operations, ['reconcile', 'build', 'serve']);
});

test('runPwa certs-check prints setup guidance when cert files are not configured', async () => {
  const exitCodes = [];
  const errors = [];
  const operations = [];

  await runPwa('certs-check', {
    getSimulatorCertificateStatusFn() {
      return {
        mkcertAvailable: true,
        hasRootCa: true,
        isConfigured: false,
        certPath: '/tmp/localhost.pem',
        keyPath: '/tmp/localhost-key.pem',
        rootCaPath: '/tmp/rootCA.pem',
      };
    },
    printMissingCertificateInstructionsFn() {
      operations.push('print-missing-cert-instructions');
    },
    servePwaRootCertificateFn() {
      operations.push('serve-root');
    },
    exitFn(code) {
      exitCodes.push(code);
    },
    logger: {
      log() {},
      error(message) {
        errors.push(message);
      },
    },
  });

  assert.deepEqual(exitCodes, [1]);
  assert.deepEqual(operations, ['print-missing-cert-instructions']);
  assert.deepEqual(errors, []);
});

test('runPwa certs-check reports configured certificate paths', async () => {
  const logs = [];
  const exitCodes = [];

  await runPwa('certs-check', {
    getSimulatorCertificateStatusFn() {
      return {
        mkcertAvailable: true,
        hasRootCa: true,
        isConfigured: true,
        certPath: '/tmp/localhost.pem',
        keyPath: '/tmp/localhost-key.pem',
        rootCaPath: '/tmp/rootCA.pem',
      };
    },
    portsConfig: {
      EDGE_HOST_PORT: 9080,
      PWA_ROOT_CA_PORT: 9300,
    },
    exitFn(code) {
      exitCodes.push(code);
    },
    logger: {
      log(message) {
        logs.push(message);
      },
      error(message) {
        throw new Error(`unexpected error log: ${message}`);
      },
    },
  });

  assert.deepEqual(exitCodes, []);
  assert.match(logs[0], /PWA HTTPS certificates are configured/);
  assert.match(logs[1], /\/tmp\/localhost\.pem/);
  assert.match(logs[2], /\/tmp\/localhost-key\.pem/);
  assert.match(logs[3], /\/tmp\/rootCA\.pem/);
  assert.match(logs[5], /http:\/\/localhost:9300\/rootCA\.pem/);
});
