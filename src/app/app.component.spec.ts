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
import { ThemeService } from './core/services/theme.service';
import { GameSyncService } from './core/services/game-sync.service';
import { DebugLogService } from './core/services/debug-log.service';
import { GameShelfService } from './core/services/game-shelf.service';
import { NotificationService } from './core/services/notification.service';
import { E2eFixtureService } from './core/services/e2e-fixture.service';

describe('AppComponent', () => {
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
    themeServiceMock.initialize.mockReturnValue(undefined);
    gameSyncServiceMock.initialize.mockReturnValue(undefined);
    debugLogServiceMock.initialize.mockReturnValue(undefined);
    gameShelfServiceMock.migratePreferredPlatformCoversToIgdb.mockResolvedValue(undefined);
    gameShelfServiceMock.migrateLegacyPickerCoversToCustomCovers.mockResolvedValue(undefined);
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
});
