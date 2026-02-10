import { RouteReuseStrategy, provideRouter, withPreloading, PreloadAllModules } from '@angular/router';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { GAME_REPOSITORY } from './app/core/data/game-repository';
import { DexieGameRepository } from './app/core/data/dexie-game-repository';
import { GAME_SEARCH_API } from './app/core/api/game-search-api';
import { IgdbProxyService } from './app/core/api/igdb-proxy.service';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes, withPreloading(PreloadAllModules)),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: GAME_REPOSITORY, useExisting: DexieGameRepository },
    { provide: GAME_SEARCH_API, useExisting: IgdbProxyService },
    provideIonicAngular(),
    provideHttpClient(withInterceptorsFromDi()),
  ],
}).catch(err => console.error(err));
