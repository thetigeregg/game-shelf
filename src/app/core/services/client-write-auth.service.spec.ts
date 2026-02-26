import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_WRITE_TOKEN_STORAGE_KEY,
  ClientWriteAuthService
} from './client-write-auth.service';

describe('ClientWriteAuthService', () => {
  const service = new ClientWriteAuthService();

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('returns null when token is missing or blank', () => {
    localStorage.setItem(CLIENT_WRITE_TOKEN_STORAGE_KEY, '   ');
    expect(service.getToken()).toBeNull();
    expect(service.hasToken()).toBe(false);
  });

  it('stores and returns a trimmed token', () => {
    service.setToken('  device-token-1  ');

    expect(localStorage.getItem(CLIENT_WRITE_TOKEN_STORAGE_KEY)).toBe('device-token-1');
    expect(service.getToken()).toBe('device-token-1');
    expect(service.hasToken()).toBe(true);
  });

  it('clears token when an empty value is provided', () => {
    service.setToken('device-token-2');
    service.setToken('   ');

    expect(localStorage.getItem(CLIENT_WRITE_TOKEN_STORAGE_KEY)).toBeNull();
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
