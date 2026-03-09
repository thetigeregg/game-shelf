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
  IonToolbar
} from '@ionic/angular/standalone';
import { AsyncPipe } from '@angular/common';
import { RecommendationIgnoreService } from '../core/services/recommendation-ignore.service';

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
    IonButton
  ]
})
export class IgnoredRecommendationsPage {
  readonly ignoredEntries$ = this.recommendationIgnoreService.ignoredEntries$;

  private readonly recommendationIgnoreService = inject(RecommendationIgnoreService);

  trackByIgnoredId(_: number, entry: { igdbGameId: string }): string {
    return entry.igdbGameId;
  }

  unignore(igdbGameId: string): void {
    this.recommendationIgnoreService.unignoreGame(igdbGameId);
  }
}
