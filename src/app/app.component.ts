import { Component, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
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

    constructor() {
        this.debugLogService.initialize();
        this.themeService.initialize();
        this.gameSyncService.initialize();
        void this.notificationService.initialize();
        void this.gameShelfService.migratePreferredPlatformCoversToIgdb();
    }
}
