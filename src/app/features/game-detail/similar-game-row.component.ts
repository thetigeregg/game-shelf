import { Component, EventEmitter, Input, Output } from '@angular/core';
import { IonBadge, IonItem, IonLabel } from '@ionic/angular/standalone';

export interface SimilarGameRowBadge {
  text: string;
  color: 'primary' | 'secondary' | 'tertiary' | 'success' | 'warning' | 'medium' | 'light';
}

@Component({
  selector: 'app-similar-game-row',
  standalone: true,
  imports: [IonItem, IonLabel, IonBadge],
  template: `
    <ion-item button detail="true" (click)="rowClick.emit()">
      <div slot="start" class="similar-cover">
        <img
          class="similar-cover-image"
          [src]="coverUrl || 'assets/icon/placeholder.png'"
          [alt]="title"
          loading="lazy"
          (error)="onImageError($event)"
        />
      </div>
      <ion-label class="similar-row-label">
        <h3>{{ title }}</h3>
        <p>{{ subtitle }}</p>
        @if (badges.length > 0) {
          <div class="similar-row-chips">
            @for (badge of badges; track badge.text) {
              <ion-badge [color]="badge.color">{{ badge.text }}</ion-badge>
            }
          </div>
        }
        @if (headlineLines.length > 0) {
          <div class="similar-row-headline">
            @for (line of headlineLines; track line) {
              <p><span aria-hidden="true">&bull;</span> {{ line }}</p>
            }
          </div>
        }
      </ion-label>
    </ion-item>
  `,
  styles: [
    `
      .similar-cover {
        width: 64px;
        height: 88px;
        border-radius: 6px;
        overflow: hidden;
        display: flex;
        align-items: flex-start;
        align-self: flex-start;
      }

      .similar-cover-image {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      .similar-row-label h3 {
        margin: 0;
      }

      .similar-row-label p {
        margin: 4px 0 0;
        color: var(--ion-color-medium);
      }

      .similar-row-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 8px;
      }

      .similar-row-headline {
        margin-top: 6px;
        font-size: 0.8rem;
      }

      .similar-row-headline p {
        margin: 0 0 4px;
      }
    `
  ]
})
export class SimilarGameRowComponent {
  @Input({ required: true }) title!: string;
  @Input({ required: true }) subtitle!: string;
  @Input() coverUrl: string | null = null;
  @Input() headline: string | null = null;
  @Input() badges: SimilarGameRowBadge[] = [];

  @Output() rowClick = new EventEmitter<void>();

  get headlineLines(): string[] {
    if (typeof this.headline !== 'string') {
      return [];
    }

    const normalized = this.headline.trim();
    if (normalized.length === 0) {
      return [];
    }

    const lines = normalized
      .split(/\s*[•;|]\s*/g)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return lines.length > 0 ? lines : [normalized];
  }

  onImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      target.src = 'assets/icon/placeholder.png';
    }
  }
}
