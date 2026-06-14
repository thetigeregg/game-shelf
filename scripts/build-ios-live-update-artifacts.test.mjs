import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_EDGE_WEB_DIR,
  DEFAULT_OTA_OUTPUT_PATH,
  buildIosLiveUpdateArtifacts,
  resolveDefaultOtaWebDir,
} from './build-ios-live-update-artifacts.mjs';

test('resolveDefaultOtaWebDir uses isolated output under www/ios-ota/browser', () => {
  const cwd = '/tmp/game-shelf';
  assert.equal(resolveDefaultOtaWebDir(cwd), '/tmp/game-shelf/www/ios-ota/browser');
  assert.notEqual(resolveDefaultOtaWebDir(cwd), DEFAULT_EDGE_WEB_DIR);
});

test('buildIosLiveUpdateArtifacts runs build:ios:prod:ota without using www/browser', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ota-build-'));
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({ name: 'game-shelf', version: '1.0.0' }),
    'utf8'
  );

  const otaWebDir = resolveDefaultOtaWebDir(cwd);
  mkdirSync(otaWebDir, { recursive: true });
  writeFileSync(join(otaWebDir, 'index.html'), '<html></html>', 'utf8');

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const commands = [];

  const result = await buildIosLiveUpdateArtifacts({
    cwd,
    buildIosProd: true,
    writeEnvironment: false,
    write: false,
    semver: '1.0.0',
    nativeBuildNumber: '42',
    backendOrigin: 'https://example.com',
    privateKeyPem: privateKey.export({ type: 'pkcs1', format: 'pem' }),
    execFileSyncFn: (cmd, args) => {
      commands.push([cmd, ...args]);
      if (cmd === 'zip') {
        writeFileSync(args[1], 'zip-bytes', 'utf8');
      }
    },
  });

  assert.deepEqual(commands[0], ['npm', 'run', 'build:ios:prod:ota']);
  assert.ok(result.zipPath.endsWith('v1.0.0-b42.zip'));
  assert.equal(DEFAULT_OTA_OUTPUT_PATH, 'www/ios-ota');
});

test('buildIosLiveUpdateArtifacts passes injected processEnv to build:ios:prod:ota', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ota-build-'));
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({ name: 'game-shelf', version: '1.0.0' }),
    'utf8'
  );

  const otaWebDir = resolveDefaultOtaWebDir(cwd);
  mkdirSync(otaWebDir, { recursive: true });
  writeFileSync(join(otaWebDir, 'index.html'), '<html></html>', 'utf8');

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const injectedEnv = { OTA_INJECTED_ENV: 'from-process-env' };
  let capturedEnv;

  await buildIosLiveUpdateArtifacts({
    cwd,
    buildIosProd: true,
    writeEnvironment: false,
    write: false,
    processEnv: injectedEnv,
    semver: '1.0.0',
    nativeBuildNumber: '42',
    backendOrigin: 'https://example.com',
    privateKeyPem: privateKey.export({ type: 'pkcs1', format: 'pem' }),
    execFileSyncFn: (cmd, args, options) => {
      if (cmd === 'npm') {
        capturedEnv = options.env;
      }
      if (cmd === 'zip') {
        writeFileSync(args[1], 'zip-bytes', 'utf8');
      }
    },
  });

  assert.equal(capturedEnv.OTA_INJECTED_ENV, 'from-process-env');
});
