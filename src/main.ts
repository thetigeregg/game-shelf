import {
  RouteReuseStrategy,
  provideRouter,
  withPreloading,
  PreloadAllModules
} from '@angular/router';
import { bootstrapApplication } from '@angular/platform-browser';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { GAME_REPOSITORY } from './app/core/data/game-repository';
import { DexieGameRepository } from './app/core/data/dexie-game-repository';
import { GAME_SEARCH_API } from './app/core/api/game-search-api';
import { IgdbProxyService } from './app/core/api/igdb-proxy.service';
import { SYNC_OUTBOX_WRITER } from './app/core/data/sync-outbox-writer';
import { GameSyncService } from './app/core/services/game-sync.service';
import { isDevMode, provideZoneChangeDetection } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { ClientWriteTokenInterceptor } from './app/core/api/client-write-token.interceptor';

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection(),
    provideRouter(routes, withPreloading(PreloadAllModules)),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: GAME_REPOSITORY, useExisting: DexieGameRepository },
    { provide: GAME_SEARCH_API, useExisting: IgdbProxyService },
    { provide: SYNC_OUTBOX_WRITER, useExisting: GameSyncService },
    { provide: HTTP_INTERCEPTORS, useClass: ClientWriteTokenInterceptor, multi: true },
    provideIonicAngular(),
    provideHttpClient(withInterceptorsFromDi()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
}).catch((err) => console.error(err));
