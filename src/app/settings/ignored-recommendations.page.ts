import { Component, inject } from '@angular/core';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { AsyncPipe } from '@angular/common';
import {
  RecommendationIgnoreService,
  RecommendationIgnoredEntry,
} from '../core/services/recommendation-ignore.service';

@Component({
  selector: 'app-ignored-recommendations-page',
  templateUrl: './ignored-recommendations.page.html',
  styleUrls: ['./ignored-recommendations.page.scss'],
  standalone: true,
  imports: [
    AsyncPipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonButton,
  ],
})
export class IgnoredRecommendationsPage {
  private readonly recommendationIgnoreService = inject(RecommendationIgnoreService);
  readonly ignoredEntries$ = this.recommendationIgnoreService.ignoredEntries$;

  trackByIgnoredId(_: number, entry: RecommendationIgnoredEntry): string {
    return entry.igdbGameId;
  }

  unignore(igdbGameId: string): void {
    this.recommendationIgnoreService.unignoreGame(igdbGameId);
  }
}
