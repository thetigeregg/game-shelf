import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAppVersion, isE2eFixturesEnabled, isMgcImportFeatureEnabled } from './runtime-config';

type GameShelfRuntimeConfig = {
  appVersion?: string;
  featureFlags?: {
    showMgcImport?: boolean | string;
    e2eFixtures?: boolean | string;
  };
};

declare global {
  interface Window {
    __GAME_SHELF_RUNTIME_CONFIG__?: GameShelfRuntimeConfig;
  }
}

describe('runtime-config', () => {
  beforeEach(() => {
    delete window.__GAME_SHELF_RUNTIME_CONFIG__;
  });

  afterEach(() => {
    delete window.__GAME_SHELF_RUNTIME_CONFIG__;
  });

  describe('isMgcImportFeatureEnabled', () => {
    it('returns true when runtime config boolean is true', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { showMgcImport: true }
      };
      expect(isMgcImportFeatureEnabled()).toBe(true);
    });

    it('returns false when runtime config boolean is false', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { showMgcImport: false }
      };
      expect(isMgcImportFeatureEnabled()).toBe(false);
    });

    it('parses "true" string as true', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { showMgcImport: 'true' }
      };
      expect(isMgcImportFeatureEnabled()).toBe(true);
    });

    it('parses "1" string as true', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { showMgcImport: '1' }
      };
      expect(isMgcImportFeatureEnabled()).toBe(true);
    });

    it('parses "yes" string as true', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { showMgcImport: 'yes' }
      };
      expect(isMgcImportFeatureEnabled()).toBe(true);
    });

    it('parses "on" string as true', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { showMgcImport: 'on' }
      };
      expect(isMgcImportFeatureEnabled()).toBe(true);
    });

    it('parses "false" string as false', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { showMgcImport: 'false' }
      };
      expect(isMgcImportFeatureEnabled()).toBe(false);
    });

    it('parses "0" string as false', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { showMgcImport: '0' }
      };
      expect(isMgcImportFeatureEnabled()).toBe(false);
    });

    it('parses "no" string as false', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { showMgcImport: 'no' }
      };
      expect(isMgcImportFeatureEnabled()).toBe(false);
    });

    it('parses "off" string as false', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { showMgcImport: 'off' }
      };
      expect(isMgcImportFeatureEnabled()).toBe(false);
    });

    it('falls back to environment default when no config is set', () => {
      const result = isMgcImportFeatureEnabled();
      expect(typeof result).toBe('boolean');
    });

    it('falls back to environment when runtime value is unrecognized string', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { showMgcImport: 'maybe' as unknown as boolean }
      };
      // Unrecognized string → parseBoolean returns null → fall back to env
      const result = isMgcImportFeatureEnabled();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('isE2eFixturesEnabled', () => {
    it('returns true when runtime config boolean is true', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { e2eFixtures: true }
      };
      expect(isE2eFixturesEnabled()).toBe(true);
    });

    it('returns false when runtime config boolean is false', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { e2eFixtures: false }
      };
      expect(isE2eFixturesEnabled()).toBe(false);
    });

    it('falls back to environment default when no config is set', () => {
      expect(typeof isE2eFixturesEnabled()).toBe('boolean');
    });
  });

  describe('getAppVersion', () => {
    it('returns configured version string', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = { appVersion: '1.2.3' };
      expect(getAppVersion()).toBe('1.2.3');
    });

    it('trims whitespace from version string', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = { appVersion: '  2.0.0  ' };
      expect(getAppVersion()).toBe('2.0.0');
    });

    it('falls back to 0.0.0 when version is an empty string', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = { appVersion: '' };
      expect(getAppVersion()).toBe('0.0.0');
    });

    it('falls back to 0.0.0 when version is whitespace-only', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = { appVersion: '   ' };
      expect(getAppVersion()).toBe('0.0.0');
    });

    it('falls back to 0.0.0 when no config is set', () => {
      expect(getAppVersion()).toBe('0.0.0');
    });
  });
});
