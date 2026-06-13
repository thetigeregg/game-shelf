import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppVersion, getRuntimeConfigSource } from '../config/runtime-config';
import { NetworkConnectivityService } from './network-connectivity.service';
import { RuntimeAvailabilityService } from './runtime-availability.service';

const isNativePlatformMock = vi.fn<() => boolean>(() => false);
const connectivityListeners = new Set<(connected: boolean) => void>();
const networkConnectivityMock = {
  initialize: vi.fn(),
  isConnected: vi.fn(() => true),
  onConnectedChange: vi.fn((listener: (connected: boolean) => void) => {
    connectivityListeners.add(listener);
    return () => {
      connectivityListeners.delete(listener);
    };
  }),
};

vi.mock('../utils/native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
  getNativePlatform: () => (isNativePlatformMock() ? 'ios' : 'web'),
}));

describe('RuntimeAvailabilityService', () => {
  let service: RuntimeAvailabilityService;
  let originalFetch: typeof globalThis.fetch | undefined;
  let originalVisibilityDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorage.clear();
    connectivityListeners.clear();
    isNativePlatformMock.mockReturnValue(false);
    networkConnectivityMock.isConnected.mockReset();
    networkConnectivityMock.onConnectedChange.mockReset();
    networkConnectivityMock.isConnected.mockReturnValue(true);
    networkConnectivityMock.onConnectedChange.mockImplementation(
      (listener: (connected: boolean) => void) => {
        connectivityListeners.add(listener);
        return () => {
          connectivityListeners.delete(listener);
        };
      }
    );
    delete window.__GAME_SHELF_RUNTIME_CONFIG__;
    originalFetch = globalThis.fetch;
    originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: NetworkConnectivityService, useValue: networkConnectivityMock }],
    });
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

  it('marks the app as offline when device connectivity is unavailable', async () => {
    networkConnectivityMock.isConnected.mockReturnValue(false);

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

  it('probes the API health endpoint instead of runtime config on native platforms', async () => {
    isNativePlatformMock.mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock;

    await service.refresh();

    expect(service.status()).toBe('online');
    const probedUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(probedUrl).toContain('/v1/health');
    expect(probedUrl).not.toContain('runtime-config.js');
  });

  it('marks native API health probe failures as service-unreachable', async () => {
    isNativePlatformMock.mockReturnValue(true);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

    await service.refresh();

    expect(service.status()).toBe('service-unreachable');
  });

  it('marks native API health probe network failures as service-unreachable', async () => {
    isNativePlatformMock.mockReturnValue(true);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network failed'));

    await service.refresh();

    expect(service.status()).toBe('service-unreachable');
  });

  it('marks the app offline when connectivity reports disconnected', () => {
    service.initialize();
    service.status.set('online');

    connectivityListeners.forEach((listener) => {
      listener(false);
    });

    expect(service.status()).toBe('offline');
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

  it('initializes once, sets online from existing live config, and refreshes on resume events', () => {
    vi.useFakeTimers();
    window.__GAME_SHELF_RUNTIME_CONFIG__ = { appVersion: '1.0.0' };
    const refreshSpy = vi.spyOn(service, 'refresh').mockResolvedValue(undefined);

    service.initialize();
    service.initialize();

    expect(service.status()).toBe('online');
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    connectivityListeners.forEach((listener) => {
      listener(true);
    });
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(refreshSpy).toHaveBeenCalledTimes(5);

    vi.advanceTimersByTime(30_000);
    expect(refreshSpy).toHaveBeenCalledTimes(6);
  });

  it('initializes offline and skips timer refreshes while the document is hidden', () => {
    vi.useFakeTimers();
    networkConnectivityMock.isConnected.mockReturnValue(false);
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
