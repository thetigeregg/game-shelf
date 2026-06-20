import { computed, signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';

vi.mock('@ionic/angular/standalone', () => {
  const Dummy = () => null;
  const AlertControllerToken = function AlertController() {
    return undefined;
  };
  const ToastControllerToken = function ToastController() {
    return undefined;
  };

  return {
    AlertController: AlertControllerToken,
    ToastController: ToastControllerToken,
    IonApp: Dummy,
    IonRouterOutlet: Dummy,
    IonProgressBar: Dummy,
  };
});

vi.mock('./core/config/runtime-config', () => ({
  getAppVersionInfo: vi.fn(() => ({ value: '1.27.1', source: 'live', isFallback: false })),
  isE2eFixturesEnabled: vi.fn(() => false),
  isAuthRequired: vi.fn(() => true),
}));

const { splashHideMock } = vi.hoisted(() => ({
  splashHideMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/splash-screen', () => ({
  SplashScreen: {
    hide: splashHideMock,
  },
}));

vi.mock('./core/utils/native-platform.util', () => ({
  isNativePlatform: vi.fn(() => false),
}));

import { AlertController, ToastController } from '@ionic/angular/standalone';
import { AppComponent } from './app.component';
import {
  getAppVersionInfo,
  isAuthRequired,
  isE2eFixturesEnabled,
} from './core/config/runtime-config';
import { isNativePlatform } from './core/utils/native-platform.util';
import { ThemeService } from './core/services/theme.service';
import { GameSyncService } from './core/services/game-sync.service';
import { DebugLogService } from './core/services/debug-log.service';
import { GameShelfService } from './core/services/game-shelf.service';
import { NotificationService } from './core/services/notification.service';
import { E2eFixtureService } from './core/services/e2e-fixture.service';
import { RuntimeAvailabilityService } from './core/services/runtime-availability.service';
import { NetworkConnectivityService } from './core/services/network-connectivity.service';
import { LiveUpdateService } from './core/services/live-update.service';
import { PreferenceStorageService } from './core/storage/preference-storage.service';
import { ClientWriteAuthService } from './core/services/client-write-auth.service';

const LAST_SEEN_APP_VERSION_STORAGE_KEY = 'game_shelf_last_seen_app_version';

const availabilityStatus = signal<'checking' | 'online' | 'offline' | 'service-unreachable'>(
  'online'
);
const availabilityBannerMessage = computed((): string | null => {
  switch (availabilityStatus()) {
    case 'offline':
      return 'Offline. Cached library data is still available, but sync and live lookups are paused.';
    case 'service-unreachable':
      return 'Connection unavailable. Cached data is available, but sync, search, manuals, and live metadata are currently unavailable.';
    default:
      return null;
  }
});

describe('AppComponent', () => {
  function getPromptButtons(value: unknown): Array<{ handler?: () => void | Promise<void> }> {
    if (!value || typeof value !== 'object' || !('buttons' in value)) {
      throw new Error('Expected alert config with buttons.');
    }

    const { buttons } = value;
    if (!Array.isArray(buttons)) {
      throw new Error('Expected alert config buttons array.');
    }

    return buttons as Array<{ handler?: () => void | Promise<void> }>;
  }

  const themeServiceMock = {
    initialize: vi.fn(),
  };
  const gameSyncServiceMock = {
    initialize: vi.fn(),
  };
  const debugLogServiceMock = {
    initialize: vi.fn(),
    trace: vi.fn(),
    info: vi.fn(),
  };
  const gameShelfServiceMock = {
    migratePreferredPlatformCoversToIgdb: vi.fn(),
    migrateLegacyPickerCoversToCustomCovers: vi.fn(),
  };
  const notificationServiceMock = {
    initialize: vi.fn().mockResolvedValue(undefined),
    shouldPromptForReleaseNotifications: vi.fn().mockResolvedValue(false),
    enableReleaseNotifications: vi.fn().mockResolvedValue({ ok: true, message: 'Enabled' }),
    setReleaseNotificationsEnabled: vi.fn(),
  };
  const e2eFixtureServiceMock = {
    applyFixtureFromStorage: vi.fn().mockResolvedValue(undefined),
  };
  const liveUpdateServiceMock: {
    markReady: ReturnType<typeof vi.fn>;
    reload: ReturnType<typeof vi.fn>;
    staged$: Subject<{ semver: string }>;
  } = {
    markReady: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    staged$: new Subject<{ semver: string }>(),
  };
  const alertControllerMock = {
    create: vi.fn(),
    getTop: vi.fn(),
  };
  const toastControllerMock = {
    create: vi.fn(),
  };
  const runtimeAvailabilityServiceMock = {
    initialize: vi.fn(),
    status: availabilityStatus,
    bannerMessage: availabilityBannerMessage,
  };
  const networkConnectivityServiceMock = {
    initialize: vi.fn(),
  };
  const clientWriteAuthServiceMock = {
    hasToken: vi.fn(() => false),
    setToken: vi.fn(),
  };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(getAppVersionInfo).mockReturnValue({
      value: '1.27.1',
      source: 'live',
      isFallback: false,
    });
    vi.mocked(isE2eFixturesEnabled).mockReturnValue(false);
    themeServiceMock.initialize.mockReturnValue(undefined);
    gameSyncServiceMock.initialize.mockResolvedValue(undefined);
    debugLogServiceMock.initialize.mockReturnValue(undefined);
    gameShelfServiceMock.migratePreferredPlatformCoversToIgdb.mockResolvedValue(undefined);
    gameShelfServiceMock.migrateLegacyPickerCoversToCustomCovers.mockResolvedValue(undefined);
    notificationServiceMock.initialize.mockResolvedValue(undefined);
    notificationServiceMock.shouldPromptForReleaseNotifications.mockResolvedValue(false);
    notificationServiceMock.enableReleaseNotifications.mockResolvedValue({
      ok: true,
      message: 'Enabled',
    });
    liveUpdateServiceMock.markReady.mockResolvedValue(undefined);
    liveUpdateServiceMock.reload.mockResolvedValue(undefined);
    liveUpdateServiceMock.staged$ = new Subject<{ semver: string }>();
    alertControllerMock.create.mockResolvedValue({
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn().mockResolvedValue({ role: 'cancel', data: undefined }),
    });
    alertControllerMock.getTop.mockResolvedValue(null);
    clientWriteAuthServiceMock.hasToken.mockReturnValue(false);
    clientWriteAuthServiceMock.setToken.mockReset();
    toastControllerMock.create.mockResolvedValue({
      present: vi.fn().mockResolvedValue(undefined),
    });
    runtimeAvailabilityServiceMock.initialize.mockReturnValue(undefined);
    availabilityStatus.set('online');
    networkConnectivityServiceMock.initialize.mockReturnValue(undefined);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ThemeService, useValue: themeServiceMock },
        { provide: GameSyncService, useValue: gameSyncServiceMock },
        { provide: DebugLogService, useValue: debugLogServiceMock },
        { provide: GameShelfService, useValue: gameShelfServiceMock },
        { provide: NotificationService, useValue: notificationServiceMock },
        { provide: E2eFixtureService, useValue: e2eFixtureServiceMock },
        { provide: LiveUpdateService, useValue: liveUpdateServiceMock },
        { provide: AlertController, useValue: alertControllerMock },
        { provide: ToastController, useValue: toastControllerMock },
        { provide: RuntimeAvailabilityService, useValue: runtimeAvailabilityServiceMock },
        { provide: NetworkConnectivityService, useValue: networkConnectivityServiceMock },
        { provide: ClientWriteAuthService, useValue: clientWriteAuthServiceMock },
        PreferenceStorageService,
      ],
    });
    TestBed.overrideComponent(AppComponent, {
      set: {
        template: `
          @if (runtimeAvailabilityService.bannerMessage(); as message) {
            <div class="availability-banner">{{ message }}</div>
          }
        `,
        imports: [],
        styleUrls: [],
      },
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function flushAsync(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function flushAsyncWithFakeTimers(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }

  function getFixtureRoot(fixture: ComponentFixture<AppComponent>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('runs legacy cover migration even when the preferred-platform migration fails', async () => {
    gameShelfServiceMock.migratePreferredPlatformCoversToIgdb.mockRejectedValue(
      new Error('preferred migration failed')
    );

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(themeServiceMock.initialize).toHaveBeenCalledOnce();
    expect(networkConnectivityServiceMock.initialize).toHaveBeenCalledOnce();
    expect(runtimeAvailabilityServiceMock.initialize).toHaveBeenCalledOnce();
    expect(debugLogServiceMock.initialize).toHaveBeenCalledOnce();
    expect(gameSyncServiceMock.initialize).toHaveBeenCalledOnce();
    expect(gameShelfServiceMock.migratePreferredPlatformCoversToIgdb).toHaveBeenCalledOnce();
    expect(gameShelfServiceMock.migrateLegacyPickerCoversToCustomCovers).toHaveBeenCalledOnce();
  });

  it('applies e2e fixtures when enabled', async () => {
    vi.mocked(isE2eFixturesEnabled).mockReturnValue(true);

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(e2eFixtureServiceMock.applyFixtureFromStorage).toHaveBeenCalledOnce();
  });

  it('renders an availability banner when the app is offline', async () => {
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');
    availabilityStatus.set('offline');

    const fixture: ComponentFixture<AppComponent> = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await flushAsync();

    const root = getFixtureRoot(fixture);
    expect(root.textContent).toContain('Offline');
    expect(root.querySelector('.availability-banner')).not.toBeNull();
    expect(alertControllerMock.create).not.toHaveBeenCalled();
  });

  it('renders an availability banner when the backend is unreachable', async () => {
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');
    availabilityStatus.set('service-unreachable');

    const fixture: ComponentFixture<AppComponent> = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await flushAsync();

    const root = getFixtureRoot(fixture);
    expect(root.textContent).toContain('Connection unavailable');
    expect(root.querySelector('.availability-banner')).not.toBeNull();
    expect(alertControllerMock.create).not.toHaveBeenCalled();
  });

  it('hides the availability banner when the app is online or checking', async () => {
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');

    const fixture: ComponentFixture<AppComponent> = TestBed.createComponent(AppComponent);
    availabilityStatus.set('checking');
    fixture.detectChanges();
    expect(getFixtureRoot(fixture).querySelector('.availability-banner')).toBeNull();

    availabilityStatus.set('online');
    fixture.detectChanges();
    await flushAsync();

    expect(getFixtureRoot(fixture).querySelector('.availability-banner')).toBeNull();
  });

  it('presents a version alert and stores the current app version on first load', async () => {
    const present = vi.fn().mockResolvedValue(undefined);
    alertControllerMock.create.mockResolvedValueOnce({
      present,
      onDidDismiss: vi.fn().mockResolvedValue(undefined),
    });

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(alertControllerMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        header: 'App Updated',
        message: 'Welcome to Game Shelf v1.27.1.',
        buttons: ['OK'],
      })
    );
    expect(present).toHaveBeenCalledOnce();
    expect(localStorage.getItem(LAST_SEEN_APP_VERSION_STORAGE_KEY)).toBe('1.27.1');
  });

  it('skips the version alert when the current version was already seen', async () => {
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(alertControllerMock.create).not.toHaveBeenCalled();
  });

  it('skips the version alert when runtime config is only available from persisted fallback', async () => {
    vi.mocked(getAppVersionInfo).mockReturnValue({
      value: '1.27.1',
      source: 'persisted',
      isFallback: false,
    });

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(alertControllerMock.create).not.toHaveBeenCalled();
  });

  it('silently stores a newer version when a previous version was already seen', async () => {
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.0');

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(alertControllerMock.create).not.toHaveBeenCalled();
    expect(localStorage.getItem(LAST_SEEN_APP_VERSION_STORAGE_KEY)).toBe('1.27.1');
  });

  it('skips the version alert when the current version is still the fallback placeholder', async () => {
    vi.mocked(getAppVersionInfo).mockReturnValue({
      value: '0.0.0',
      source: 'live',
      isFallback: true,
    });

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(alertControllerMock.create).not.toHaveBeenCalled();
  });

  it('skips the version alert when window is unavailable', async () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

    Object.defineProperty(globalThis, 'window', {
      value: undefined,
      configurable: true,
    });

    try {
      TestBed.runInInjectionContext(() => new AppComponent());
      await flushAsync();

      expect(alertControllerMock.create).not.toHaveBeenCalled();
      expect(notificationServiceMock.initialize).toHaveBeenCalledOnce();
    } finally {
      if (windowDescriptor) {
        Object.defineProperty(globalThis, 'window', windowDescriptor);
      }
    }
  });

  it('prompts for release notifications and enables them from the prompt', async () => {
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');
    notificationServiceMock.shouldPromptForReleaseNotifications.mockResolvedValue(true);
    const presentAlert = vi.fn().mockResolvedValue(undefined);
    const presentToast = vi.fn().mockResolvedValue(undefined);
    alertControllerMock.create.mockResolvedValueOnce({ present: presentAlert });
    toastControllerMock.create.mockResolvedValueOnce({ present: presentToast });

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(alertControllerMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        header: 'Enable Release Notifications?',
      })
    );
    const notificationPrompt = alertControllerMock.create.mock.calls[0]?.[0] as unknown;
    const buttons = getPromptButtons(notificationPrompt);
    await buttons[1]?.handler?.();
    await flushAsync();

    expect(notificationServiceMock.enableReleaseNotifications).toHaveBeenCalledOnce();
    expect(toastControllerMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Enabled',
        color: 'primary',
        duration: 3500,
        position: 'bottom',
      })
    );
    expect(presentAlert).toHaveBeenCalledOnce();
    expect(presentToast).toHaveBeenCalledOnce();
  });

  it('stores a declined release notification preference from the prompt', async () => {
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');
    notificationServiceMock.shouldPromptForReleaseNotifications.mockResolvedValue(true);
    alertControllerMock.create.mockResolvedValueOnce({
      present: vi.fn().mockResolvedValue(undefined),
    });

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    const notificationPrompt = alertControllerMock.create.mock.calls[0]?.[0] as unknown;
    const buttons = getPromptButtons(notificationPrompt);
    await buttons[0]?.handler?.();

    expect(notificationServiceMock.setReleaseNotificationsEnabled).toHaveBeenCalledWith(false);
  });

  it('logs version alert failures and continues notification initialization', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    alertControllerMock.create.mockRejectedValueOnce(new Error('alert create failed'));

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(errorSpy).toHaveBeenCalledWith('[app] version_alert_failed', expect.any(Error));
    expect(notificationServiceMock.initialize).toHaveBeenCalledOnce();
  });

  it('logs notification initialization failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, vi.mocked(getAppVersionInfo)().value);
    notificationServiceMock.initialize.mockRejectedValueOnce(new Error('notifications failed'));

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(errorSpy).toHaveBeenCalledWith('[app] notifications_init_failed', expect.any(Error));
  });

  it('does not hide the splash screen on web', async () => {
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');
    vi.mocked(isNativePlatform).mockReturnValue(false);

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(splashHideMock).not.toHaveBeenCalled();
  });

  it('hides the splash screen on native after startup with a fade-out', async () => {
    vi.useFakeTimers();
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');
    vi.mocked(isNativePlatform).mockReturnValue(true);
    clientWriteAuthServiceMock.hasToken.mockReturnValue(true);

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsyncWithFakeTimers();
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();

    expect(splashHideMock).toHaveBeenCalledWith({ fadeOutDuration: 300 });
  });

  it('logs splash screen hide failures', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');
    vi.mocked(isNativePlatform).mockReturnValue(true);
    clientWriteAuthServiceMock.hasToken.mockReturnValue(true);
    splashHideMock.mockRejectedValueOnce(new Error('splash hide failed'));

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsyncWithFakeTimers();
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith('[app] splash_screen_hide_failed', expect.any(Error));
  });

  describe('OTA update alert', () => {
    beforeEach(() => {
      localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');
      vi.mocked(isNativePlatform).mockReturnValue(false);
    });

    it('presents the OTA update alert when a bundle is staged', async () => {
      const present = vi.fn().mockResolvedValue(undefined);
      alertControllerMock.create.mockResolvedValueOnce({ present });

      TestBed.runInInjectionContext(() => new AppComponent());
      await flushAsync();

      liveUpdateServiceMock.staged$.next({ semver: '1.28.0' });
      await flushAsync();

      expect(alertControllerMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          header: 'Update Ready',
          message: 'Game Shelf v1.28.0 has been downloaded. Reload now to apply it.',
        })
      );
      expect(present).toHaveBeenCalledOnce();
    });

    it('calls reload when the Reload button is tapped', async () => {
      const present = vi.fn().mockResolvedValue(undefined);
      alertControllerMock.create.mockResolvedValueOnce({ present });

      TestBed.runInInjectionContext(() => new AppComponent());
      await flushAsync();

      liveUpdateServiceMock.staged$.next({ semver: '1.28.0' });
      await flushAsync();

      const otaAlertConfig = alertControllerMock.create.mock.calls[0]?.[0] as unknown;
      const buttons = getPromptButtons(otaAlertConfig);
      void buttons[1]?.handler?.();

      expect(liveUpdateServiceMock.reload).toHaveBeenCalledOnce();
    });

    it('does not call reload when Later is tapped', async () => {
      const present = vi.fn().mockResolvedValue(undefined);
      alertControllerMock.create.mockResolvedValueOnce({ present });

      TestBed.runInInjectionContext(() => new AppComponent());
      await flushAsync();

      liveUpdateServiceMock.staged$.next({ semver: '1.28.0' });
      await flushAsync();

      const otaAlertConfig = alertControllerMock.create.mock.calls[0]?.[0] as unknown;
      const buttons = getPromptButtons(otaAlertConfig);
      expect(buttons[0]).not.toHaveProperty('handler');
      expect(liveUpdateServiceMock.reload).not.toHaveBeenCalled();
    });

    it('logs an error when alert creation fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      alertControllerMock.create.mockRejectedValueOnce(new Error('overlay error'));

      TestBed.runInInjectionContext(() => new AppComponent());
      await flushAsync();

      liveUpdateServiceMock.staged$.next({ semver: '1.28.0' });
      await flushAsync();

      expect(errorSpy).toHaveBeenCalledWith('[app] ota_alert_failed', expect.any(Error));
    });
  });

  describe('promptForWriteTokenIfNeeded', () => {
    beforeEach(() => {
      localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');
      // Stub Date.now so hideSplashScreenWhenReady sees remainingVisibleMs <= 0,
      // preventing a real 300ms timer from leaking into subsequent tests.
      const fakeNow = Date.now();
      vi.spyOn(Date, 'now')
        .mockReturnValueOnce(fakeNow) // appStartedAt (field initializer)
        .mockReturnValue(fakeNow + 400); // hideSplashScreenWhenReady: 300 - 400 = -100 <= 0
    });

    it('shows the write-token alert on native when no token is stored', async () => {
      vi.mocked(isNativePlatform).mockReturnValue(true);
      clientWriteAuthServiceMock.hasToken.mockReturnValue(false);
      const present = vi.fn().mockResolvedValue(undefined);
      alertControllerMock.create.mockResolvedValueOnce({
        present,
        onDidDismiss: vi.fn().mockResolvedValue({ role: 'cancel', data: undefined }),
      });

      TestBed.runInInjectionContext(() => new AppComponent());
      await flushAsync();

      expect(splashHideMock).toHaveBeenCalledWith({ fadeOutDuration: 300 });
      expect(alertControllerMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          header: 'Server Access',
          backdropDismiss: false,
        })
      );
      expect(present).toHaveBeenCalledOnce();
    });

    it('logs write-token prompt failures and continues startup', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.mocked(isNativePlatform).mockReturnValue(true);
      clientWriteAuthServiceMock.hasToken.mockReturnValue(false);
      alertControllerMock.create.mockRejectedValueOnce(new Error('alert create failed'));

      TestBed.runInInjectionContext(() => new AppComponent());
      await flushAsync();

      expect(errorSpy).toHaveBeenCalledWith('[app] write_token_prompt_failed', expect.any(Error));
      expect(gameSyncServiceMock.initialize).toHaveBeenCalledOnce();
    });

    it('does not show the write-token alert on native when a token is already stored', async () => {
      vi.mocked(isNativePlatform).mockReturnValue(true);
      clientWriteAuthServiceMock.hasToken.mockReturnValue(true);

      TestBed.runInInjectionContext(() => new AppComponent());
      await flushAsync();

      expect(alertControllerMock.create).not.toHaveBeenCalled();
    });

    it('does not show the write-token alert on web even when no token is stored', async () => {
      vi.mocked(isNativePlatform).mockReturnValue(false);
      clientWriteAuthServiceMock.hasToken.mockReturnValue(false);

      TestBed.runInInjectionContext(() => new AppComponent());
      await flushAsync();

      expect(alertControllerMock.create).not.toHaveBeenCalled();
    });

    it('stores the token when the user confirms with a non-empty value', async () => {
      vi.mocked(isNativePlatform).mockReturnValue(true);
      clientWriteAuthServiceMock.hasToken.mockReturnValue(false);
      alertControllerMock.create.mockResolvedValueOnce({
        present: vi.fn().mockResolvedValue(undefined),
        onDidDismiss: vi.fn().mockResolvedValue({
          role: 'confirm',
          data: { values: { token: 'my-secret-token' } },
        }),
      });

      TestBed.runInInjectionContext(() => new AppComponent());
      await flushAsync();

      expect(clientWriteAuthServiceMock.setToken).toHaveBeenCalledWith('my-secret-token');
    });

    it('shows a warning toast and does not store the token when the user confirms with an empty value', async () => {
      vi.mocked(isNativePlatform).mockReturnValue(true);
      clientWriteAuthServiceMock.hasToken.mockReturnValue(false);
      const presentToast = vi.fn().mockResolvedValue(undefined);
      toastControllerMock.create.mockResolvedValueOnce({ present: presentToast });
      alertControllerMock.create.mockResolvedValueOnce({
        present: vi.fn().mockResolvedValue(undefined),
        onDidDismiss: vi.fn().mockResolvedValue({
          role: 'confirm',
          data: { values: { token: '   ' } },
        }),
      });

      TestBed.runInInjectionContext(() => new AppComponent());
      await flushAsync();

      expect(clientWriteAuthServiceMock.setToken).not.toHaveBeenCalled();
      expect(toastControllerMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Write token cannot be empty.',
          color: 'warning',
        })
      );
      expect(presentToast).toHaveBeenCalledOnce();
    });

    it('does not store the token when the user skips', async () => {
      vi.mocked(isNativePlatform).mockReturnValue(true);
      clientWriteAuthServiceMock.hasToken.mockReturnValue(false);
      alertControllerMock.create.mockResolvedValueOnce({
        present: vi.fn().mockResolvedValue(undefined),
        onDidDismiss: vi.fn().mockResolvedValue({ role: 'cancel', data: undefined }),
      });

      TestBed.runInInjectionContext(() => new AppComponent());
      await flushAsync();

      expect(clientWriteAuthServiceMock.setToken).not.toHaveBeenCalled();
    });

    it('does not show the write-token alert when auth is not required', async () => {
      vi.mocked(isAuthRequired).mockReturnValue(false);
      vi.mocked(isNativePlatform).mockReturnValue(true);
      clientWriteAuthServiceMock.hasToken.mockReturnValue(false);

      TestBed.runInInjectionContext(() => new AppComponent());
      await flushAsync();

      expect(alertControllerMock.create).not.toHaveBeenCalled();
    });
  });
});
