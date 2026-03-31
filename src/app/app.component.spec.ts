import { signal } from '@angular/core';
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
  getAppVersionInfo: vi.fn(() => ({ value: '1.27.1', source: 'live', isFallback: false })),
  isE2eFixturesEnabled: vi.fn(() => false),
}));

import { AlertController, ToastController } from '@ionic/angular/standalone';
import { AppComponent } from './app.component';
import { getAppVersionInfo, isE2eFixturesEnabled } from './core/config/runtime-config';
import { ThemeService } from './core/services/theme.service';
import { GameSyncService } from './core/services/game-sync.service';
import { DebugLogService } from './core/services/debug-log.service';
import { GameShelfService } from './core/services/game-shelf.service';
import { NotificationService } from './core/services/notification.service';
import { E2eFixtureService } from './core/services/e2e-fixture.service';
import { RuntimeAvailabilityService } from './core/services/runtime-availability.service';
import { PwaUpdateService } from './core/services/pwa-update.service';

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

  function getAlertMessage(value: unknown): string {
    if (!value || typeof value !== 'object' || !('message' in value)) {
      throw new Error('Expected alert config with message.');
    }

    const { message } = value;
    if (typeof message !== 'string') {
      throw new Error('Expected alert config message string.');
    }

    return message;
  }

  const themeServiceMock = {
    initialize: vi.fn(),
  };
  const gameSyncServiceMock = {
    initialize: vi.fn(),
    hasPendingSyncWork: vi.fn().mockResolvedValue(false),
    flushPendingSyncForReload: vi.fn().mockResolvedValue(true),
    getReloadSummary: vi.fn().mockResolvedValue({
      connectivity: 'online',
      isSyncInFlight: false,
      pendingOutboxCount: 0,
      lastSyncAt: '2026-03-30T18:00:00.000Z',
    }),
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
    getTop: vi.fn(),
  };
  const toastControllerMock = {
    create: vi.fn(),
  };
  const runtimeAvailabilityServiceMock = {
    initialize: vi.fn(),
    status: signal<'checking' | 'online' | 'offline' | 'service-unreachable'>('online'),
  };
  const pwaUpdateServiceMock = {
    initialize: vi.fn(),
    updateReady: signal<{ latestVersion: { hash: string } } | null>(null),
    unrecoverableState: signal<{ reason: string } | null>(null),
    consumePendingReloadVersion: vi.fn().mockReturnValue(null),
    markPendingReloadVersion: vi.fn(),
    reload: vi.fn(),
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
    gameSyncServiceMock.initialize.mockReturnValue(undefined);
    gameSyncServiceMock.hasPendingSyncWork.mockResolvedValue(false);
    gameSyncServiceMock.flushPendingSyncForReload.mockResolvedValue(true);
    gameSyncServiceMock.getReloadSummary.mockResolvedValue({
      connectivity: 'online',
      isSyncInFlight: false,
      pendingOutboxCount: 0,
      lastSyncAt: '2026-03-30T18:00:00.000Z',
    });
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
      onDidDismiss: vi.fn().mockResolvedValue(undefined),
    });
    alertControllerMock.getTop.mockResolvedValue(null);
    toastControllerMock.create.mockResolvedValue({
      present: vi.fn().mockResolvedValue(undefined),
    });
    runtimeAvailabilityServiceMock.initialize.mockReturnValue(undefined);
    runtimeAvailabilityServiceMock.status.set('online');
    pwaUpdateServiceMock.initialize.mockReturnValue(undefined);
    pwaUpdateServiceMock.updateReady.set(null);
    pwaUpdateServiceMock.unrecoverableState.set(null);
    pwaUpdateServiceMock.consumePendingReloadVersion.mockReturnValue(null);

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
        { provide: RuntimeAvailabilityService, useValue: runtimeAvailabilityServiceMock },
        { provide: PwaUpdateService, useValue: pwaUpdateServiceMock },
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
    expect(runtimeAvailabilityServiceMock.initialize).toHaveBeenCalledOnce();
    expect(pwaUpdateServiceMock.initialize).toHaveBeenCalledOnce();
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

  it('presents a connection alert when reachability changes to service-unreachable', async () => {
    const present = vi.fn().mockResolvedValue(undefined);
    const onDidDismiss = vi.fn().mockResolvedValue(undefined);
    alertControllerMock.create.mockResolvedValue({
      present,
      onDidDismiss,
    });
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    runtimeAvailabilityServiceMock.status.set('service-unreachable');
    await flushAsync();

    expect(alertControllerMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        header: 'Connection Unavailable',
      })
    );
    expect(present).toHaveBeenCalledOnce();
  });

  it('does not stack duplicate connection alerts while one is already active', async () => {
    let resolveDismiss: (() => void) | undefined;
    const present = vi.fn().mockResolvedValue(undefined);
    const onDidDismiss = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDismiss = resolve;
        })
    );
    alertControllerMock.create.mockResolvedValue({
      present,
      onDidDismiss,
    });
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    runtimeAvailabilityServiceMock.status.set('service-unreachable');
    await flushAsync();
    runtimeAvailabilityServiceMock.status.set('offline');
    runtimeAvailabilityServiceMock.status.set('service-unreachable');
    await flushAsync();

    expect(alertControllerMock.create).toHaveBeenCalledTimes(1);

    resolveDismiss?.();
    await flushAsync();
  });

  it('dismisses only the tracked connection alert when availability recovers', async () => {
    const dismissConnectionAlert = vi.fn().mockResolvedValue(true);
    const connectionAlert = {
      present: vi.fn().mockResolvedValue(undefined),
      dismiss: dismissConnectionAlert,
      onDidDismiss: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 5);
          })
      ),
    };
    const unrelatedTopAlert = {
      dismiss: vi.fn().mockResolvedValue(true),
    };

    alertControllerMock.create.mockResolvedValue(connectionAlert);
    alertControllerMock.getTop.mockResolvedValue(unrelatedTopAlert);
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    runtimeAvailabilityServiceMock.status.set('service-unreachable');
    await flushAsync();
    runtimeAvailabilityServiceMock.status.set('online');
    await flushAsync();

    expect(dismissConnectionAlert).toHaveBeenCalledOnce();
    expect(unrelatedTopAlert.dismiss).not.toHaveBeenCalled();
  });

  it('skips dismissing the tracked connection alert when no dismiss function is available', async () => {
    const connectionAlert = {
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 5);
          })
      ),
    };

    alertControllerMock.create.mockResolvedValue(connectionAlert);
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    runtimeAvailabilityServiceMock.status.set('service-unreachable');
    await flushAsync();
    runtimeAvailabilityServiceMock.status.set('online');
    await flushAsync();

    expect(connectionAlert.present).toHaveBeenCalledOnce();
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

  it('skips the version alert until a pending reload version is consumed', async () => {
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.0');

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(alertControllerMock.create).not.toHaveBeenCalled();
  });

  it('presents the version alert after a marked update reload reaches the new version', async () => {
    const present = vi.fn().mockResolvedValue(undefined);
    alertControllerMock.create.mockResolvedValueOnce({
      present,
      onDidDismiss: vi.fn().mockResolvedValue(undefined),
    });
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.0');
    pwaUpdateServiceMock.consumePendingReloadVersion.mockReturnValue('1.27.1');

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    expect(alertControllerMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        header: 'App Updated',
        message: 'Updated from v1.27.0 to v1.27.1.',
      })
    );
    expect(present).toHaveBeenCalledOnce();
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

  it('prompts to reload when a service worker update is ready', async () => {
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');
    const present = vi.fn().mockResolvedValue(undefined);
    alertControllerMock.create.mockResolvedValueOnce({
      present,
      onDidDismiss: vi.fn().mockResolvedValue(undefined),
    });

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    pwaUpdateServiceMock.updateReady.set({
      latestVersion: { hash: 'new-hash' },
    });
    await flushAsync();

    const updatePrompt: unknown = alertControllerMock.create.mock.calls[0]?.[0];
    expect(updatePrompt).toEqual(
      expect.objectContaining({
        header: 'Update Ready',
      })
    );
    expect(getAlertMessage(updatePrompt)).toContain('No local changes queued');
    expect(present).toHaveBeenCalledOnce();
  });

  it('flushes pending sync and reloads when the ready-update prompt is confirmed', async () => {
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');
    const present = vi.fn().mockResolvedValue(undefined);
    alertControllerMock.create.mockResolvedValueOnce({
      present,
      onDidDismiss: vi.fn().mockResolvedValue(undefined),
    });

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    pwaUpdateServiceMock.updateReady.set({
      latestVersion: { hash: 'new-hash' },
    });
    await flushAsync();

    const updatePrompt = alertControllerMock.create.mock.calls[0]?.[0] as unknown;
    const buttons = getPromptButtons(updatePrompt);
    await buttons[1]?.handler?.();
    await flushAsync();

    expect(gameSyncServiceMock.flushPendingSyncForReload).toHaveBeenCalledOnce();
    expect(pwaUpdateServiceMock.markPendingReloadVersion).toHaveBeenCalledWith('1.27.1');
    expect(pwaUpdateServiceMock.reload).toHaveBeenCalledOnce();
  });

  it('warns before reloading when local sync work is still pending', async () => {
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');
    gameSyncServiceMock.getReloadSummary.mockResolvedValue({
      connectivity: 'degraded',
      isSyncInFlight: true,
      pendingOutboxCount: 3,
      lastSyncAt: '2026-03-30T17:55:00.000Z',
    });
    const presentAlert = vi.fn().mockResolvedValue(undefined);
    const presentToast = vi.fn().mockResolvedValue(undefined);
    alertControllerMock.create.mockResolvedValueOnce({
      present: presentAlert,
      onDidDismiss: vi.fn().mockResolvedValue(undefined),
    });
    toastControllerMock.create.mockResolvedValueOnce({
      present: presentToast,
    });
    gameSyncServiceMock.flushPendingSyncForReload.mockResolvedValue(false);

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    pwaUpdateServiceMock.updateReady.set({
      latestVersion: { hash: 'new-hash' },
    });
    await flushAsync();

    const updatePrompt: unknown = alertControllerMock.create.mock.calls[0]?.[0];
    expect(getAlertMessage(updatePrompt)).toContain('Sync is running now');
    expect(getAlertMessage(updatePrompt)).toContain('3 local changes queued');
    expect(getAlertMessage(updatePrompt)).toContain('server connection degraded');
    expect(getAlertMessage(updatePrompt)).toContain('Reload will try to finish queued sync first.');

    const buttons = getPromptButtons(updatePrompt);
    await buttons[1]?.handler?.();
    await flushAsync();

    expect(toastControllerMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Some local changes are still queued. They will resume syncing after the app reloads.',
        color: 'warning',
      })
    );
    expect(presentToast).toHaveBeenCalledOnce();
    expect(pwaUpdateServiceMock.reload).toHaveBeenCalledOnce();
  });

  it('includes offline sync status in the ready-update prompt', async () => {
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');
    gameSyncServiceMock.getReloadSummary.mockResolvedValue({
      connectivity: 'offline',
      isSyncInFlight: false,
      pendingOutboxCount: 0,
      lastSyncAt: 'not-a-real-timestamp',
    });
    alertControllerMock.create.mockResolvedValueOnce({
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn().mockResolvedValue(undefined),
    });

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    pwaUpdateServiceMock.updateReady.set({
      latestVersion: { hash: 'new-hash' },
    });
    await flushAsync();

    const updatePrompt: unknown = alertControllerMock.create.mock.calls[0]?.[0];
    expect(getAlertMessage(updatePrompt)).toContain('currently offline');
    expect(getAlertMessage(updatePrompt)).toContain('last synced recently');
    expect(getAlertMessage(updatePrompt)).toContain('Reload should be quick.');
  });

  it('presents a reload-required alert for unrecoverable service worker state', async () => {
    localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, '1.27.1');
    const present = vi.fn().mockResolvedValue(undefined);
    alertControllerMock.create.mockResolvedValueOnce({
      present,
      onDidDismiss: vi.fn().mockResolvedValue(undefined),
    });

    TestBed.runInInjectionContext(() => new AppComponent());
    await flushAsync();

    pwaUpdateServiceMock.unrecoverableState.set({
      reason: 'hash mismatch',
    });
    await flushAsync();

    const reloadPrompt = alertControllerMock.create.mock.calls[0]?.[0] as unknown;
    expect(reloadPrompt).toEqual(
      expect.objectContaining({
        header: 'Reload Required',
      })
    );

    const buttons = getPromptButtons(reloadPrompt);
    await buttons[0]?.handler?.();

    expect(pwaUpdateServiceMock.reload).toHaveBeenCalledOnce();
    expect(present).toHaveBeenCalledOnce();
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
});
