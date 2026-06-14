import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import test from 'node:test';

import {
  buildIosLiveUpdateBundleId,
  buildIosLiveUpdateManifest,
  computeBundleChecksum,
  normalizeBackendOrigin,
  parseIosLiveUpdateManifest,
  shouldStageLiveUpdateManifest,
  signBundleBuffer,
} from './ios-live-update-common.mjs';
import { signBundleFile } from './sign-ios-live-update-bundle.mjs';

test('computeBundleChecksum returns stable sha256 hex', () => {
  const buffer = Buffer.from('game-shelf-ota-test');
  const checksum = computeBundleChecksum(buffer);
  assert.match(checksum, /^[a-f0-9]{64}$/);
  assert.equal(checksum, computeBundleChecksum(buffer));
});

test('signBundleBuffer verifies with RSA-SHA256 public key', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const buffer = Buffer.from('signed-bundle-contents');
  const signature = signBundleBuffer(buffer, privateKey.export({ type: 'pkcs1', format: 'pem' }));

  const verifier = createVerify('RSA-SHA256');
  verifier.update(buffer);
  verifier.end();

  assert.equal(
    verifier.verify(publicKey.export({ type: 'pkcs1', format: 'pem' }), signature, 'base64'),
    true
  );
});

test('signBundleFile returns checksum and signature for zip bytes', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const readFileSyncFn = () => Buffer.from('zip-bytes');

  const result = signBundleFile(
    '/tmp/fake.zip',
    privateKey.export({ type: 'pkcs1', format: 'pem' }),
    readFileSyncFn
  );

  assert.match(result.checksum, /^[a-f0-9]{64}$/);
  assert.ok(result.signature.length > 0);
  assert.equal(result.sizeBytes, 9);
});

test('buildIosLiveUpdateBundleId encodes semver and native build number', () => {
  assert.equal(buildIosLiveUpdateBundleId('1.57.0', 42), 'v1.57.0-b42');
});

test('buildIosLiveUpdateManifest builds https bundle URL', () => {
  const manifest = buildIosLiveUpdateManifest({
    bundleId: 'v1.57.0-b42',
    semver: '1.57.0',
    nativeBuildNumber: '42',
    backendOrigin: 'https://games.example.com/',
    checksum: 'abc',
    signature: 'sig',
  });

  assert.equal(manifest.url, 'https://games.example.com/ota/ios/42/v1.57.0-b42.zip');
});

test('normalizeBackendOrigin rejects non-https origins', () => {
  assert.throws(() => normalizeBackendOrigin('http://localhost:8080'), /https/);
});

test('shouldStageLiveUpdateManifest gates by native build and existing bundle', () => {
  const manifest = parseIosLiveUpdateManifest({
    bundleId: 'v1.57.0-b42',
    semver: '1.57.0',
    nativeBuildNumber: '42',
    url: 'https://games.example.com/ota/ios/42/v1.57.0-b42.zip',
    checksum: 'abc',
    signature: 'sig',
  });

  assert.deepEqual(
    shouldStageLiveUpdateManifest({
      manifest,
      nativeBuildNumber: '42',
      currentBundleId: null,
      nextBundleId: null,
    }),
    { shouldStage: true, reason: 'update_available' }
  );

  assert.deepEqual(
    shouldStageLiveUpdateManifest({
      manifest,
      nativeBuildNumber: '41',
      currentBundleId: null,
      nextBundleId: null,
    }),
    { shouldStage: false, reason: 'native_build_mismatch' }
  );

  assert.deepEqual(
    shouldStageLiveUpdateManifest({
      manifest,
      nativeBuildNumber: '42',
      currentBundleId: 'v1.57.0-b42',
      nextBundleId: null,
    }),
    { shouldStage: false, reason: 'already_staged_or_active' }
  );
});
