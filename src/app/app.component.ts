import { Component, inject } from '@angular/core';
import { AlertController, IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { ThemeService } from './core/services/theme.service';
import { GameSyncService } from './core/services/game-sync.service';
import { DebugLogService } from './core/services/debug-log.service';
import { GameShelfService } from './core/services/game-shelf.service';
import { NotificationService } from './core/services/notification.service';

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
    private readonly notificationService = inject(NotificationService);
    private readonly alertController = inject(AlertController);

    constructor() {
        this.debugLogService.initialize();
        this.themeService.initialize();
        this.gameSyncService.initialize();
        void this.initializeNotifications();
        void this.gameShelfService.migratePreferredPlatformCoversToIgdb();
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
                        void this.notificationService.enableReleaseNotifications();
                    },
                },
            ],
        });

        await alert.present();
    }
}
