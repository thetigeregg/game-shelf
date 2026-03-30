import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAppVersion,
  getAppVersionInfo,
  getRuntimeConfigSource,
  getFirebaseVapidKey,
  getFirebaseWebConfig,
  hasLiveRuntimeConfig,
  isE2eFixturesEnabled,
  isMgcImportFeatureEnabled,
  isRecommendationsExploreEnabled,
  isTasFeatureEnabled,
  persistRuntimeConfig,
  setLiveRuntimeConfig,
} from './runtime-config';

describe('runtime-config', () => {
  beforeEach(() => {
    delete window.__GAME_SHELF_RUNTIME_CONFIG__;
    localStorage.clear();
  });

  afterEach(() => {
    delete window.__GAME_SHELF_RUNTIME_CONFIG__;
    localStorage.clear();
  });

  describe('isMgcImportFeatureEnabled()', () => {
    it('returns the environment default (false) when no runtime config is set', () => {
      expect(isMgcImportFeatureEnabled()).toBe(false);
    });

    it('returns true when runtime config sets showMgcImport to boolean true', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = { featureFlags: { showMgcImport: true } };
      expect(isMgcImportFeatureEnabled()).toBe(true);
    });

    it('returns false when runtime config sets showMgcImport to boolean false', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = { featureFlags: { showMgcImport: false } };
      expect(isMgcImportFeatureEnabled()).toBe(false);
    });

    it('parses truthy string values: "true", "1", "yes", "on"', () => {
      for (const val of ['true', '1', 'yes', 'on', ' TRUE ', ' Yes ']) {
        window.__GAME_SHELF_RUNTIME_CONFIG__ = {
          featureFlags: { showMgcImport: val as unknown as boolean },
        };
        expect(isMgcImportFeatureEnabled()).toBe(true);
      }
    });

    it('parses falsy string values: "false", "0", "no", "off"', () => {
      for (const val of ['false', '0', 'no', 'off', ' FALSE ']) {
        window.__GAME_SHELF_RUNTIME_CONFIG__ = {
          featureFlags: { showMgcImport: val as unknown as boolean },
        };
        expect(isMgcImportFeatureEnabled()).toBe(false);
      }
    });

    it('falls back to environment default for unrecognized string values', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { showMgcImport: 'maybe' as unknown as boolean },
      };
      expect(isMgcImportFeatureEnabled()).toBe(false);
    });

    it('falls back to environment default when featureFlags is absent', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {};
      expect(isMgcImportFeatureEnabled()).toBe(false);
    });
  });

  describe('isE2eFixturesEnabled()', () => {
    it('returns the environment default (false) when no runtime config is set', () => {
      expect(isE2eFixturesEnabled()).toBe(false);
    });

    it('returns true when runtime config sets e2eFixtures to boolean true', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = { featureFlags: { e2eFixtures: true } };
      expect(isE2eFixturesEnabled()).toBe(true);
    });

    it('returns false when runtime config sets e2eFixtures to boolean false', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = { featureFlags: { e2eFixtures: false } };
      expect(isE2eFixturesEnabled()).toBe(false);
    });

    it('parses "1" and "true" string values as true', () => {
      for (const val of ['1', 'true']) {
        window.__GAME_SHELF_RUNTIME_CONFIG__ = {
          featureFlags: { e2eFixtures: val as unknown as boolean },
        };
        expect(isE2eFixturesEnabled()).toBe(true);
      }
    });

    it('falls back to environment default for non-boolean, non-string values', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { e2eFixtures: 42 as unknown as boolean },
      };
      expect(isE2eFixturesEnabled()).toBe(false);
    });
  });

  describe('isTasFeatureEnabled()', () => {
    it('returns the environment default (false) when no runtime config is set', () => {
      expect(isTasFeatureEnabled()).toBe(false);
    });

    it('returns true when runtime config sets tasEnabled to boolean true', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = { featureFlags: { tasEnabled: true } };
      expect(isTasFeatureEnabled()).toBe(true);
    });

    it('returns false when runtime config sets tasEnabled to boolean false', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = { featureFlags: { tasEnabled: false } };
      expect(isTasFeatureEnabled()).toBe(false);
    });
  });

  describe('getAppVersion()', () => {
    it('returns "0.0.0" when no runtime config is set', () => {
      expect(getAppVersion()).toBe('0.0.0');
    });

    it('returns the version from runtime config', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = { appVersion: '1.2.3' };
      expect(getAppVersion()).toBe('1.2.3');
    });

    it('trims whitespace from the version string', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = { appVersion: '  2.0.0  ' };
      expect(getAppVersion()).toBe('2.0.0');
    });

    it('returns "0.0.0" for an empty string version', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = { appVersion: '' };
      expect(getAppVersion()).toBe('0.0.0');
    });

    it('returns "0.0.0" for a whitespace-only version', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = { appVersion: '   ' };
      expect(getAppVersion()).toBe('0.0.0');
    });

    it('returns "0.0.0" when appVersion is absent from config', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {};
      expect(getAppVersion()).toBe('0.0.0');
    });

    it('falls back to the persisted runtime config version when live config is unavailable', () => {
      persistRuntimeConfig({ appVersion: '9.9.9' });

      expect(getAppVersion()).toBe('9.9.9');
      expect(getRuntimeConfigSource()).toBe('persisted');
    });
  });

  describe('getAppVersionInfo()', () => {
    it('reports a live source when runtime config is present on window', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = { appVersion: '1.2.3' };

      expect(getAppVersionInfo()).toEqual({
        value: '1.2.3',
        source: 'live',
        isFallback: false,
      });
    });

    it('reports fallback metadata when no runtime config is available anywhere', () => {
      expect(getAppVersionInfo()).toEqual({
        value: '0.0.0',
        source: 'default',
        isFallback: true,
      });
    });

    it('returns the persisted source when local storage contains a valid config', () => {
      persistRuntimeConfig({ appVersion: '3.4.5' });

      expect(getAppVersionInfo()).toEqual({
        value: '3.4.5',
        source: 'persisted',
        isFallback: false,
      });
    });

    it('falls back cleanly when persisted runtime config is invalid JSON', () => {
      localStorage.setItem('game-shelf:runtime-config:v1', '{invalid json');

      expect(getAppVersionInfo()).toEqual({
        value: '0.0.0',
        source: 'default',
        isFallback: true,
      });
    });
  });

  describe('hasLiveRuntimeConfig()', () => {
    it('returns true only when live runtime config is present', () => {
      expect(hasLiveRuntimeConfig()).toBe(false);

      window.__GAME_SHELF_RUNTIME_CONFIG__ = { appVersion: '1.2.3' };

      expect(hasLiveRuntimeConfig()).toBe(true);
    });
  });

  describe('isRecommendationsExploreEnabled()', () => {
    it('returns the runtime flag when it is provided', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { recommendationsExploreEnabled: true },
      };

      expect(isRecommendationsExploreEnabled()).toBe(true);
    });
  });

  describe('getFirebaseWebConfig()', () => {
    it('returns environment fallback when runtime config is missing', () => {
      const config = getFirebaseWebConfig();
      expect(config.projectId).toBe('');
    });

    it('prefers runtime firebase fields when present', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        firebase: {
          apiKey: 'runtime-api-key',
          projectId: 'runtime-project',
          messagingSenderId: 'runtime-sender',
          appId: 'runtime-app',
        },
      };

      const config = getFirebaseWebConfig();
      expect(config.apiKey).toBe('runtime-api-key');
      expect(config.projectId).toBe('runtime-project');
      expect(config.messagingSenderId).toBe('runtime-sender');
      expect(config.appId).toBe('runtime-app');
    });
  });

  describe('getFirebaseVapidKey()', () => {
    it('returns environment fallback when runtime value is missing', () => {
      expect(getFirebaseVapidKey()).toBe('');
    });

    it('returns runtime vapid key when present', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        firebaseVapidKey: 'runtime-vapid',
      };

      expect(getFirebaseVapidKey()).toBe('runtime-vapid');
    });
  });

  describe('setLiveRuntimeConfig()', () => {
    it('writes normalized runtime config to window and persisted storage', () => {
      setLiveRuntimeConfig({
        appVersion: ' 1.4.0 ',
        featureFlags: { tasEnabled: 'true' as unknown as boolean },
      });

      expect(window.__GAME_SHELF_RUNTIME_CONFIG__).toEqual({
        appVersion: '1.4.0',
        featureFlags: { tasEnabled: true },
      });
      delete window.__GAME_SHELF_RUNTIME_CONFIG__;
      expect(getAppVersion()).toBe('1.4.0');
      expect(isTasFeatureEnabled()).toBe(true);
    });

    it('returns null for invalid runtime config input', () => {
      expect(setLiveRuntimeConfig(null)).toBeNull();
      expect(window.__GAME_SHELF_RUNTIME_CONFIG__).toBeUndefined();
    });

    it('still normalizes successfully when window is unavailable', () => {
      const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        configurable: true,
      });

      try {
        expect(
          setLiveRuntimeConfig({
            appVersion: ' 2.0.0 ',
          })
        ).toEqual({
          appVersion: '2.0.0',
        });
      } finally {
        if (windowDescriptor) {
          Object.defineProperty(globalThis, 'window', windowDescriptor);
        }
      }
    });
  });

  describe('persistRuntimeConfig()', () => {
    it('returns null for invalid runtime config input', () => {
      expect(persistRuntimeConfig(null)).toBeNull();
      expect(localStorage.getItem('game-shelf:runtime-config:v1')).toBeNull();
    });

    it('ignores storage write failures', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('storage blocked');
      });

      expect(persistRuntimeConfig({ appVersion: '4.5.6' })).toEqual({
        appVersion: '4.5.6',
      });
      expect(setItemSpy).toHaveBeenCalled();
    });
  });
});
