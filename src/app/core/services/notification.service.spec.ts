import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { NotificationService } from './notification.service';
import { SYNC_OUTBOX_WRITER } from '../data/sync-outbox-writer';

const checkPermissionsMock = vi.fn<() => Promise<{ receive: string }>>();
const requestPermissionsMock = vi.fn<() => Promise<{ receive: string }>>();
const getTokenMock = vi.fn<() => Promise<{ token: string }>>();
const deleteTokenMock = vi.fn<() => Promise<void>>();
const addListenerMock =
  vi.fn<
    (eventName: string, listener: (event: unknown) => void) => Promise<{ remove: () => void }>
  >();

vi.mock('./firebase-messaging.client', () => ({
  FirebaseMessaging: {
    checkPermissions: () => checkPermissionsMock(),
    requestPermissions: () => requestPermissionsMock(),
    getToken: () => getTokenMock(),
    deleteToken: () => deleteTokenMock(),
    addListener: (eventName: string, listener: (event: unknown) => void) =>
      addListenerMock(eventName, listener),
  },
}));

const isNativePlatformMock = vi.fn<() => boolean>();
const getNativePlatformMock = vi.fn<() => string>();

vi.mock('../utils/native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
  getNativePlatform: () => getNativePlatformMock(),
}));

describe('NotificationService', () => {
  let service: NotificationService;
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };
  let httpClient: HttpClient;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        NotificationService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: Router,
          useValue: {
            navigateByUrl: vi.fn().mockResolvedValue(true),
          },
        },
        { provide: SYNC_OUTBOX_WRITER, useValue: null },
      ],
    });

    service = TestBed.inject(NotificationService);
    router = TestBed.inject(Router) as unknown as { navigateByUrl: ReturnType<typeof vi.fn> };
    httpClient = TestBed.inject(HttpClient);

    isNativePlatformMock.mockReturnValue(true);
    getNativePlatformMock.mockReturnValue('ios');
    checkPermissionsMock.mockResolvedValue({ receive: 'granted' });
    requestPermissionsMock.mockResolvedValue({ receive: 'granted' });
    getTokenMock.mockResolvedValue({ token: 'fcm-token-1234567890' });
    deleteTokenMock.mockResolvedValue(undefined);
    addListenerMock.mockResolvedValue({ remove: () => undefined });
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    checkPermissionsMock.mockReset();
    requestPermissionsMock.mockReset();
    getTokenMock.mockReset();
    deleteTokenMock.mockReset();
    addListenerMock.mockReset();
    isNativePlatformMock.mockReset();
    getNativePlatformMock.mockReset();
  });

  it('reports push as unsupported outside the native shell', async () => {
    isNativePlatformMock.mockReturnValue(false);

    expect(service.isPushSupported()).toBe(false);

    const result = await service.requestPermissionAndRegister();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not supported on this device');

    expect(await service.shouldPromptForReleaseNotifications()).toBe(false);

    await service.initialize();
    expect(addListenerMock).not.toHaveBeenCalled();
  });

  it('returns denied when native permission is not granted', async () => {
    requestPermissionsMock.mockResolvedValue({ receive: 'denied' });

    const result = await service.requestPermissionAndRegister();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not granted');
  });

  it('treats permission request failures as denied', async () => {
    requestPermissionsMock.mockRejectedValue(new Error('plugin unavailable'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await service.requestPermissionAndRegister();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not granted');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('fails registration when the plugin returns no token', async () => {
    getTokenMock.mockResolvedValue({ token: '' });

    const result = await service.requestPermissionAndRegister();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Firebase iOS configuration');
  });

  it('fails registration when backend token save fails', async () => {
    vi.spyOn(httpClient, 'post').mockReturnValue(throwError(() => new Error('backend down')));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await service.requestPermissionAndRegister();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('server');
    expect(localStorage.getItem('game-shelf:notifications:fcm-token')).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('stores token when backend registration succeeds', async () => {
    const postSpy = vi.spyOn(httpClient, 'post').mockReturnValue(of({ ok: true }));

    const result = await service.requestPermissionAndRegister();
    expect(result.ok).toBe(true);
    expect(localStorage.getItem('game-shelf:notifications:fcm-token')).toBe('fcm-token-1234567890');
    expect(postSpy).toHaveBeenCalledWith(
      expect.stringContaining('/v1/notifications/fcm/register'),
      expect.objectContaining({ token: 'fcm-token-1234567890', platform: 'ios' })
    );
  });

  it('stores and reads release notification enabled preference values', () => {
    expect(service.isReleaseNotificationsEnabled()).toBe(false);
    service.setReleaseNotificationsEnabled(true);
    expect(service.isReleaseNotificationsEnabled()).toBe(true);
    service.setReleaseNotificationsEnabled(false);
    expect(service.isReleaseNotificationsEnabled()).toBe(false);
    expect(service.hasStoredReleaseNotificationsPreference()).toBe(true);
  });

  it('returns event defaults for missing or malformed release event preferences', () => {
    expect(service.readReleaseEventPreferences()).toEqual({
      set: true,
      changed: true,
      removed: true,
      day: true,
      sale: true,
    });

    localStorage.setItem(
      'game-shelf:notifications:release:events',
      JSON.stringify({ set: false, changed: true, removed: false, day: true, sale: false })
    );
    expect(service.readReleaseEventPreferences()).toEqual({
      set: false,
      changed: true,
      removed: false,
      day: true,
      sale: false,
    });

    localStorage.setItem('game-shelf:notifications:release:events', '{bad-json');
    expect(service.readReleaseEventPreferences()).toEqual({
      set: true,
      changed: true,
      removed: true,
      day: true,
      sale: true,
    });
  });

  it('coerces string and numeric falsey release event preferences to disabled', () => {
    localStorage.setItem(
      'game-shelf:notifications:release:events',
      JSON.stringify({
        set: 'false',
        changed: '0',
        removed: 'no',
        day: 0,
        sale: 'false',
      })
    );

    expect(service.readReleaseEventPreferences()).toEqual({
      set: false,
      changed: false,
      removed: false,
      day: false,
      sale: false,
    });
  });

  it('persists disabled state when enable flow fails', async () => {
    vi.spyOn(service, 'requestPermissionAndRegister').mockResolvedValue({
      ok: false,
      message: 'failed',
    });
    const result = await service.enableReleaseNotifications();
    expect(result.ok).toBe(false);
    expect(localStorage.getItem('game-shelf:notifications:release:enabled')).toBe('false');
  });

  it('persists enabled state only after successful enable flow returns', async () => {
    localStorage.setItem('game-shelf:notifications:release:enabled', 'false');

    const requestSpy = vi.spyOn(service, 'requestPermissionAndRegister').mockImplementation(() => {
      expect(localStorage.getItem('game-shelf:notifications:release:enabled')).toBe('false');
      return Promise.resolve({ ok: true, message: 'ok' });
    });

    const result = await service.enableReleaseNotifications();
    expect(result.ok).toBe(true);
    expect(requestSpy).toHaveBeenCalledOnce();
    expect(localStorage.getItem('game-shelf:notifications:release:enabled')).toBe('true');
  });

  it('returns success when disable flow unregisters cleanly', async () => {
    vi.spyOn(service, 'unregisterCurrentDevice').mockResolvedValue({
      ok: true,
      message: 'Notifications disabled on this device.',
    });
    const result = await service.disableReleaseNotifications();
    expect(result.ok).toBe(true);
    expect(localStorage.getItem('game-shelf:notifications:release:enabled')).toBe('false');
  });

  it('does not persist disabled state when disable flow fails', async () => {
    localStorage.setItem('game-shelf:notifications:release:enabled', 'true');
    vi.spyOn(service, 'unregisterCurrentDevice').mockResolvedValue({
      ok: false,
      message: 'failed',
    });

    const result = await service.disableReleaseNotifications();
    expect(result.ok).toBe(false);
    expect(localStorage.getItem('game-shelf:notifications:release:enabled')).toBe('true');
  });

  it('registerCurrentDeviceIfPermitted short-circuits when notifications are disabled', async () => {
    localStorage.setItem('game-shelf:notifications:release:enabled', 'false');

    const result = await service.registerCurrentDeviceIfPermitted();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('disabled');
  });

  it('registerCurrentDeviceIfPermitted registers when enabled and permission granted', async () => {
    localStorage.setItem('game-shelf:notifications:release:enabled', 'true');
    const registerSpy = vi
      .spyOn(
        service as unknown as {
          registerCurrentDevice: () => Promise<{ ok: boolean; token?: string; message?: string }>;
        },
        'registerCurrentDevice'
      )
      .mockResolvedValue({ ok: true, token: 'abc' });

    const result = await service.registerCurrentDeviceIfPermitted();
    expect(result.ok).toBe(true);
    expect(registerSpy).toHaveBeenCalledOnce();
  });

  it('registerCurrentDeviceIfPermitted returns failure when permission is not granted', async () => {
    localStorage.setItem('game-shelf:notifications:release:enabled', 'true');
    checkPermissionsMock.mockResolvedValue({ receive: 'prompt' });

    const result = await service.registerCurrentDeviceIfPermitted();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not been granted');
  });

  it('registerCurrentDeviceIfPermitted reports unsupported outside the native shell', async () => {
    localStorage.setItem('game-shelf:notifications:release:enabled', 'true');
    isNativePlatformMock.mockReturnValue(false);

    const result = await service.registerCurrentDeviceIfPermitted();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not supported on this device');
  });

  it('resolves device platform from the Capacitor platform identifier', () => {
    const resolvePlatform = (
      service as unknown as { resolveDevicePlatform: () => 'web' | 'android' | 'ios' }
    ).resolveDevicePlatform.bind(service);

    getNativePlatformMock.mockReturnValue('ios');
    expect(resolvePlatform()).toBe('ios');

    getNativePlatformMock.mockReturnValue('android');
    expect(resolvePlatform()).toBe('android');

    getNativePlatformMock.mockReturnValue('web');
    expect(resolvePlatform()).toBe('web');
  });

  it('initializes once and attaches native listeners a single time', async () => {
    const registerSpy = vi
      .spyOn(
        service as unknown as {
          registerCurrentDevice: () => Promise<{ ok: boolean; token?: string }>;
        },
        'registerCurrentDevice'
      )
      .mockResolvedValue({ ok: true, token: 'abc' });

    await service.initialize();
    await service.initialize();

    const listenedEvents = addListenerMock.mock.calls.map(([eventName]) => eventName);
    expect(listenedEvents).toEqual(['notificationReceived', 'notificationActionPerformed']);
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('registers device during initialize when enabled and permission already granted', async () => {
    localStorage.setItem('game-shelf:notifications:release:enabled', 'true');
    const registerSpy = vi
      .spyOn(
        service as unknown as {
          registerCurrentDevice: () => Promise<{ ok: boolean; token?: string }>;
        },
        'registerCurrentDevice'
      )
      .mockResolvedValue({ ok: true, token: 'abc' });

    await service.initialize();

    expect(registerSpy).toHaveBeenCalledOnce();
  });

  it('coalesces concurrent initialize calls to a single in-flight setup', async () => {
    let resolveInit: (() => void) | null = null;
    const initializeInternalSpy = vi
      .spyOn(
        service as unknown as { initializeInternal: () => Promise<void> },
        'initializeInternal'
      )
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveInit = resolve;
          })
      );

    const first = service.initialize();
    const second = service.initialize();
    resolveInit?.();
    await Promise.all([first, second]);

    expect(initializeInternalSpy).toHaveBeenCalledOnce();
  });

  it('can retry initialize after a failed setup', async () => {
    const initializeInternalSpy = vi
      .spyOn(
        service as unknown as { initializeInternal: () => Promise<void> },
        'initializeInternal'
      )
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce();

    await expect(service.initialize()).rejects.toThrow('boom');
    await expect(service.initialize()).resolves.toBeUndefined();
    expect(initializeInternalSpy).toHaveBeenCalledTimes(2);
  });

  it('prompts for release notifications only when no preference is stored', async () => {
    checkPermissionsMock.mockResolvedValue({ receive: 'prompt' });
    expect(await service.shouldPromptForReleaseNotifications()).toBe(true);

    localStorage.setItem('game-shelf:notifications:release:enabled', 'true');
    expect(await service.shouldPromptForReleaseNotifications()).toBe(false);
  });

  it('does not prompt when native permission was already denied', async () => {
    checkPermissionsMock.mockResolvedValue({ receive: 'denied' });
    expect(await service.shouldPromptForReleaseNotifications()).toBe(false);
  });

  it('returns warning outcome when backend unregister fails', async () => {
    localStorage.setItem('game-shelf:notifications:fcm-token', 'token-1');
    vi.spyOn(httpClient, 'post').mockReturnValue(throwError(() => new Error('backend down')));

    const result = await service.unregisterCurrentDevice();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('did not fully complete');
    expect(localStorage.getItem('game-shelf:notifications:fcm-token')).toBeNull();
  });

  it('returns warning outcome when firebase deleteToken fails', async () => {
    localStorage.setItem('game-shelf:notifications:fcm-token', 'token-2');
    vi.spyOn(httpClient, 'post').mockReturnValue(of({ ok: true }));
    deleteTokenMock.mockRejectedValueOnce(new Error('fcm delete failed'));

    const result = await service.unregisterCurrentDevice();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('did not fully complete');
  });

  it('unregisters cleanly when backend and plugin both succeed', async () => {
    localStorage.setItem('game-shelf:notifications:fcm-token', 'token-3');
    vi.spyOn(httpClient, 'post').mockReturnValue(of({ ok: true }));

    const result = await service.unregisterCurrentDevice();
    expect(result.ok).toBe(true);
    expect(deleteTokenMock).toHaveBeenCalledOnce();
    expect(localStorage.getItem('game-shelf:notifications:fcm-token')).toBeNull();
  });

  it('navigates with the router when a notification tap carries a route', async () => {
    await service.initialize();

    const actionListener = addListenerMock.mock.calls.find(
      ([eventName]) => eventName === 'notificationActionPerformed'
    )?.[1];
    expect(actionListener).toBeDefined();

    actionListener?.({
      actionId: 'tap',
      notification: { data: { route: '/tabs/wishlist' } },
    });
    await Promise.resolve();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs/wishlist');
  });

  it('ignores notification taps without a usable route', async () => {
    await service.initialize();

    const actionListener = addListenerMock.mock.calls.find(
      ([eventName]) => eventName === 'notificationActionPerformed'
    )?.[1];

    actionListener?.({ actionId: 'tap', notification: { data: { route: 'not-a-path' } } });
    actionListener?.({ actionId: 'tap', notification: { data: {} } });
    actionListener?.({ actionId: 'tap', notification: {} });
    await Promise.resolve();

    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('handles localStorage read failures in stored-token lookup', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    try {
      const readStoredToken = (
        service as unknown as { readStoredToken: () => string | null }
      ).readStoredToken.bind(service);

      expect(readStoredToken()).toBeNull();
      expect(getItemSpy).toHaveBeenCalled();
    } finally {
      getItemSpy.mockRestore();
    }
  });

  it('enqueues settings upserts when outbox writer is configured', () => {
    const enqueueOperation = vi.fn();
    const serviceWithOutbox = createService({ enqueueOperation });

    serviceWithOutbox.setReleaseNotificationsEnabled(true);

    expect(enqueueOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'setting',
        operation: 'upsert',
        payload: {
          key: 'game-shelf:notifications:release:enabled',
          value: 'true',
        },
      })
    );
  });
});

function createService(outboxWriter: {
  enqueueOperation: (operation: unknown) => Promise<void> | void;
}): NotificationService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      NotificationService,
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: Router,
        useValue: {
          navigateByUrl: vi.fn().mockResolvedValue(true),
        },
      },
      { provide: SYNC_OUTBOX_WRITER, useValue: outboxWriter },
    ],
  });

  return TestBed.inject(NotificationService);
}
