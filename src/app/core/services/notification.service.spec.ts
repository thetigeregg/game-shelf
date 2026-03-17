import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { Messaging } from '@angular/fire/messaging';
import { environment } from '../../../environments/environment';
import { NotificationService } from './notification.service';
import { SYNC_OUTBOX_WRITER } from '../data/sync-outbox-writer';

const isSupportedMock = vi.fn<() => Promise<boolean>>();
const getTokenMock = vi.fn<() => Promise<string | null>>();
const deleteTokenMock = vi.fn<() => Promise<boolean>>();
const onMessageMock = vi.fn();

vi.mock('firebase/messaging', () => ({
  isSupported: () => isSupportedMock(),
  getToken: (...args: unknown[]) => getTokenMock(...args),
  deleteToken: (...args: unknown[]) => deleteTokenMock(...args),
  onMessage: (...args: unknown[]) => {
    onMessageMock(...args);
    return () => undefined;
  }
}));

interface NotificationConstructorMock {
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
}

describe('NotificationService', () => {
  let service: NotificationService;
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };
  let originalNotification: typeof Notification | undefined;
  const originalVapidKey = environment.firebaseVapidKey;

  beforeEach(() => {
    localStorage.clear();
    originalNotification = globalThis.Notification;

    TestBed.configureTestingModule({
      providers: [
        NotificationService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: Router,
          useValue: {
            navigateByUrl: vi.fn().mockResolvedValue(true)
          }
        },
        { provide: Messaging, useValue: {} },
        { provide: SYNC_OUTBOX_WRITER, useValue: null }
      ]
    });

    service = TestBed.inject(NotificationService);
    router = TestBed.inject(Router) as unknown as { navigateByUrl: ReturnType<typeof vi.fn> };
    vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    isSupportedMock.mockResolvedValue(true);
    getTokenMock.mockResolvedValue('fcm-token-1234567890');
    deleteTokenMock.mockResolvedValue(true);
    onMessageMock.mockImplementation(() => undefined);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    environment.firebaseVapidKey = originalVapidKey;
    if (originalNotification) {
      globalThis.Notification = originalNotification;
    } else {
      delete (globalThis as { Notification?: unknown }).Notification;
    }
  });

  it('returns denied when browser permission is not granted', async () => {
    setNotificationMock({
      permission: 'default',
      requestPermission: () => Promise.resolve('denied')
    });

    const result = await service.requestPermissionAndRegister();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not granted');
  });

  it('fails registration when service worker registration cannot be resolved', async () => {
    setNotificationMock({
      permission: 'granted',
      requestPermission: () => Promise.resolve('granted')
    });
    environment.firebaseVapidKey = 'test-vapid-key';

    const resolveSpy = vi
      .spyOn(
        service as unknown as { resolveServiceWorkerRegistration: () => Promise<null> },
        'resolveServiceWorkerRegistration'
      )
      .mockResolvedValue(null);

    const result = await (
      service as unknown as {
        registerCurrentDevice: () => Promise<{ ok: boolean; message?: string }>;
      }
    ).registerCurrentDevice();

    expect(resolveSpy).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('service worker');
  });

  it('fails registration when backend token save fails', async () => {
    setNotificationMock({
      permission: 'granted',
      requestPermission: () => Promise.resolve('granted')
    });
    environment.firebaseVapidKey = 'test-vapid-key';

    vi.spyOn(
      service as unknown as {
        resolveServiceWorkerRegistration: () => Promise<ServiceWorkerRegistration>;
      },
      'resolveServiceWorkerRegistration'
    ).mockResolvedValue({} as ServiceWorkerRegistration);

    vi.spyOn(
      service as unknown as {
        httpClient: { post: (url: string, body: unknown) => unknown };
      },
      'httpClient',
      'get'
    ).mockReturnValue({
      post: () => throwError(() => new Error('backend down'))
    });

    const result = await (
      service as unknown as {
        registerCurrentDevice: () => Promise<{ ok: boolean; message?: string }>;
      }
    ).registerCurrentDevice();

    expect(result.ok).toBe(false);
    expect(result.message).toContain('server');
    expect(localStorage.getItem('game-shelf:notifications:fcm-token')).toBeNull();
  });

  it('stores token when backend registration succeeds', async () => {
    setNotificationMock({
      permission: 'granted',
      requestPermission: () => Promise.resolve('granted')
    });
    environment.firebaseVapidKey = 'test-vapid-key';

    vi.spyOn(
      service as unknown as {
        resolveServiceWorkerRegistration: () => Promise<ServiceWorkerRegistration>;
      },
      'resolveServiceWorkerRegistration'
    ).mockResolvedValue({} as ServiceWorkerRegistration);

    vi.spyOn(
      service as unknown as {
        httpClient: { post: (url: string, body: unknown) => unknown };
      },
      'httpClient',
      'get'
    ).mockReturnValue({
      post: () => of({ ok: true })
    });

    const result = await (
      service as unknown as {
        registerCurrentDevice: () => Promise<{ ok: boolean }>;
      }
    ).registerCurrentDevice();

    expect(result.ok).toBe(true);
    expect(localStorage.getItem('game-shelf:notifications:fcm-token')).toBe('fcm-token-1234567890');
  });

  it('returns not supported when messaging is unavailable', async () => {
    const noMessagingService = createService({ withMessaging: false });
    const result = await noMessagingService.requestPermissionAndRegister();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not supported on this device');
    expect(await noMessagingService.shouldPromptForReleaseNotifications()).toBe(false);
  });

  it('does not wire foreground listener when browser notifications are unsupported', async () => {
    isSupportedMock.mockResolvedValue(false);
    await service.initialize();
    expect(onMessageMock).not.toHaveBeenCalled();
  });

  it('handles requestPermissionAndRegister branches for unsupported and missing API', async () => {
    isSupportedMock.mockResolvedValue(false);
    expect(await service.requestPermissionAndRegister()).toEqual({
      ok: false,
      message: 'Notifications are not supported in this browser.'
    });

    isSupportedMock.mockResolvedValue(true);
    delete (globalThis as { Notification?: unknown }).Notification;
    expect(await service.requestPermissionAndRegister()).toEqual({
      ok: false,
      message: 'Notification API is unavailable.'
    });
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
      sale: true
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
      sale: false
    });

    localStorage.setItem('game-shelf:notifications:release:events', '{bad-json');
    expect(service.readReleaseEventPreferences()).toEqual({
      set: true,
      changed: true,
      removed: true,
      day: true,
      sale: true
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
        sale: 'false'
      })
    );

    expect(service.readReleaseEventPreferences()).toEqual({
      set: false,
      changed: false,
      removed: false,
      day: false,
      sale: false
    });
  });

  it('persists disabled state when enable flow fails', async () => {
    vi.spyOn(service, 'requestPermissionAndRegister').mockResolvedValue({
      ok: false,
      message: 'failed'
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
      message: 'Notifications disabled on this device.'
    });
    const result = await service.disableReleaseNotifications();
    expect(result.ok).toBe(true);
    expect(localStorage.getItem('game-shelf:notifications:release:enabled')).toBe('false');
  });

  it('does not persist disabled state when disable flow fails', async () => {
    localStorage.setItem('game-shelf:notifications:release:enabled', 'true');
    vi.spyOn(service, 'unregisterCurrentDevice').mockResolvedValue({
      ok: false,
      message: 'failed'
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
    setNotificationMock({
      permission: 'granted',
      requestPermission: () => Promise.resolve('granted')
    });
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
    setNotificationMock({
      permission: 'default',
      requestPermission: () => Promise.resolve('default')
    });

    const result = await service.registerCurrentDeviceIfPermitted();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not been granted');
  });

  it('resolves service worker registrations for existing, new, and error states', async () => {
    const getRegistration = vi
      .fn()
      .mockResolvedValueOnce({ id: 'existing' })
      .mockResolvedValueOnce(null);
    const register = vi
      .fn()
      .mockResolvedValueOnce({ id: 'new-registration' })
      .mockRejectedValueOnce(new Error('bad sw'));
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration, register }
    });

    const method = (
      service as unknown as {
        resolveServiceWorkerRegistration: () => Promise<ServiceWorkerRegistration | null>;
      }
    ).resolveServiceWorkerRegistration.bind(service);

    await expect(method()).resolves.toEqual({ id: 'existing' });
    await expect(method()).resolves.toEqual({ id: 'new-registration' });
    await expect(method()).resolves.toBeNull();
  });

  it('resolves device platform from user agent', () => {
    const resolvePlatform = (
      service as unknown as { resolveDevicePlatform: () => 'web' | 'android' | 'ios' }
    ).resolveDevicePlatform.bind(service);

    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    expect(resolvePlatform()).toBe('ios');

    setUserAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9)');
    expect(resolvePlatform()).toBe('android');

    setUserAgent('Mozilla/5.0 (X11; Linux x86_64)');
    expect(resolvePlatform()).toBe('web');
  });

  it('returns static firebase worker URL', () => {
    const buildUrl = (
      service as unknown as { buildFirebaseWorkerUrl: () => string }
    ).buildFirebaseWorkerUrl.bind(service);
    expect(buildUrl()).toBe('/firebase-messaging-sw.js');
  });

  it('initializes once and hooks foreground listener when supported', async () => {
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

    expect(onMessageMock).toHaveBeenCalledTimes(1);
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('registers device during initialize when enabled and permission already granted', async () => {
    localStorage.setItem('game-shelf:notifications:release:enabled', 'true');
    setNotificationMock({
      permission: 'granted',
      requestPermission: () => Promise.resolve('granted')
    });
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

  it('does not register duplicate foreground listener on initialize retry after failure', async () => {
    localStorage.setItem('game-shelf:notifications:release:enabled', 'true');
    setNotificationMock({
      permission: 'granted',
      requestPermission: () => Promise.resolve('granted')
    });
    vi.spyOn(
      service as unknown as {
        registerCurrentDevice: () => Promise<{ ok: boolean; token?: string }>;
      },
      'registerCurrentDevice'
    )
      .mockRejectedValueOnce(new Error('register failed'))
      .mockResolvedValueOnce({ ok: true, token: 'abc' });
    const beforeCount = onMessageMock.mock.calls.length;

    await expect(service.initialize()).rejects.toThrow('register failed');
    await expect(service.initialize()).resolves.toBeUndefined();

    expect(onMessageMock.mock.calls.length - beforeCount).toBe(1);
  });

  it('prompts for release notifications only when no preference is stored', async () => {
    setNotificationMock({
      permission: 'default',
      requestPermission: () => Promise.resolve('default')
    });
    expect(await service.shouldPromptForReleaseNotifications()).toBe(true);

    localStorage.setItem('game-shelf:notifications:release:enabled', 'true');
    expect(await service.shouldPromptForReleaseNotifications()).toBe(false);
  });

  it('returns warning outcome when backend unregister fails', async () => {
    localStorage.setItem('game-shelf:notifications:fcm-token', 'token-1');
    vi.spyOn(
      service as unknown as {
        httpClient: { post: (url: string, body: unknown) => unknown };
      },
      'httpClient',
      'get'
    ).mockReturnValue({
      post: () => throwError(() => new Error('backend down'))
    });

    const result = await service.unregisterCurrentDevice();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('did not fully complete');
    expect(localStorage.getItem('game-shelf:notifications:fcm-token')).toBeNull();
  });

  it('returns warning outcome when firebase deleteToken fails', async () => {
    localStorage.setItem('game-shelf:notifications:fcm-token', 'token-2');
    vi.spyOn(
      service as unknown as {
        httpClient: { post: (url: string, body: unknown) => unknown };
      },
      'httpClient',
      'get'
    ).mockReturnValue({
      post: () => of({ ok: true })
    });
    deleteTokenMock.mockRejectedValueOnce(new Error('fcm delete failed'));

    const result = await service.unregisterCurrentDevice();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('did not fully complete');
  });

  it('uses router navigation for foreground notification route clicks', async () => {
    const originalServiceWorker = navigator.serviceWorker;
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {}
    });
    const notificationInstance: { onclick: (() => void) | null } = { onclick: null };
    setForegroundNotificationMock(notificationInstance);

    (
      service as unknown as {
        showForegroundNotification: (payload: {
          notification?: { title?: string; body?: string };
          data?: Record<string, string>;
        }) => void;
      }
    ).showForegroundNotification({
      notification: { title: 'Title', body: 'Body' },
      data: { route: '/tabs/wishlist' }
    });

    notificationInstance.onclick?.();
    await Promise.resolve();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs/wishlist');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: originalServiceWorker
    });
  });

  it('handles foreground click when router navigation fails', async () => {
    const originalServiceWorker = navigator.serviceWorker;
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {}
    });
    const notificationInstance: { onclick: (() => void) | null } = { onclick: null };
    setForegroundNotificationMock(notificationInstance);
    router.navigateByUrl.mockRejectedValueOnce(new Error('router failed'));

    (
      service as unknown as {
        showForegroundNotification: (payload: {
          notification?: { title?: string; body?: string };
          data?: Record<string, string>;
        }) => void;
      }
    ).showForegroundNotification({
      notification: { title: 'Title', body: 'Body' },
      data: { route: '/tabs/wishlist' }
    });

    notificationInstance.onclick?.();
    await Promise.resolve();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs/wishlist');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: originalServiceWorker
    });
  });

  it('logs foreground notification construction failures', () => {
    const originalServiceWorker = navigator.serviceWorker;
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {}
    });
    const notificationConstructor = vi.fn(() => {
      throw new Error('notification constructor failed');
    }) as unknown as typeof Notification;
    Object.defineProperty(notificationConstructor, 'permission', {
      configurable: true,
      get: () => 'granted'
    });
    Object.defineProperty(notificationConstructor, 'requestPermission', {
      configurable: true,
      value: () => Promise.resolve('granted')
    });
    globalThis.Notification = notificationConstructor;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    (
      service as unknown as {
        showForegroundNotification: (payload: {
          notification?: { title?: string; body?: string };
          data?: Record<string, string>;
        }) => void;
      }
    ).showForegroundNotification({
      notification: { title: 'Title', body: 'Body' },
      data: {}
    });

    expect(errorSpy).toHaveBeenCalled();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: originalServiceWorker
    });
  });

  it('returns early for foreground notifications when permission is not granted or API missing', () => {
    const originalNotification = globalThis.Notification;
    const notificationSpy = vi.fn();
    const constructorWithDeniedPermission = notificationSpy as unknown as typeof Notification;
    Object.defineProperty(constructorWithDeniedPermission, 'permission', {
      configurable: true,
      get: () => 'default'
    });
    Object.defineProperty(constructorWithDeniedPermission, 'requestPermission', {
      configurable: true,
      value: () => Promise.resolve('default')
    });
    try {
      globalThis.Notification = constructorWithDeniedPermission;

      (
        service as unknown as {
          showForegroundNotification: (payload: {
            notification?: { title?: string; body?: string };
            data?: Record<string, string>;
          }) => void;
        }
      ).showForegroundNotification({ notification: { title: 'Title', body: 'Body' }, data: {} });
      expect(notificationSpy).not.toHaveBeenCalled();

      delete (globalThis as { Notification?: unknown }).Notification;
      (
        service as unknown as {
          showForegroundNotification: (payload: {
            notification?: { title?: string; body?: string };
            data?: Record<string, string>;
          }) => void;
        }
      ).showForegroundNotification({ notification: { title: 'Title', body: 'Body' }, data: {} });
      expect(notificationSpy).not.toHaveBeenCalled();
    } finally {
      if (typeof originalNotification === 'undefined') {
        delete (globalThis as { Notification?: unknown }).Notification;
      } else {
        globalThis.Notification = originalNotification;
      }
    }
  });

  it('uses service worker showNotification for foreground message when available', async () => {
    const originalServiceWorker = navigator.serviceWorker;
    const originalNotification = globalThis.Notification;
    const showNotification = vi.fn().mockResolvedValue(undefined);
    try {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          getRegistration: vi.fn().mockResolvedValue({ showNotification })
        }
      });
      const fallbackConstructorSpy = vi.fn();
      const notificationConstructor = fallbackConstructorSpy as unknown as typeof Notification;
      Object.defineProperty(notificationConstructor, 'permission', {
        configurable: true,
        get: () => 'granted'
      });
      Object.defineProperty(notificationConstructor, 'requestPermission', {
        configurable: true,
        value: () => Promise.resolve('granted')
      });
      globalThis.Notification = notificationConstructor;

      (
        service as unknown as {
          showForegroundNotification: (payload: {
            notification?: { title?: string; body?: string };
            data?: Record<string, string>;
          }) => void;
        }
      ).showForegroundNotification({
        notification: { title: 'Title', body: 'Body' },
        data: { route: '/tabs/discover' }
      });
      await Promise.resolve();

      expect(showNotification).toHaveBeenCalledOnce();
      expect(fallbackConstructorSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: originalServiceWorker
      });
      if (typeof originalNotification === 'undefined') {
        delete (globalThis as { Notification?: unknown }).Notification;
      } else {
        globalThis.Notification = originalNotification;
      }
    }
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
    const serviceWithOutbox = createService({
      withMessaging: true,
      outboxWriter: { enqueueOperation }
    });

    serviceWithOutbox.setReleaseNotificationsEnabled(true);

    expect(enqueueOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'setting',
        operation: 'upsert',
        payload: {
          key: 'game-shelf:notifications:release:enabled',
          value: 'true'
        }
      })
    );
  });
});

