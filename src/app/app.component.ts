import { Component, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { ThemeService } from './core/services/theme.service';
import { GameSyncService } from './core/services/game-sync.service';

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

    constructor() {
        this.themeService.initialize();
        this.gameSyncService.initialize();
    }
}
