import { Component, inject } from '@angular/core';
import { AlertController, IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { ThemeService } from './core/services/theme.service';
import { GameSyncService } from './core/services/game-sync.service';
import { DebugLogService } from './core/services/debug-log.service';
import { GameShelfService } from './core/services/game-shelf.service';
import { NotificationService } from './core/services/notification.service';
import { E2eFixtureService } from './core/services/e2e-fixture.service';
import { getAppVersion, isE2eFixturesEnabled } from './core/config/runtime-config';

const LAST_SEEN_APP_VERSION_STORAGE_KEY = 'game_shelf_last_seen_app_version';
@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: true,
  imports: [IonApp, IonRouterOutlet]
})
export class AppComponent {
  private readonly themeService = inject(ThemeService);
  private readonly gameSyncService = inject(GameSyncService);
  private readonly debugLogService = inject(DebugLogService);
  private readonly gameShelfService = inject(GameShelfService);
  private readonly e2eFixtureService = inject(E2eFixtureService);
  private readonly alertController = inject(AlertController);
  private readonly notificationService = inject(NotificationService);

  constructor() {
    void this.initializeApp();
  }

  private async initializeApp(): Promise<void> {
    if (isE2eFixturesEnabled()) {
      await this.e2eFixtureService.applyFixtureFromStorage();
    }
    this.debugLogService.initialize();
    this.themeService.initialize();
    this.gameSyncService.initialize();
    void this.initializeNotifications();
    void this.gameShelfService.migratePreferredPlatformCoversToIgdb();
    void this.presentVersionAlertIfNeeded();
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
          }
        },
        {
          text: 'Enable',
          role: 'confirm',
          handler: () => {
            void this.notificationService.enableReleaseNotifications();
          }
        }
      ]
    });

    await alert.present();
  }

  private async presentVersionAlertIfNeeded(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    const currentVersion = getAppVersion();
    const previousVersion = window.localStorage.getItem(LAST_SEEN_APP_VERSION_STORAGE_KEY);

    if (previousVersion === currentVersion) {
      return;
    }

    const message = previousVersion
      ? `Updated from v${previousVersion} to v${currentVersion}.`
      : `Welcome to Game Shelf v${currentVersion}.`;

    const alert = await this.alertController.create({
      header: 'App Updated',
      message,
      buttons: ['OK']
    });

    await alert.present();
    window.localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, currentVersion);
  }
}
