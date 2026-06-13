import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isNativePlatformMock = vi.hoisted(() => vi.fn<() => boolean>(() => false));
const getStatusMock = vi.hoisted(() =>
  vi.fn<() => Promise<{ connected: boolean; connectionType: string }>>()
);
const addListenerMock = vi.hoisted(() =>
  vi.fn<
    (
      eventName: string,
      listener: (status: { connected: boolean }) => void
    ) => Promise<{ remove: () => Promise<void> }>
  >()
);

vi.mock('../utils/native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
  getNativePlatform: () => (isNativePlatformMock() ? 'ios' : 'web'),
}));

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: () => getStatusMock(),
    addListener: (eventName: string, listener: (status: { connected: boolean }) => void) =>
      addListenerMock(eventName, listener),
  },
}));

import { NetworkConnectivityService } from './network-connectivity.service';

describe('NetworkConnectivityService', () => {
  let service: NetworkConnectivityService;

  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(false);
    getStatusMock.mockReset();
    addListenerMock.mockReset();
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(NetworkConnectivityService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('seeds web connectivity from navigator.onLine', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });

    service.initialize();

    expect(service.isConnected()).toBe(false);
    expect(getStatusMock).not.toHaveBeenCalled();
  });

  it('defaults to connected when navigator is missing on web', () => {
    const navigatorSpy = vi
      .spyOn(globalThis, 'navigator', 'get')
      .mockReturnValue(undefined as never);

    service.initialize();

    expect(service.isConnected()).toBe(true);

    navigatorSpy.mockRestore();
  });

  it('notifies web listeners on online and offline events', () => {
    const listener = vi.fn();
    service.onConnectedChange(listener);
    service.initialize();

    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, false);
    expect(listener).toHaveBeenNthCalledWith(2, true);
  });

  it('seeds native connectivity from navigator.onLine before getStatus resolves', () => {
    isNativePlatformMock.mockReturnValue(true);
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    getStatusMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({ connected: true, connectionType: 'wifi' });
          }, 100);
        })
    );

    service.initialize();

    expect(service.isConnected()).toBe(false);
  });

  it('notifies listeners when native startup resolves connectivity status', async () => {
    isNativePlatformMock.mockReturnValue(true);
    getStatusMock.mockResolvedValue({ connected: false, connectionType: 'none' });
    addListenerMock.mockResolvedValue({ remove: vi.fn(() => Promise.resolve(undefined)) });

    const listener = vi.fn();
    service.onConnectedChange(listener);
    service.initialize();
    await Promise.resolve();

    expect(getStatusMock).toHaveBeenCalledOnce();
    expect(service.isConnected()).toBe(false);
    expect(listener).toHaveBeenCalledWith(false);
  });

  it('initializes native connectivity from Network.getStatus and networkStatusChange', async () => {
    isNativePlatformMock.mockReturnValue(true);
    getStatusMock.mockResolvedValue({ connected: false, connectionType: 'none' });
    let statusListener: ((status: { connected: boolean }) => void) | undefined;
    addListenerMock.mockImplementation((_eventName, listener) => {
      statusListener = listener;
      return Promise.resolve({ remove: vi.fn(() => Promise.resolve(undefined)) });
    });

    service.initialize();
    await Promise.resolve();

    expect(getStatusMock).toHaveBeenCalledOnce();
    expect(addListenerMock).toHaveBeenCalledWith('networkStatusChange', expect.any(Function));
    expect(service.isConnected()).toBe(false);

    const listener = vi.fn();
    service.onConnectedChange(listener);
    statusListener?.({ connected: true });

    expect(listener).toHaveBeenCalledWith(true);
    expect(service.isConnected()).toBe(true);
  });

  it('falls back to web listeners when native listener registration fails', async () => {
    isNativePlatformMock.mockReturnValue(true);
    getStatusMock.mockResolvedValue({ connected: true, connectionType: 'wifi' });
    addListenerMock.mockRejectedValue(new Error('listener failed'));
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });

    const listener = vi.fn();
    service.onConnectedChange(listener);
    service.initialize();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    window.dispatchEvent(new Event('offline'));

    expect(listener).toHaveBeenCalledWith(false);
    expect(service.isConnected()).toBe(false);
  });

  it('initialize is idempotent', () => {
    const listener = vi.fn();
    service.onConnectedChange(listener);
    service.initialize();
    service.initialize();

    window.dispatchEvent(new Event('offline'));

    expect(listener).toHaveBeenCalledOnce();
  });

  it('unsubscribe stops connected-change callbacks', () => {
    const listener = vi.fn();
    const unsubscribe = service.onConnectedChange(listener);
    service.initialize();

    unsubscribe();
    window.dispatchEvent(new Event('offline'));

    expect(listener).not.toHaveBeenCalled();
  });
});
