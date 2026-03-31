import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaUpdateService } from './pwa-update.service';

describe('PwaUpdateService', () => {
  let versionUpdates$: Subject<VersionEvent>;
  let unrecoverable$: Subject<{ reason: string }>;
  let swUpdateMock: {
    isEnabled: boolean;
    versionUpdates: Subject<VersionEvent>;
    unrecoverable: Subject<{ reason: string }>;
    checkForUpdate: ReturnType<typeof vi.fn>;
    activateUpdate: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    versionUpdates$ = new Subject<VersionEvent>();
    unrecoverable$ = new Subject<{ reason: string }>();
    swUpdateMock = {
      isEnabled: true,
      versionUpdates: versionUpdates$,
      unrecoverable: unrecoverable$,
      checkForUpdate: vi.fn().mockResolvedValue(true),
      activateUpdate: vi.fn().mockResolvedValue(true),
    };

    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [PwaUpdateService, { provide: SwUpdate, useValue: swUpdateMock }],
    });
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  function createService(): PwaUpdateService {
    return TestBed.inject(PwaUpdateService);
  }

  it('subscribes once and checks for updates during initialization', async () => {
    const service = createService();

    service.initialize();
    service.initialize();
    await Promise.resolve();

    expect(swUpdateMock.checkForUpdate).toHaveBeenCalledOnce();

    versionUpdates$.next({
      type: 'VERSION_DETECTED',
      version: { hash: 'detected' },
    });
    expect(service.updateReady()).toBeNull();

    versionUpdates$.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old-hash', appData: undefined },
      latestVersion: { hash: 'new-hash', appData: undefined },
    });
    expect(service.updateReady()?.latestVersion.hash).toBe('new-hash');

    unrecoverable$.next({ reason: 'cache mismatch' });
    expect(service.unrecoverableState()).toEqual({ reason: 'cache mismatch' });
  });

  it('skips initialization and update checks when service workers are disabled', async () => {
    swUpdateMock.isEnabled = false;
    const service = createService();

    service.initialize();
    await service.checkForUpdate();

    expect(swUpdateMock.checkForUpdate).not.toHaveBeenCalled();
    expect(service.updateReady()).toBeNull();
    expect(service.unrecoverableState()).toBeNull();
  });

  it('re-checks for updates on focus-like events and visible tab changes', async () => {
    const service = createService();
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

    service.initialize();
    await Promise.resolve();
    swUpdateMock.checkForUpdate.mockClear();

    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(swUpdateMock.checkForUpdate).toHaveBeenCalledTimes(3);

    if (visibilityDescriptor) {
      Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
    }
  });

  it('cleans up subscriptions and global listeners when the service is destroyed', async () => {
    const service = createService();
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

    service.initialize();
    await Promise.resolve();
    swUpdateMock.checkForUpdate.mockClear();

    TestBed.resetTestingModule();

    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    versionUpdates$.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old-hash', appData: undefined },
      latestVersion: { hash: 'new-hash', appData: undefined },
    });
    unrecoverable$.next({ reason: 'cache mismatch' });
    await Promise.resolve();

    expect(swUpdateMock.checkForUpdate).not.toHaveBeenCalled();
    expect(service.updateReady()).toBeNull();
    expect(service.unrecoverableState()).toBeNull();

    if (visibilityDescriptor) {
      Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
    }
  });

  it('stores and consumes the pending reload marker', () => {
    const service = createService();

    service.markPendingReloadMarker('1.27.1');
    expect(service.peekPendingReloadMarker()).toBe('1.27.1');
    expect(service.peekPendingReloadMarker()).toBe('1.27.1');
    expect(service.consumePendingReloadMarker()).toBe('1.27.1');
    expect(service.consumePendingReloadMarker()).toBeNull();

    service.markPendingReloadMarker('   ');
    expect(service.consumePendingReloadMarker()).toBeNull();
  });

  it('clears the pending reload marker without consuming a return value', () => {
    const service = createService();

    service.markPendingReloadMarker('1.27.1');
    service.clearPendingReloadMarker();

    expect(service.peekPendingReloadMarker()).toBeNull();
    expect(service.consumePendingReloadMarker()).toBeNull();
  });

  it('activates a ready update before reloading', async () => {
    const service = createService();
    const reloadSpy = vi.spyOn(service, 'reload').mockImplementation(() => undefined);

    await expect(service.activateUpdateAndReload('1.27.1')).resolves.toBe(true);

    expect(swUpdateMock.activateUpdate).toHaveBeenCalledOnce();
    expect(reloadSpy).toHaveBeenCalledOnce();
    expect(service.consumePendingReloadMarker()).toBe('1.27.1');
  });

  it('clears the pending reload marker when activation fails', async () => {
    const service = createService();
    const reloadSpy = vi.spyOn(service, 'reload').mockImplementation(() => undefined);
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    swUpdateMock.activateUpdate.mockResolvedValueOnce(false);

    await expect(service.activateUpdateAndReload('1.27.1')).resolves.toBe(false);

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(service.consumePendingReloadMarker()).toBeNull();
    expect(warningSpy).toHaveBeenCalledWith('[pwa-update] activate_update_skipped');
  });

  it('warns and skips reload when activation throws', async () => {
    const service = createService();
    const reloadSpy = vi.spyOn(service, 'reload').mockImplementation(() => undefined);
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    swUpdateMock.activateUpdate.mockRejectedValueOnce(new Error('activate failed'));

    await expect(service.activateUpdateAndReload('1.27.1')).resolves.toBe(false);

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(service.consumePendingReloadMarker()).toBeNull();
    expect(warningSpy).toHaveBeenCalledWith(
      '[pwa-update] activate_update_failed',
      expect.objectContaining({
        message: 'activate failed',
      })
    );
  });

  it('treats sessionStorage failures as a no-op', () => {
    const service = createService();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    expect(() => {
      service.markPendingReloadMarker('1.27.1');
    }).not.toThrow();
    expect(service.consumePendingReloadMarker()).toBeNull();

    expect(setItemSpy).toHaveBeenCalledOnce();
    expect(getItemSpy).toHaveBeenCalledOnce();
    expect(removeItemSpy).not.toHaveBeenCalled();
  });

  it('falls back to a plain reload when service workers are disabled', async () => {
    swUpdateMock.isEnabled = false;
    const service = createService();
    const reloadSpy = vi.spyOn(service, 'reload').mockImplementation(() => undefined);

    await expect(service.activateUpdateAndReload('1.27.1')).resolves.toBe(true);

    expect(swUpdateMock.activateUpdate).not.toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalledOnce();
    expect(service.consumePendingReloadMarker()).toBe('1.27.1');
  });

  it('warns instead of throwing when update checks fail', async () => {
    const service = createService();
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    swUpdateMock.checkForUpdate.mockRejectedValueOnce(new Error('network down'));

    await expect(service.checkForUpdate()).resolves.toBeUndefined();

    expect(warningSpy).toHaveBeenCalledWith(
      '[pwa-update] check_for_update_failed',
      expect.objectContaining({
        message: 'network down',
      })
    );
  });
});
