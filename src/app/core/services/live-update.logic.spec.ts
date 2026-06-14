import { describe, expect, it } from 'vitest';

import {
  buildLiveUpdateManifestUrl,
  parseIosLiveUpdateManifest,
  resolveBackendOriginFromGameApiBaseUrl,
  shouldStageLiveUpdateManifest,
} from './live-update.logic';

describe('live-update.logic', () => {
  it('parseIosLiveUpdateManifest validates required fields', () => {
    expect(
      parseIosLiveUpdateManifest({
        bundleId: 'v1.57.0-b42',
        semver: '1.57.0',
        nativeBuildNumber: '42',
        url: 'https://games.example.com/ota/ios/42/v1.57.0-b42.zip',
        checksum: 'abc',
        signature: 'sig',
      })
    ).toEqual({
      bundleId: 'v1.57.0-b42',
      semver: '1.57.0',
      nativeBuildNumber: '42',
      url: 'https://games.example.com/ota/ios/42/v1.57.0-b42.zip',
      checksum: 'abc',
      signature: 'sig',
    });

    expect(parseIosLiveUpdateManifest({ bundleId: 'only-id' })).toBeNull();
  });

  it('buildLiveUpdateManifestUrl targets per-native-build manifest path', () => {
    expect(buildLiveUpdateManifestUrl('https://games.example.com', '42')).toBe(
      'https://games.example.com/ota/ios/42/manifest.json'
    );
  });

  it('resolveBackendOriginFromGameApiBaseUrl strips /api suffix indirectly via URL host', () => {
    expect(resolveBackendOriginFromGameApiBaseUrl('https://games.example.com/api')).toBe(
      'https://games.example.com'
    );
  });

  it('shouldStageLiveUpdateManifest gates incompatible or already-staged bundles', () => {
    const manifest = parseIosLiveUpdateManifest({
      bundleId: 'v1.57.0-b42',
      semver: '1.57.0',
      nativeBuildNumber: '42',
      url: 'https://games.example.com/ota/ios/42/v1.57.0-b42.zip',
      checksum: 'abc',
      signature: 'sig',
    });

    expect(
      shouldStageLiveUpdateManifest({
        manifest,
        nativeBuildNumber: '42',
        currentBundleId: null,
        nextBundleId: null,
      })
    ).toEqual({ shouldStage: true, reason: 'update_available' });

    expect(
      shouldStageLiveUpdateManifest({
        manifest,
        nativeBuildNumber: '41',
        currentBundleId: null,
        nextBundleId: null,
      })
    ).toEqual({ shouldStage: false, reason: 'native_build_mismatch' });
  });
});
