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
    expect(resolveBackendOriginFromGameApiBaseUrl('http://localhost:8080/api')).toBe(
      'http://localhost:8080'
    );
  });

  it('resolveBackendOriginFromGameApiBaseUrl rejects empty or invalid origins', () => {
    expect(resolveBackendOriginFromGameApiBaseUrl('')).toBeNull();
    expect(resolveBackendOriginFromGameApiBaseUrl('not-a-url')).toBeNull();
    expect(resolveBackendOriginFromGameApiBaseUrl('ftp://games.example.com/api')).toBeNull();
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

    expect(
      shouldStageLiveUpdateManifest({
        manifest: null,
        nativeBuildNumber: '42',
        currentBundleId: null,
        nextBundleId: null,
      })
    ).toEqual({ shouldStage: false, reason: 'invalid_manifest' });

    expect(
      shouldStageLiveUpdateManifest({
        manifest,
        nativeBuildNumber: '',
        currentBundleId: null,
        nextBundleId: null,
      })
    ).toEqual({ shouldStage: false, reason: 'missing_native_build_number' });

    expect(
      shouldStageLiveUpdateManifest({
        manifest,
        nativeBuildNumber: '42',
        currentBundleId: 'v1.57.0-b42',
        nextBundleId: null,
      })
    ).toEqual({ shouldStage: false, reason: 'already_staged_or_active' });

    expect(
      shouldStageLiveUpdateManifest({
        manifest,
        nativeBuildNumber: '42',
        currentBundleId: null,
        nextBundleId: 'v1.57.0-b42',
      })
    ).toEqual({ shouldStage: false, reason: 'already_staged_or_active' });
  });
});
