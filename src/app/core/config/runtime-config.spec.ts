import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAppVersion, isE2eFixturesEnabled, isMgcImportFeatureEnabled } from './runtime-config';

describe('runtime-config', () => {
  beforeEach(() => {
    delete window.__GAME_SHELF_RUNTIME_CONFIG__;
  });

  afterEach(() => {
    delete window.__GAME_SHELF_RUNTIME_CONFIG__;
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
          featureFlags: { showMgcImport: val as unknown as boolean }
        };
        expect(isMgcImportFeatureEnabled()).toBe(true);
      }
    });

    it('parses falsy string values: "false", "0", "no", "off"', () => {
      for (const val of ['false', '0', 'no', 'off', ' FALSE ']) {
        window.__GAME_SHELF_RUNTIME_CONFIG__ = {
          featureFlags: { showMgcImport: val as unknown as boolean }
        };
        expect(isMgcImportFeatureEnabled()).toBe(false);
      }
    });

    it('falls back to environment default for unrecognized string values', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { showMgcImport: 'maybe' as unknown as boolean }
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
          featureFlags: { e2eFixtures: val as unknown as boolean }
        };
        expect(isE2eFixturesEnabled()).toBe(true);
      }
    });

    it('falls back to environment default for non-boolean, non-string values', () => {
      window.__GAME_SHELF_RUNTIME_CONFIG__ = {
        featureFlags: { e2eFixtures: 42 as unknown as boolean }
      };
      expect(isE2eFixturesEnabled()).toBe(false);
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
  });
});
