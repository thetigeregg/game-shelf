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
import { PwaUpdateService } from './core/services/pwa-update.service';
import { VersionReadyEvent } from '@angular/service-worker';

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
  private readonly pwaUpdateService = inject(PwaUpdateService);
  readonly runtimeAvailabilityService = inject(RuntimeAvailabilityService);
  private connectionAlert:
    | (Awaited<ReturnType<AlertController['create']>> & {
        dismiss?: () => Promise<boolean>;
        onDidDismiss?: () => Promise<unknown>;
      })
    | null = null;
  private updateAlert:
    | (Awaited<ReturnType<AlertController['create']>> & {
        dismiss?: () => Promise<boolean>;
        onDidDismiss?: () => Promise<unknown>;
      })
    | null = null;
  private unrecoverableStateAlert:
    | (Awaited<ReturnType<AlertController['create']>> & {
        dismiss?: () => Promise<boolean>;
        onDidDismiss?: () => Promise<unknown>;
      })
    | null = null;

  constructor() {
    effect(() => {
      void this.syncConnectionAlert(this.runtimeAvailabilityService.status()).catch(
        this.logAsyncError('[app] sync_connection_alert_failed')
      );
    });

    effect(() => {
      void this.syncUpdateAlert(this.pwaUpdateService.updateReady()).catch(
        this.logAsyncError('[app] sync_update_alert_failed')
      );
    });

    effect(() => {
      void this.syncUnrecoverableStateAlert(this.pwaUpdateService.unrecoverableState()).catch(
        this.logAsyncError('[app] sync_unrecoverable_state_alert_failed')
      );
    });

    void this.initializeApp();
  }

  private async initializeApp(): Promise<void> {
    this.runtimeAvailabilityService.initialize();
    this.pwaUpdateService.initialize();
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
    const pendingReloadMarker = this.pwaUpdateService.peekPendingReloadMarker();

    if (currentVersion.source !== 'live' || currentVersion.isFallback) {
      return;
    }

    if (previousVersion === currentVersion.value) {
      return;
    }

    if (previousVersion !== null && pendingReloadMarker === null) {
      window.localStorage.setItem(LAST_SEEN_APP_VERSION_STORAGE_KEY, currentVersion.value);
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

    if (pendingReloadMarker !== null) {
      this.pwaUpdateService.clearPendingReloadMarker();
    }
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
      if (this.connectionAlert !== null) {
        return;
      }

      try {
        const alert = await this.alertController.create({
          header: 'Connection Unavailable',
          message:
            'Game Shelf cannot connect right now. Cached data is still available, but sync, search, manuals, and live metadata are currently unavailable.',
          backdropDismiss: false,
          buttons: ['OK'],
        });

        this.connectionAlert = alert;
        await alert.present();
        await alert.onDidDismiss();
      } finally {
        this.connectionAlert = null;
      }

      return;
    }

    if (this.connectionAlert === null) {
      return;
    }

    const activeConnectionAlert = this.connectionAlert;
    this.connectionAlert = null;
    if (typeof activeConnectionAlert.dismiss === 'function') {
      await activeConnectionAlert.dismiss();
    }
  }

  private async syncUpdateAlert(updateReady: VersionReadyEvent | null): Promise<void> {
    if (updateReady === null || this.updateAlert !== null) {
      return;
    }

    this.updateAlert = {} as Awaited<ReturnType<AlertController['create']>> & {
      dismiss?: () => Promise<boolean>;
      onDidDismiss?: () => Promise<unknown>;
    };

    try {
      let pendingUpdateReady: VersionReadyEvent | null = updateReady;

      while (pendingUpdateReady !== null) {
        const presentedReloadMarker = this.getReadyUpdateReloadMarker(pendingUpdateReady);
        const syncSummary = await this.gameSyncService.getReloadSummary().catch(() => ({
          connectivity: null,
          isSyncInFlight: false,
          pendingOutboxCount: 0,
          lastSyncAt: null,
        }));
        const readyVersionLabel = this.getReadyUpdateVersionLabel(pendingUpdateReady);
        const messageParts = [
          readyVersionLabel === null
            ? 'A new app version is ready to load.'
            : `Game Shelf v${readyVersionLabel} is ready to load.`,
          this.buildSyncReloadMessage(syncSummary),
        ];

        const alert = await this.alertController.create({
          header: 'Update Ready',
          message: messageParts.join(' '),
          backdropDismiss: false,
          buttons: [
            {
              text: 'Later',
              role: 'cancel',
            },
            {
              text: 'Reload',
              role: 'confirm',
              handler: () => {
                void this.reloadForReadyUpdate(presentedReloadMarker).catch(
                  this.logAsyncError('[app] ready_update_reload_failed')
                );
              },
            },
          ],
        });

        this.updateAlert = alert;
        await alert.present();
        if (typeof alert.onDidDismiss === 'function') {
          await alert.onDidDismiss();
        }

        const latestPendingUpdate = this.pwaUpdateService.updateReady();
        if (latestPendingUpdate === null) {
          pendingUpdateReady = null;
          continue;
        }

        const latestReloadMarker = this.getReadyUpdateReloadMarker(latestPendingUpdate);
        pendingUpdateReady =
          latestReloadMarker === presentedReloadMarker ? null : latestPendingUpdate;
      }
    } finally {
      this.updateAlert = null;
    }
  }

  private async syncUnrecoverableStateAlert(
    unrecoverableState: { reason: string } | null
  ): Promise<void> {
    if (unrecoverableState === null || this.unrecoverableStateAlert !== null) {
      return;
    }

    this.unrecoverableStateAlert = {} as Awaited<ReturnType<AlertController['create']>> & {
      dismiss?: () => Promise<boolean>;
      onDidDismiss?: () => Promise<unknown>;
    };

    try {
      const alert = await this.alertController.create({
        header: 'Reload Required',
        message:
          'The cached app is out of sync with the latest release and needs a full reload. Reload now to recover.',
        backdropDismiss: false,
        buttons: [
          {
            text: 'Reload',
            role: 'confirm',
            handler: () => {
              this.pwaUpdateService.reload();
            },
          },
        ],
      });

      this.unrecoverableStateAlert = alert;
      await alert.present();
      if (typeof alert.onDidDismiss === 'function') {
        await alert.onDidDismiss();
      }
    } finally {
      this.unrecoverableStateAlert = null;
    }
  }

  private async reloadForReadyUpdate(reloadMarker: string): Promise<void> {
    const syncFlushed = await this.gameSyncService.flushPendingSyncForReload().catch(() => false);

    if (!syncFlushed) {
      await this.presentNotificationToast(
        'Some local changes are still queued. They will resume syncing after the app reloads.',
        'warning'
      );
    }

    const reloadStarted = await this.pwaUpdateService.activateUpdateAndReload(reloadMarker);
    if (reloadStarted) {
      return;
    }

    await this.presentNotificationToast(
      'The update is still waiting to activate. Close other Game Shelf tabs and try reloading again.',
      'warning'
    );
  }

  private getReadyUpdateVersionLabel(updateReady: VersionReadyEvent): string | null {
    const appData = updateReady.latestVersion.appData;
    if (!appData || typeof appData !== 'object') {
      return null;
    }

    const candidateKeys = ['version', 'appVersion', 'label'];
    for (const key of candidateKeys) {
      const value = (appData as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
      if (typeof value === 'number') {
        return String(value);
      }
    }

    return null;
  }

  private getReadyUpdateReloadMarker(updateReady: VersionReadyEvent): string {
    if (updateReady.latestVersion.hash.trim().length > 0) {
      return updateReady.latestVersion.hash;
    }

    const readyVersionLabel = this.getReadyUpdateVersionLabel(updateReady);
    if (readyVersionLabel !== null) {
      return readyVersionLabel;
    }

    return getAppVersionInfo().value;
  }

  private buildSyncReloadMessage(summary: {
    connectivity: string | null;
    isSyncInFlight: boolean;
    pendingOutboxCount: number;
    lastSyncAt: string | null;
  }): string {
    const details: string[] = [];

    if (summary.isSyncInFlight) {
      details.push('Sync is running now');
    }

    if (summary.pendingOutboxCount > 0) {
      const noun = summary.pendingOutboxCount === 1 ? 'change' : 'changes';
      details.push(`${String(summary.pendingOutboxCount)} local ${noun} queued`);
    } else {
      details.push('No local changes queued');
    }

    if (summary.connectivity === 'offline') {
      details.push('currently offline');
    } else if (summary.connectivity === 'degraded') {
      details.push('server connection degraded');
    }

    if (summary.lastSyncAt) {
      details.push(`last synced ${this.formatSyncTimestamp(summary.lastSyncAt)}`);
    }

    const detailSentence = `${details.join(', ')}.`;
    if (summary.isSyncInFlight || summary.pendingOutboxCount > 0) {
      return `${detailSentence} Reload will try to finish queued sync first. If anything is still pending, it stays queued locally and resumes after reopening.`;
    }

    return `${detailSentence} Reload should be quick.`;
  }

  private formatSyncTimestamp(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return 'recently';
    }

    return parsed.toLocaleString();
  }

  private logAsyncError(message: string): (error: unknown) => void {
    return (error: unknown) => {
      console.error(message, error);
    };
  }
}
