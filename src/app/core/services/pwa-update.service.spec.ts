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
  };

  beforeEach(() => {
    versionUpdates$ = new Subject<VersionEvent>();
    unrecoverable$ = new Subject<{ reason: string }>();
    swUpdateMock = {
      isEnabled: true,
      versionUpdates: versionUpdates$,
      unrecoverable: unrecoverable$,
      checkForUpdate: vi.fn().mockResolvedValue(true),
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

  it('stores and consumes the pending reload version', () => {
    const service = createService();

    service.markPendingReloadVersion('1.27.1');
    expect(service.consumePendingReloadVersion()).toBe('1.27.1');
    expect(service.consumePendingReloadVersion()).toBeNull();

    service.markPendingReloadVersion('   ');
    expect(service.consumePendingReloadVersion()).toBeNull();
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
      service.markPendingReloadVersion('1.27.1');
    }).not.toThrow();
    expect(service.consumePendingReloadVersion()).toBeNull();

    expect(setItemSpy).toHaveBeenCalledOnce();
    expect(getItemSpy).toHaveBeenCalledOnce();
    expect(removeItemSpy).not.toHaveBeenCalled();
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
