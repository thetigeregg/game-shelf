import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { GAME_REPOSITORY } from './core/data/game-repository';
import { DexieGameRepository } from './core/data/dexie-game-repository';
import { GAME_SEARCH_API } from './core/api/game-search-api';
import { IgdbProxyService } from './core/api/igdb-proxy.service';

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, HttpClientModule, IonicModule.forRoot(), AppRoutingModule],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: GAME_REPOSITORY, useExisting: DexieGameRepository },
    { provide: GAME_SEARCH_API, useExisting: IgdbProxyService },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
