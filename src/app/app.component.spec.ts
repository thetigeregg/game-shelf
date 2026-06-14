import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { AppComponent } from './app.component';
import { LiveUpdateService } from './core/services/live-update.service';
import { NetworkConnectivityService } from './core/services/network-connectivity.service';
import { RuntimeAvailabilityService } from './core/services/runtime-availability.service';
import { ThemeService } from './core/services/theme.service';
import { GameSyncService } from './core/services/game-sync.service';
import { DebugLogService } from './core/services/debug-log.service';
import { GameShelfService } from './core/services/game-shelf.service';
import { NotificationService } from './core/services/notification.service';
import { PreferenceStorageService } from './core/storage/preference-storage.service';
import { E2eFixtureService } from './core/services/e2e-fixture.service';

const isNativePlatformMock = vi.fn<() => boolean>(() => false);
const splashScreenHideMock = vi.fn<() => Promise<void>>();

vi.mock('./core/utils/native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

vi.mock('@capacitor/splash-screen', () => ({
  SplashScreen: {
    hide: () => splashScreenHideMock(),
  },
}));

describe('AppComponent', () => {
  let liveUpdateService: { markReady: ReturnType<typeof vi.fn> };
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    liveUpdateService = {
      markReady: vi.fn().mockResolvedValue(undefined),
    };
    splashScreenHideMock.mockResolvedValue(undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ThemeService, useValue: { initialize: vi.fn() } },
        { provide: GameSyncService, useValue: { initialize: vi.fn() } },
        { provide: DebugLogService, useValue: { initialize: vi.fn() } },
        {
          provide: GameShelfService,
          useValue: {
            migratePreferredPlatformCoversToIgdb: vi.fn().mockResolvedValue(undefined),
            migrateLegacyPickerCoversToCustomCovers: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            initialize: vi.fn().mockResolvedValue(undefined),
            shouldPromptForReleaseNotifications: vi.fn().mockResolvedValue(false),
          },
        },
        {
          provide: E2eFixtureService,
          useValue: {
            applyFixtureFromStorage: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: PreferenceStorageService,
          useValue: {
            getItem: vi.fn().mockReturnValue(null),
            setItem: vi.fn(),
          },
        },
        { provide: LiveUpdateService, useValue: liveUpdateService },
        { provide: RuntimeAvailabilityService, useValue: { initialize: vi.fn() } },
        { provide: NetworkConnectivityService, useValue: { initialize: vi.fn() } },
      ],
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('logs when live update readiness fails during startup', async () => {
    liveUpdateService.markReady.mockRejectedValueOnce(new Error('ready failed'));

    TestBed.runInInjectionContext(() => new AppComponent());

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[app] live_update_ready_failed',
        expect.any(Error)
      );
    });
  });
});
