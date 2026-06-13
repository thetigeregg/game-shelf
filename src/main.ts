import {
  RouteReuseStrategy,
  provideRouter,
  withPreloading,
  PreloadAllModules,
} from '@angular/router';
import { bootstrapApplication } from '@angular/platform-browser';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { GAME_REPOSITORY } from './app/core/data/game-repository';
import { LocalGameRepository } from './app/core/data/local-game-repository';
import { STORAGE_ENGINE } from './app/core/data/storage-engine';
import { StorageEngineFactory } from './app/core/data/storage-engine.factory';
import { GAME_SEARCH_API } from './app/core/api/game-search-api';
import { IgdbProxyService } from './app/core/api/igdb-proxy.service';
import { SYNC_OUTBOX_WRITER } from './app/core/data/sync-outbox-writer';
import { GameSyncService } from './app/core/services/game-sync.service';
import { inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { PreferenceStorageService } from './app/core/storage/preference-storage.service';
import { ClientWriteTokenInterceptor } from './app/core/api/client-write-token.interceptor';
import { register as registerSwiperElements } from 'swiper/element/bundle';

registerSwiperElements();

bootstrapApplication(AppComponent, {
  providers: [
    provideAppInitializer(() => {
      const storage = inject(PreferenceStorageService);
      const engineFactory = inject(StorageEngineFactory);
      return storage.initialize().then(() => engineFactory.initialize());
    }),
    provideZoneChangeDetection(),
    provideRouter(routes, withPreloading(PreloadAllModules)),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    {
      provide: STORAGE_ENGINE,
      useFactory: (engineFactory: StorageEngineFactory) => engineFactory.getEngine(),
      deps: [StorageEngineFactory],
    },
    { provide: GAME_REPOSITORY, useExisting: LocalGameRepository },
    { provide: GAME_SEARCH_API, useExisting: IgdbProxyService },
    { provide: SYNC_OUTBOX_WRITER, useExisting: GameSyncService },
    { provide: HTTP_INTERCEPTORS, useClass: ClientWriteTokenInterceptor, multi: true },
    provideIonicAngular({ mode: 'ios' }),
    provideHttpClient(withInterceptorsFromDi()),
  ],
}).catch((err: unknown) => {
  console.error(err);
});