function setNotificationMock(config: NotificationConstructorMock): void {
  const notificationConstructor = function notificationConstructor() {
    return undefined;
  } as unknown as typeof Notification;

  Object.defineProperty(notificationConstructor, 'permission', {
    configurable: true,
    get: () => config.permission
  });
  Object.defineProperty(notificationConstructor, 'requestPermission', {
    configurable: true,
    value: config.requestPermission
  });

  globalThis.Notification = notificationConstructor;
}

function setForegroundNotificationMock(instance: { onclick: (() => void) | null }): void {
  const notificationConstructor = function notificationConstructor() {
    return instance as unknown as Notification;
  } as unknown as typeof Notification;

  Object.defineProperty(notificationConstructor, 'permission', {
    configurable: true,
    get: () => 'granted'
  });
  Object.defineProperty(notificationConstructor, 'requestPermission', {
    configurable: true,
    value: () => Promise.resolve('granted')
  });

  globalThis.Notification = notificationConstructor;
}

function setUserAgent(userAgent: string): void {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent
  });
}

function createService(options: {
  withMessaging: boolean;
  outboxWriter?: { enqueueOperation: (operation: unknown) => Promise<void> | void } | null;
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
          navigateByUrl: vi.fn().mockResolvedValue(true)
        }
      },
      ...(options.withMessaging ? [{ provide: Messaging, useValue: {} }] : []),
      { provide: SYNC_OUTBOX_WRITER, useValue: options.outboxWriter ?? null }
    ]
  });

  return TestBed.inject(NotificationService);
}
