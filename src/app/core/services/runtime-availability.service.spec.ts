import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppVersion, getRuntimeConfigSource } from '../config/runtime-config';
import { RuntimeAvailabilityService } from './runtime-availability.service';

describe('RuntimeAvailabilityService', () => {
  let service: RuntimeAvailabilityService;
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    localStorage.clear();
    delete window.__GAME_SHELF_RUNTIME_CONFIG__;
    originalFetch = globalThis.fetch;
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(RuntimeAvailabilityService);
  });

  afterEach(() => {
    localStorage.clear();
    delete window.__GAME_SHELF_RUNTIME_CONFIG__;
    globalThis.fetch = originalFetch as typeof globalThis.fetch;
    vi.restoreAllMocks();
  });

  it('marks the app as offline when the browser is offline', async () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });

    await service.refresh();

    expect(service.status()).toBe('offline');
    expect(service.bannerMessage()).toContain('Offline');
  });

  it('marks the app as tailnet-unreachable when the runtime config probe fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network failed'));

    await service.refresh();

    expect(service.status()).toBe('tailnet-unreachable');
    expect(service.bannerMessage()).toContain('Tailnet unreachable');
  });

  it('stores live runtime config after a successful probe', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi
        .fn()
        .mockResolvedValue(
          `globalThis.__GAME_SHELF_RUNTIME_CONFIG__ = { appVersion: '2.3.4', featureFlags: { tasEnabled: true } };`
        ),
    });

    await service.refresh();

    expect(service.status()).toBe('online');
    expect(getAppVersion()).toBe('2.3.4');
    expect(getRuntimeConfigSource()).toBe('live');
    delete window.__GAME_SHELF_RUNTIME_CONFIG__;
    expect(getRuntimeConfigSource()).toBe('persisted');
    expect(getAppVersion()).toBe('2.3.4');
  });
});
