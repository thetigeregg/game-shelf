import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { NotificationService } from './notification.service';
import { SYNC_OUTBOX_WRITER } from '../data/sync-outbox-writer';
import {
  PreferenceStorageService,
  resetPreferenceStorageForTesting,
} from '../storage/preference-storage.service';

const preferencesGet = vi.hoisted(() => vi.fn());
const preferencesSet = vi.hoisted(() => vi.fn());
const preferencesRemove = vi.hoisted(() => vi.fn());
const preferencesKeys = vi.hoisted(() => vi.fn());

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

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: preferencesGet,
    set: preferencesSet,
    remove: preferencesRemove,
    keys: preferencesKeys,
  },
}));

describe('NotificationService', () => {
  let service: NotificationService;
  let preferenceStorage: PreferenceStorageService;
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };
  let httpClient: HttpClient;

  beforeEach(async () => {
    localStorage.clear();
    isNativePlatformMock.mockReturnValue(true);
    getNativePlatformMock.mockReturnValue('ios');
    preferencesGet.mockImplementation(({ key }: { key: string }) => {
      if (key === 'game-shelf:preference-storage-migration-v1') {
        return Promise.resolve({ value: '1' });
      }

      return Promise.resolve({ value: null });
    });
    preferencesSet.mockResolvedValue(undefined);
    preferencesRemove.mockResolvedValue(undefined);
    preferencesKeys.mockResolvedValue({ keys: ['game-shelf:preference-storage-migration-v1'] });

    TestBed.configureTestingModule({
      providers: [
        NotificationService,
        PreferenceStorageService,
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

    preferenceStorage = TestBed.inject(PreferenceStorageService);
    await preferenceStorage.initialize();
    service = TestBed.inject(NotificationService);
    router = TestBed.inject(Router) as unknown as { navigateByUrl: ReturnType<typeof vi.fn> };
    httpClient = TestBed.inject(HttpClient);

    checkPermissionsMock.mockResolvedValue({ receive: 'granted' });
    requestPermissionsMock.mockResolvedValue({ receive: 'granted' });
    getTokenMock.mockResolvedValue({ token: 'fcm-token-1234567890' });
    deleteTokenMock.mockResolvedValue(undefined);
    addListenerMock.mockResolvedValue({ remove: () => undefined });
  });

  afterEach(() => {
    localStorage.clear();
    resetPreferenceStorageForTesting();
    vi.restoreAllMocks();
    preferencesGet.mockReset();
    preferencesSet.mockReset();
    preferencesRemove.mockReset();
    preferencesKeys.mockReset();
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
    expect(preferenceStorage.getItem('game-shelf:notifications:fcm-token')).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('stores token when backend registration succeeds', async () => {
    const postSpy = vi.spyOn(httpClient, 'post').mockReturnValue(of({ ok: true }));

    const result = await service.requestPermissionAndRegister();
    expect(result.ok).toBe(true);
    expect(preferenceStorage.getItem('game-shelf:notifications:fcm-token')).toBe(
      'fcm-token-1234567890'
    );
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

    preferenceStorage.setItem(
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

    preferenceStorage.setItem('game-shelf:notifications:release:events', '{bad-json');
    expect(service.readReleaseEventPreferences()).toEqual({
      set: true,
      changed: true,
      removed: true,
      day: true,
      sale: true,
    });
  });

  it('coerces string and numeric falsey release event preferences to disabled', () => {
    preferenceStorage.setItem(
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
    expect(preferenceStorage.getItem('game-shelf:notifications:release:enabled')).toBe('false');
  });

  it('persists enabled state only after successful enable flow returns', async () => {
    preferenceStorage.setItem('game-shelf:notifications:release:enabled', 'false');

    const requestSpy = vi.spyOn(service, 'requestPermissionAndRegister').mockImplementation(() => {
      expect(preferenceStorage.getItem('game-shelf:notifications:release:enabled')).toBe('false');
      return Promise.resolve({ ok: true, message: 'ok' });
    });

    const result = await service.enableReleaseNotifications();
    expect(result.ok).toBe(true);
    expect(requestSpy).toHaveBeenCalledOnce();
    expect(preferenceStorage.getItem('game-shelf:notifications:release:enabled')).toBe('true');
  });

  it('returns success when disable flow unregisters cleanly', async () => {
    vi.spyOn(service, 'unregisterCurrentDevice').mockResolvedValue({
      ok: true,
      message: 'Notifications disabled on this device.',
    });
    const result = await service.disableReleaseNotifications();
    expect(result.ok).toBe(true);
    expect(preferenceStorage.getItem('game-shelf:notifications:release:enabled')).toBe('false');
  });

  it('does not persist disabled state when disable flow fails', async () => {
    preferenceStorage.setItem('game-shelf:notifications:release:enabled', 'true');
    vi.spyOn(service, 'unregisterCurrentDevice').mockResolvedValue({
      ok: false,
      message: 'failed',
    });

    const result = await service.disableReleaseNotifications();
    expect(result.ok).toBe(false);
    expect(preferenceStorage.getItem('game-shelf:notifications:release:enabled')).toBe('true');
  });

  it('registerCurrentDeviceIfPermitted short-circuits when notifications are disabled', async () => {
    preferenceStorage.setItem('game-shelf:notifications:release:enabled', 'false');

    const result = await service.registerCurrentDeviceIfPermitted();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('disabled');
  });

  it('registerCurrentDeviceIfPermitted registers when enabled and permission granted', async () => {
    preferenceStorage.setItem('game-shelf:notifications:release:enabled', 'true');
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
    preferenceStorage.setItem('game-shelf:notifications:release:enabled', 'true');
    checkPermissionsMock.mockResolvedValue({ receive: 'prompt' });

    const result = await service.registerCurrentDeviceIfPermitted();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not been granted');
  });

  it('registerCurrentDeviceIfPermitted reports unsupported outside the native shell', async () => {
    isNativePlatformMock.mockReturnValue(false);
    preferenceStorage.setItem('game-shelf:notifications:release:enabled', 'true');

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
    preferenceStorage.setItem('game-shelf:notifications:release:enabled', 'true');
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

    preferenceStorage.setItem('game-shelf:notifications:release:enabled', 'true');
    expect(await service.shouldPromptForReleaseNotifications()).toBe(false);
  });

  it('does not prompt when native permission was already denied', async () => {
    checkPermissionsMock.mockResolvedValue({ receive: 'denied' });
    expect(await service.shouldPromptForReleaseNotifications()).toBe(false);
  });

  it('returns warning outcome when backend unregister fails', async () => {
    preferenceStorage.setItem('game-shelf:notifications:fcm-token', 'token-1');
    vi.spyOn(httpClient, 'post').mockReturnValue(throwError(() => new Error('backend down')));

    const result = await service.unregisterCurrentDevice();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('did not fully complete');
    expect(preferenceStorage.getItem('game-shelf:notifications:fcm-token')).toBeNull();
  });

  it('returns warning outcome when firebase deleteToken fails', async () => {
    preferenceStorage.setItem('game-shelf:notifications:fcm-token', 'token-2');
    vi.spyOn(httpClient, 'post').mockReturnValue(of({ ok: true }));
    deleteTokenMock.mockRejectedValueOnce(new Error('fcm delete failed'));

    const result = await service.unregisterCurrentDevice();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('did not fully complete');
  });

  it('unregisters cleanly when backend and plugin both succeed', async () => {
    preferenceStorage.setItem('game-shelf:notifications:fcm-token', 'token-3');
    vi.spyOn(httpClient, 'post').mockReturnValue(of({ ok: true }));

    const result = await service.unregisterCurrentDevice();
    expect(result.ok).toBe(true);
    expect(deleteTokenMock).toHaveBeenCalledOnce();
    expect(preferenceStorage.getItem('game-shelf:notifications:fcm-token')).toBeNull();
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

  it('handles preference read failures in stored-token lookup', () => {
    const getItemSpy = vi.spyOn(preferenceStorage, 'getItem').mockImplementation(() => {
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

  it('treats preference read failures as disabled release notifications', () => {
    const getItemSpy = vi.spyOn(preferenceStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });

    expect(service.isReleaseNotificationsEnabled()).toBe(false);
    expect(service.hasStoredReleaseNotificationsPreference()).toBe(false);
    expect(getItemSpy).toHaveBeenCalled();
  });

  it('registerCurrentDeviceIfPermitted reports registration failures', async () => {
    preferenceStorage.setItem('game-shelf:notifications:release:enabled', 'true');
    vi.spyOn(
      service as unknown as {
        registerCurrentDevice: () => Promise<{ ok: boolean; message?: string }>;
      },
      'registerCurrentDevice'
    ).mockResolvedValue({ ok: false, message: 'Unable to save this device token on the server.' });

    const result = await service.registerCurrentDeviceIfPermitted();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('server');
  });

  it('treats permission check failures as denied', async () => {
    checkPermissionsMock.mockRejectedValue(new Error('plugin unavailable'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await service.shouldPromptForReleaseNotifications()).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('logs foreground notification diagnostics from the native listener', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await service.initialize();

    const receivedListener = addListenerMock.mock.calls.find(
      ([eventName]) => eventName === 'notificationReceived'
    )?.[1];

    receivedListener?.({
      actionId: 'tap',
      notification: { title: 'Release', data: { route: '/tabs/wishlist' } },
    });

    expect(infoSpy).toHaveBeenCalledWith(
      '[notifications] notification_received',
      expect.objectContaining({ title: 'Release' })
    );
  });

  it('falls back to window navigation when router navigation fails', async () => {
    router.navigateByUrl.mockRejectedValueOnce(new Error('router failed'));
    const assignMock = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign: assignMock },
    });

    try {
      await service.initialize();

      const actionListener = addListenerMock.mock.calls.find(
        ([eventName]) => eventName === 'notificationActionPerformed'
      )?.[1];

      actionListener?.({
        actionId: 'tap',
        notification: { data: { route: '/tabs/wishlist' } },
      });
      await Promise.resolve();

      expect(assignMock).toHaveBeenCalledWith('/tabs/wishlist');
    } finally {
      if (locationDescriptor) {
        Object.defineProperty(window, 'location', locationDescriptor);
      }
    }
  });

  it('logs listener attach failures without aborting initialization', async () => {
    addListenerMock
      .mockRejectedValueOnce(new Error('listener failed'))
      .mockResolvedValueOnce({ remove: () => undefined });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await service.initialize();

    expect(errorSpy).toHaveBeenCalledWith(
      '[notifications] listener_attach_failed',
      expect.any(Error)
    );
  });

  it('reports token registration failures during permitted device registration', async () => {
    preferenceStorage.setItem('game-shelf:notifications:release:enabled', 'true');
    getTokenMock.mockRejectedValueOnce(new Error('token failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await service.registerCurrentDeviceIfPermitted();

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      '[notifications] token_registration_failed',
      expect.any(Error)
    );
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
