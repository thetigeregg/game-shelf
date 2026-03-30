import { Component, effect, inject } from '@angular/core';
import {
  AlertController,
  IonApp,
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
import {
  RuntimeAvailabilityService,
  RuntimeAvailabilityStatus,
} from './core/services/runtime-availability.service';

const LAST_SEEN_APP_VERSION_STORAGE_KEY = 'game_shelf_last_seen_app_version';
@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
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
  readonly runtimeAvailabilityService = inject(RuntimeAvailabilityService);
  private connectionAlertVisible = false;

  constructor() {
    effect(() => {
      void this.syncConnectionAlert(this.runtimeAvailabilityService.status());
    });

    void this.initializeApp();
  }

  private async initializeApp(): Promise<void> {
    this.runtimeAvailabilityService.initialize();
    if (isE2eFixturesEnabled()) {
      await this.e2eFixtureService.applyFixtureFromStorage();
    }
    this.debugLogService.initialize();
    this.themeService.initialize();
    this.gameSyncService.initialize();
    void this.runStartupCoverMigrations();
    await this.presentVersionAlertIfNeeded().catch((error: unknown) => {
      console.error('[app] version_alert_failed', error);
    });
    await this.initializeNotifications().catch((error: unknown) => {
      console.error('[app] notifications_init_failed', error);
    });
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
    const previousVersion = window.localStorage.getItem(LAST_SEEN_APP_VERSION_STORAGE_KEY);

    if (currentVersion.source !== 'live' || currentVersion.isFallback) {
      return;
    }

    if (previousVersion === currentVersion.value) {
      return;
    }

    const message = previousVersion
      ? `Updated from v${previousVersion} to v${currentVersion.value}.`
      : `Welcome to Game Shelf v${currentVersion.value}.`;

    const alert = await this.alertController.create({
      header: 'App Updated',
      message,
      buttons: ['OK'],
    });

    await alert.present();
    window.localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, currentVersion.value);
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

  private async syncConnectionAlert(status: RuntimeAvailabilityStatus): Promise<void> {
    if (status === 'service-unreachable') {
      if (this.connectionAlertVisible) {
        return;
      }

      this.connectionAlertVisible = true;

      try {
        const alert = await this.alertController.create({
          header: 'Connection Unavailable',
          message:
            'Game Shelf cannot connect right now. Cached data is still available, but sync, search, manuals, and live metadata are currently unavailable.',
          backdropDismiss: false,
          buttons: ['OK'],
        });

        await alert.present();
        await alert.onDidDismiss();
      } finally {
        this.connectionAlertVisible = false;
      }

      return;
    }

    if (!this.connectionAlertVisible) {
      return;
    }

    const topAlert = await this.alertController.getTop();
    if (!topAlert) {
      this.connectionAlertVisible = false;
      return;
    }

    if (typeof topAlert.dismiss === 'function') {
      await topAlert.dismiss();
    }
    this.connectionAlertVisible = false;
  }
}
