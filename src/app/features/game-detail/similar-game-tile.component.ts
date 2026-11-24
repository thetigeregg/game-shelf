import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-similar-game-tile',
  standalone: true,
  template: `
    <button type="button" class="similar-tile" (click)="tileClick.emit()">
      <span class="similar-tile-cover">
        <img
          class="similar-tile-image"
          [src]="coverUrl || 'assets/icon/placeholder.png'"
          alt=""
          loading="lazy"
          decoding="async"
          (error)="onImageError($event)"
        />
      </span>
      <span class="similar-tile-title">{{ title }}</span>
      <span class="similar-tile-subtitle" [attr.title]="subtitle">{{ subtitle }}</span>
    </button>
  `,
  host: { role: 'listitem' },
  styles: [
    `
      :host {
        flex: 0 0 auto;
        width: 108px;
        scroll-snap-align: start;
      }

      .similar-tile {
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 100%;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--ion-text-color);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .similar-tile-cover {
        display: block;
        width: 100%;
        aspect-ratio: 264 / 374;
        margin-bottom: 2px;
        border-radius: 8px;
        overflow: hidden;
        background: rgba(var(--ion-text-color-rgb, 0, 0, 0), 0.06);
      }

      .similar-tile-image {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .similar-tile-title {
        display: -webkit-box;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        font-size: 0.8125rem;
        font-weight: 600;
        line-height: 1.25;
      }

      .similar-tile-subtitle {
        overflow: hidden;
        color: var(--ion-color-medium);
        font-size: 0.75rem;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .similar-tile:focus-visible {
        outline: 2px solid var(--ion-color-primary);
        outline-offset: 2px;
        border-radius: 8px;
      }
    `,
  ],
})
export class SimilarGameTileComponent {
  @Input({ required: true }) title!: string;
  @Input({ required: true }) subtitle!: string;
  @Input() coverUrl: string | null = null;

  @Output() tileClick = new EventEmitter<void>();

  onImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      target.src = 'assets/icon/placeholder.png';
    }
  }
}
