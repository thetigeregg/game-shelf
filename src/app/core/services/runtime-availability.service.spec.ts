import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAppVersion,
  getFirebaseWebConfig,
  getRuntimeConfigSource,
} from '../config/runtime-config';
import { RuntimeAvailabilityService } from './runtime-availability.service';

describe('RuntimeAvailabilityService', () => {
  let service: RuntimeAvailabilityService;
  let originalFetch: typeof globalThis.fetch | undefined;
  let originalVisibilityDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorage.clear();
    delete window.__GAME_SHELF_RUNTIME_CONFIG__;
    originalFetch = globalThis.fetch;
    originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
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
    if (originalVisibilityDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityDescriptor);
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
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

  it('marks the app as service-unreachable when the runtime config probe fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network failed'));

    await service.refresh();

    expect(service.status()).toBe('service-unreachable');
    expect(service.bannerMessage()).toContain('Connection unavailable');
  });

  it('returns no banner for non-error availability states', () => {
    expect(service.bannerMessage()).toBeNull();

    service.status.set('online');
    expect(service.bannerMessage()).toBeNull();
  });

  it('treats non-ok probe responses as service-unreachable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: vi.fn(),
    });

    await service.refresh();

    expect(service.status()).toBe('service-unreachable');
  });

  it('leaves runtime config untouched when the probe response is blank', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('   '),
    });

    await service.refresh();

    expect(service.status()).toBe('online');
    expect(getRuntimeConfigSource()).toBe('default');
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

  it('parses quoted firebase keys from the generated runtime config asset', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(`globalThis.__GAME_SHELF_RUNTIME_CONFIG__ = Object.assign(
  {},
  globalThis.__GAME_SHELF_RUNTIME_CONFIG__,
  {
    appVersion: "2.3.4",
    firebase: {
      "apiKey": "runtime-api-key",
      "projectId": "runtime-project",
      "messagingSenderId": "runtime-sender",
      "appId": "runtime-app"
    },
    featureFlags: {
      tasEnabled: true,
    },
  },
);`),
    });

    await service.refresh();

    expect(getFirebaseWebConfig()).toEqual(
      expect.objectContaining({
        apiKey: 'runtime-api-key',
        projectId: 'runtime-project',
        messagingSenderId: 'runtime-sender',
        appId: 'runtime-app',
      })
    );
  });

  it('falls back to the raw matched string when JSON string parsing fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi
        .fn()
        .mockResolvedValue(
          `globalThis.__GAME_SHELF_RUNTIME_CONFIG__ = { appVersion: "bad\\qvalue" };`
        ),
    });

    await service.refresh();

    expect(getAppVersion()).toBe('bad\\qvalue');
  });

  it('does not persist config when the probe script has no recognized keys', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(`console.info('noop');`),
    });

    await service.refresh();

    expect(service.status()).toBe('online');
    expect(getRuntimeConfigSource()).toBe('default');
  });

  it('initializes once, sets online from existing live config, and refreshes on browser events', () => {
    vi.useFakeTimers();
    window.__GAME_SHELF_RUNTIME_CONFIG__ = { appVersion: '1.0.0' };
    const refreshSpy = vi.spyOn(service, 'refresh').mockResolvedValue(undefined);

    service.initialize();
    service.initialize();

    expect(service.status()).toBe('online');
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(refreshSpy).toHaveBeenCalledTimes(5);

    vi.advanceTimersByTime(30_000);
    expect(refreshSpy).toHaveBeenCalledTimes(6);
  });

  it('initializes offline and skips timer refreshes while the document is hidden', () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    const refreshSpy = vi.spyOn(service, 'refresh').mockResolvedValue(undefined);

    service.initialize();

    expect(service.status()).toBe('offline');
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(30_000);

    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('returns early when refresh is invoked without a window object', async () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

    Object.defineProperty(globalThis, 'window', {
      value: undefined,
      configurable: true,
    });

    try {
      await service.refresh();

      expect(service.status()).toBe('checking');
    } finally {
      if (windowDescriptor) {
        Object.defineProperty(globalThis, 'window', windowDescriptor);
      }
    }
  });
});
