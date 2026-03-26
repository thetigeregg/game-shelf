import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  };
});

vi.mock('./core/config/runtime-config', () => ({
  getAppVersion: vi.fn(() => '1.27.1'),
  isE2eFixturesEnabled: vi.fn(() => false),
}));

import { AlertController, ToastController } from '@ionic/angular/standalone';
import { AppComponent } from './app.component';
import { getAppVersion, isE2eFixturesEnabled } from './core/config/runtime-config';
import { ThemeService } from './core/services/theme.service';
import { GameSyncService } from './core/services/game-sync.service';
import { DebugLogService } from './core/services/debug-log.service';
import { GameShelfService } from './core/services/game-shelf.service';
import { NotificationService } from './core/services/notification.service';
import { E2eFixtureService } from './core/services/e2e-fixture.service';

const LAST_SEEN_APP_VERSION_STORAGE_KEY = 'game_shelf_last_seen_app_version';

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
  const alertControllerMock = {
    create: vi.fn(),
  };
  const toastControllerMock = {
    create: vi.fn(),
  };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(getAppVersion).mockReturnValue('1.27.1');
    vi.mocked(isE2eFixturesEnabled).mockReturnValue(false);
    themeServiceMock.initialize.mockReturnValue(undefined);
    gameSyncServiceMock.initialize.mockReturnValue(undefined);
    debugLogServiceMock.initialize.mockReturnValue(undefined);
    gameShelfServiceMock.migratePreferredPlatformCoversToIgdb.mockResolvedValue(undefined);
    gameShelfServiceMock.migrateLegacyPickerCoversToCustomCovers.mockResolvedValue(undefined);
    notificationServiceMock.initialize.mockResolvedValue(undefined);
    notificationServiceMock.shouldPromptForReleaseNotifications.mockResolvedValue(false);
    notificationServiceMock.enableReleaseNotifications.mockResolvedValue({
      ok: true,
      message: 'Enabled',
    });
    alertControllerMock.create.mockResolvedValue({
      present: vi.fn().mockResolvedValue(undefined),
    });
    toastControllerMock.create.mockResolvedValue({
      present: vi.fn().mockResolvedValue(undefined),
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ThemeService, useValue: themeServiceMock },
        { provide: GameSyncService, useValue: gameSyncServiceMock },
        { provide: DebugLogService, useValue: debugLogServiceMock },
        { provide: GameShelfService, useValue: gameShelfServiceMock },
        { provide: NotificationService, useValue: notificationServiceMock },
        { provide: E2eFixtureService, useValue: e2eFixtureServiceMock },
        { provide: AlertController, useValue: alertControllerMock },
        { provide: ToastController, useValue: toastControllerMock },
      ],
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function flushAsync(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('runs legacy cover migration even when the preferred-platform migration fails', async () => {
    gameShelfServiceMock.migratePreferredPlatformCoversToIgdb.mockRejectedValue(
      new Error('preferred migration failed')
    );

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(themeServiceMock.initialize).toHaveBeenCalledOnce();
    expect(gameSyncServiceMock.initialize).toHaveBeenCalledOnce();
    expect(debugLogServiceMock.initialize).toHaveBeenCalledOnce();
    expect(gameShelfServiceMock.migratePreferredPlatformCoversToIgdb).toHaveBeenCalledOnce();
    expect(gameShelfServiceMock.migrateLegacyPickerCoversToCustomCovers).toHaveBeenCalledOnce();
  });

  it('applies e2e fixtures when enabled', async () => {
    vi.mocked(isE2eFixturesEnabled).mockReturnValue(true);

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(e2eFixtureServiceMock.applyFixtureFromStorage).toHaveBeenCalledOnce();
  });

  it('presents a version alert and stores the current app version on first load', async () => {
    const present = vi.fn().mockResolvedValue(undefined);
    alertControllerMock.create.mockResolvedValueOnce({ present });

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
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, vi.mocked(getAppVersion)());
    notificationServiceMock.initialize.mockRejectedValueOnce(new Error('notifications failed'));

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(errorSpy).toHaveBeenCalledWith('[app] notifications_init_failed', expect.any(Error));
  });
});
