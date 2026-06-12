import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PreferenceStorageService,
  resetPreferenceStorageForTesting,
} from '../storage/preference-storage.service';
import {
  CLIENT_WRITE_TOKEN_STORAGE_KEY,
  ClientWriteAuthService,
} from './client-write-auth.service';

describe('ClientWriteAuthService', () => {
  let service: ClientWriteAuthService;
  let preferenceStorage: PreferenceStorageService;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [ClientWriteAuthService, PreferenceStorageService],
    });
    preferenceStorage = TestBed.inject(PreferenceStorageService);
    await preferenceStorage.initialize();
    service = TestBed.inject(ClientWriteAuthService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    resetPreferenceStorageForTesting();
  });

  it('returns null when token is missing or blank', () => {
    preferenceStorage.setItem(CLIENT_WRITE_TOKEN_STORAGE_KEY, '   ');
    expect(service.getToken()).toBeNull();
    expect(service.hasToken()).toBe(false);
  });

  it('stores and returns a trimmed token', () => {
    service.setToken('  device-token-1  ');

    expect(preferenceStorage.getItem(CLIENT_WRITE_TOKEN_STORAGE_KEY)).toBe('device-token-1');
    expect(service.getToken()).toBe('device-token-1');
    expect(service.hasToken()).toBe(true);
  });

  it('clears token when an empty value is provided', () => {
    service.setToken('device-token-2');
    service.setToken('   ');

    expect(preferenceStorage.getItem(CLIENT_WRITE_TOKEN_STORAGE_KEY)).toBeNull();
    expect(service.getToken()).toBeNull();
  });

  it('swallows localStorage read/write/remove failures', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('write failed');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('read failed');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('remove failed');
    });

    expect(() => {
      service.setToken('device-token-3');
    }).not.toThrow();
    expect(service.getToken()).toBeNull();
    expect(service.hasToken()).toBe(false);
    expect(() => {
      service.clearToken();
    }).not.toThrow();
  });
});
