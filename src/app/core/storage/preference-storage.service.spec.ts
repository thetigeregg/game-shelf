import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { E2E_FIXTURE_STORAGE_KEY, DEBUG_LOGS_STORAGE_KEY } from './preference-keys';
import { PreferenceStorageService } from './preference-storage.service';

const nativePlatformState = vi.hoisted(() => ({ value: false }));
const preferencesGet = vi.hoisted(() => vi.fn());
const preferencesSet = vi.hoisted(() => vi.fn());
const preferencesRemove = vi.hoisted(() => vi.fn());
const preferencesKeys = vi.hoisted(() => vi.fn());

vi.mock('../utils/native-platform.util', () => ({
  isNativePlatform: () => nativePlatformState.value,
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: preferencesGet,
    set: preferencesSet,
    remove: preferencesRemove,
    keys: preferencesKeys,
  },
}));

describe('PreferenceStorageService', () => {
  let service: PreferenceStorageService;

  beforeEach(() => {
    nativePlatformState.value = false;
    localStorage.clear();
    preferencesGet.mockReset();
    preferencesSet.mockReset();
    preferencesRemove.mockReset();
    preferencesKeys.mockReset();
    TestBed.configureTestingModule({});
    service = TestBed.inject(PreferenceStorageService);
  });

  afterEach(() => {
    nativePlatformState.value = false;
    localStorage.clear();
  });

  it('delegates get/set/remove to localStorage on web', async () => {
    await service.initialize();

    service.setItem('game-shelf:test', 'value');
    expect(localStorage.getItem('game-shelf:test')).toBe('value');
    expect(service.getItem('game-shelf:test')).toBe('value');

    service.removeItem('game-shelf:test');
    expect(localStorage.getItem('game-shelf:test')).toBeNull();
  });

  it('returns prefixed entries from localStorage on web', async () => {
    localStorage.setItem('game-shelf:alpha', '1');
    localStorage.setItem('game-shelf:beta', '2');
    localStorage.setItem('other', '3');

    await service.initialize();

    expect(service.entriesWithPrefix('game-shelf')).toEqual([
      ['game-shelf:alpha', '1'],
      ['game-shelf:beta', '2'],
    ]);
  });

  it('migrates localStorage keys to Preferences and hydrates cache on native', async () => {
    nativePlatformState.value = true;
    localStorage.setItem('game-shelf:theme', 'dark');
    localStorage.setItem(E2E_FIXTURE_STORAGE_KEY, '{"resetDb":true}');
    localStorage.setItem('game_shelf_last_seen_app_version', '1.0.0');

    preferencesGet.mockImplementation(({ key }: { key: string }) => {
      if (key === 'game-shelf:preference-storage-migration-v1') {
        return Promise.resolve({ value: null });
      }

      if (key === 'game-shelf:theme') {
        return Promise.resolve({ value: 'dark' });
      }

      if (key === 'game_shelf_last_seen_app_version') {
        return Promise.resolve({ value: '1.0.0' });
      }

      return Promise.resolve({ value: null });
    });
    preferencesSet.mockResolvedValue(undefined);
    preferencesKeys.mockResolvedValue({
      keys: [
        'game-shelf:preference-storage-migration-v1',
        'game-shelf:theme',
        'game_shelf_last_seen_app_version',
      ],
    });

    await service.initialize();

    expect(preferencesSet).toHaveBeenCalledWith({
      key: 'game-shelf:theme',
      value: 'dark',
    });
    expect(preferencesSet).toHaveBeenCalledWith({
      key: 'game_shelf_last_seen_app_version',
      value: '1.0.0',
    });
    expect(preferencesSet).not.toHaveBeenCalledWith({
      key: E2E_FIXTURE_STORAGE_KEY,
      value: '{"resetDb":true}',
    });
    expect(localStorage.getItem('game-shelf:theme')).toBeNull();
    expect(localStorage.getItem(E2E_FIXTURE_STORAGE_KEY)).toBe('{"resetDb":true}');

    expect(service.getItem('game-shelf:theme')).toBe('dark');
    expect(service.getItem('game_shelf_last_seen_app_version')).toBe('1.0.0');
  });

  it('writes through cache and Preferences on native', async () => {
    nativePlatformState.value = true;

    preferencesGet.mockImplementation(({ key }: { key: string }) => {
      if (key === 'game-shelf:preference-storage-migration-v1') {
        return Promise.resolve({ value: '1' });
      }

      return Promise.resolve({ value: null });
    });
    preferencesKeys.mockResolvedValue({
      keys: ['game-shelf:preference-storage-migration-v1'],
    });
    preferencesSet.mockResolvedValue(undefined);

    await service.initialize();
    service.setItem('game-shelf:price-preference-v1', '25');

    expect(service.getItem('game-shelf:price-preference-v1')).toBe('25');
    expect(preferencesSet).toHaveBeenCalledWith({
      key: 'game-shelf:price-preference-v1',
      value: '25',
    });
  });

  it('keeps large debug logs in localStorage on native', async () => {
    nativePlatformState.value = true;
    localStorage.setItem(DEBUG_LOGS_STORAGE_KEY, '[]');

    preferencesGet.mockImplementation(({ key }: { key: string }) => {
      if (key === 'game-shelf:preference-storage-migration-v1') {
        return Promise.resolve({ value: '1' });
      }

      return Promise.resolve({ value: null });
    });
    preferencesKeys.mockResolvedValue({
      keys: ['game-shelf:preference-storage-migration-v1'],
    });
    preferencesSet.mockResolvedValue(undefined);
    preferencesRemove.mockResolvedValue(undefined);

    await service.initialize();

    expect(preferencesSet).not.toHaveBeenCalledWith({
      key: DEBUG_LOGS_STORAGE_KEY,
      value: '[]',
    });
    expect(localStorage.getItem(DEBUG_LOGS_STORAGE_KEY)).toBe('[]');

    service.setItem(DEBUG_LOGS_STORAGE_KEY, '[{"ts":"1","level":"info","message":"test"}]');
    expect(localStorage.getItem(DEBUG_LOGS_STORAGE_KEY)).toBe(
      '[{"ts":"1","level":"info","message":"test"}]'
    );
    expect(preferencesSet).not.toHaveBeenCalledWith({
      key: DEBUG_LOGS_STORAGE_KEY,
      value: '[{"ts":"1","level":"info","message":"test"}]',
    });
    expect(service.getItem(DEBUG_LOGS_STORAGE_KEY)).toBe(
      '[{"ts":"1","level":"info","message":"test"}]'
    );
  });

  it('reclaims excluded keys from Preferences back to localStorage on native', async () => {
    nativePlatformState.value = true;

    preferencesGet.mockImplementation(({ key }: { key: string }) => {
      if (key === 'game-shelf:preference-storage-migration-v1') {
        return Promise.resolve({ value: '1' });
      }

      if (key === DEBUG_LOGS_STORAGE_KEY) {
        return Promise.resolve({ value: '[{"ts":"1","level":"info","message":"legacy"}]' });
      }

      return Promise.resolve({ value: null });
    });
    preferencesKeys.mockResolvedValue({
      keys: ['game-shelf:preference-storage-migration-v1', DEBUG_LOGS_STORAGE_KEY],
    });
    preferencesRemove.mockResolvedValue(undefined);

    await service.initialize();

    expect(localStorage.getItem(DEBUG_LOGS_STORAGE_KEY)).toBe(
      '[{"ts":"1","level":"info","message":"legacy"}]'
    );
    expect(preferencesRemove).toHaveBeenCalledWith({ key: DEBUG_LOGS_STORAGE_KEY });
    expect(service.getItem(DEBUG_LOGS_STORAGE_KEY)).toBe(
      '[{"ts":"1","level":"info","message":"legacy"}]'
    );
  });
});
