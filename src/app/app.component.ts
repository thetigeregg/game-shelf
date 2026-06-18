import { Component, inject } from '@angular/core';
import { SplashScreen } from '@capacitor/splash-screen';
import {
  AlertController,
  IonApp,
  IonProgressBar,
  IonRouterOutlet,
  ToastController,
} from '@ionic/angular/standalone';
import { ThemeService } from './core/services/theme.service';
import { GameSyncService } from './core/services/game-sync.service';
import { DebugLogService } from './core/services/debug-log.service';
import { GameShelfService } from './core/services/game-shelf.service';
import { NotificationService } from './core/services/notification.service';
import { E2eFixtureService } from './core/services/e2e-fixture.service';
import { getAppVersionInfo, isE2eFixturesEnabled } from './core/config/runtime-config';
import { RuntimeAvailabilityService } from './core/services/runtime-availability.service';
import { NetworkConnectivityService } from './core/services/network-connectivity.service';
import { isNativePlatform } from './core/utils/native-platform.util';
import { PreferenceStorageService } from './core/storage/preference-storage.service';
import { ClientWriteAuthService } from './core/services/client-write-auth.service';
import { LiveUpdateService } from './core/services/live-update.service';
import { SyncBootstrapProgressService } from './core/services/sync-bootstrap-progress.service';

const LAST_SEEN_APP_VERSION_STORAGE_KEY = 'game_shelf_last_seen_app_version';
const MIN_SPLASH_VISIBLE_MS = 300;

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: true,
  imports: [IonApp, IonRouterOutlet, IonProgressBar],
})
export class AppComponent {
  private readonly themeService = inject(ThemeService);
  private readonly gameSyncService = inject(GameSyncService);
  private readonly debugLogService = inject(DebugLogService);
  private readonly gameShelfService = inject(GameShelfService);
  private readonly e2eFixtureService = inject(E2eFixtureService);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);
  private readonly notificationService = inject(NotificationService);
  private readonly preferenceStorage = inject(PreferenceStorageService);
  private readonly liveUpdateService = inject(LiveUpdateService);
  readonly runtimeAvailabilityService = inject(RuntimeAvailabilityService);
  readonly syncBootstrapProgress = inject(SyncBootstrapProgressService);
  private readonly networkConnectivityService = inject(NetworkConnectivityService);
  private readonly clientWriteAuthService = inject(ClientWriteAuthService);
  private readonly appStartedAt = Date.now();

  constructor() {
    void this.initializeApp();
  }

  private async initializeApp(): Promise<void> {
    this.networkConnectivityService.initialize();
    this.runtimeAvailabilityService.initialize();
    if (isE2eFixturesEnabled()) {
      await this.e2eFixtureService.applyFixtureFromStorage();
    }
    this.debugLogService.initialize();
    this.themeService.initialize();
    await this.promptForWriteTokenIfNeeded().catch((error: unknown) => {
      console.error('[app] write_token_prompt_failed', error);
    });
    await this.gameSyncService.initialize();
    void this.runStartupCoverMigrations();
    await this.presentVersionAlertIfNeeded().catch((error: unknown) => {
      console.error('[app] version_alert_failed', error);
    });
    await this.liveUpdateService.markReady();
    await this.hideSplashScreenWhenReady().catch((error: unknown) => {
      console.error('[app] splash_screen_hide_failed', error);
    });
    await this.syncBootstrapProgress.waitUntilIdle();
    await this.initializeNotifications().catch((error: unknown) => {
      console.error('[app] notifications_init_failed', error);
    });
  }

  private async promptForWriteTokenIfNeeded(): Promise<void> {
    if (!isNativePlatform() || this.clientWriteAuthService.hasToken()) {
      return;
    }

    await SplashScreen.hide({ fadeOutDuration: 300 }).catch((error: unknown) => {
      console.error('[app] splash_screen_hide_failed', error);
    });

    const alert = await this.alertController.create({
      header: 'Server Access',
      message:
        'Enter your write token to sync your library. You can find this in your server settings.',
      backdropDismiss: false,
      inputs: [
        {
          name: 'token',
          type: 'password',
          placeholder: 'Write token',
        },
      ],
      buttons: [
        { text: 'Skip', role: 'cancel' },
        { text: 'Connect', role: 'confirm' },
      ],
    });

    await alert.present();
    const { role, data } = await alert.onDidDismiss<{ values?: { token?: unknown } }>();

    if (role !== 'confirm') {
      return;
    }

    const token = typeof data?.values?.token === 'string' ? data.values.token.trim() : '';

    if (token.length > 0) {
      this.clientWriteAuthService.setToken(token);
    }
  }

  private async hideSplashScreenWhenReady(): Promise<void> {
    if (!isNativePlatform()) {
      return;
    }

    const remainingVisibleMs = MIN_SPLASH_VISIBLE_MS - (Date.now() - this.appStartedAt);

    if (remainingVisibleMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, remainingVisibleMs);
      });
    }

    await SplashScreen.hide({ fadeOutDuration: 300 });
  }

  private async initializeNotifications(): Promise<void> {
    await this.notificationService.initialize();

    const shouldPrompt = await this.notificationService.shouldPromptForReleaseNotifications();

    if (!shouldPrompt) {
      return;
    }

    const alert = await this.alertController.create({
      header: 'Enable Release Notifications?',
      message: 'Get alerts when release dates are set, changed, removed, or when a game releases.',
      buttons: [
        {
          text: 'Not now',
          role: 'cancel',
          handler: () => {
            this.notificationService.setReleaseNotificationsEnabled(false);
          },
        },
        {
          text: 'Enable',
          role: 'confirm',
          handler: () => {
            void this.enableReleaseNotificationsFromPrompt();
          },
        },
      ],
    });

    await alert.present();
  }

  private async runStartupCoverMigrations(): Promise<void> {
    await this.gameShelfService.migratePreferredPlatformCoversToIgdb().catch(() => undefined);
    await this.gameShelfService.migrateLegacyPickerCoversToCustomCovers().catch(() => undefined);
  }

  private async presentVersionAlertIfNeeded(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    const currentVersion = getAppVersionInfo();
    const previousVersion = this.preferenceStorage.getItem(LAST_SEEN_APP_VERSION_STORAGE_KEY);

    if (currentVersion.source !== 'live' || currentVersion.isFallback) {
      return;
    }

    if (previousVersion === currentVersion.value) {
      return;
    }

    if (previousVersion !== null) {
      this.preferenceStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, currentVersion.value);
      return;
    }

    const alert = await this.alertController.create({
      header: 'App Updated',
      message: `Welcome to Game Shelf v${currentVersion.value}.`,
      buttons: ['OK'],
    });

    await alert.present();
    this.preferenceStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, currentVersion.value);
  }

  private async presentNotificationToast(
    message: string,
    color: 'primary' | 'warning'
  ): Promise<void> {
    const toast = await this.toastController.create({
      message,
      color,
      duration: 3500,
      position: 'bottom',
    });

    await toast.present();
  }

  private async enableReleaseNotificationsFromPrompt(): Promise<void> {
    const result = await this.notificationService.enableReleaseNotifications();
    await this.presentNotificationToast(result.message, result.ok ? 'primary' : 'warning');
  }
}
