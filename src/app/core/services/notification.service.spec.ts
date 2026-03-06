import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
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
        { provide: Messaging, useValue: {} },
        { provide: SYNC_OUTBOX_WRITER, useValue: null }
      ]
    });

    service = TestBed.inject(NotificationService);
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
