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
      <span class="similar-tile-text">
        <span class="similar-tile-title">{{ title }}</span>
        <span class="similar-tile-meta">{{ releaseYearLabel }}</span>
        <span class="similar-tile-meta" [attr.title]="platform">{{ platform }}</span>
      </span>
    </button>
  `,
  host: { role: 'listitem' },
  styles: [
    `
      :host {
        display: flex;
        flex: 0 0 auto;
        width: 108px;
        scroll-snap-align: start;
      }

      /* Covers keep their own shape at a fixed width and are centred in a
         cover area as tall as the row's tallest cover. The text block has a
         fixed height, so titles line up across the row. */
      .similar-tile {
        display: flex;
        flex-direction: column;
        gap: 6px;
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
        display: flex;
        flex: 1 1 auto;
        align-items: center;
      }

      .similar-tile-image {
        display: block;
        width: 100%;
        height: auto;
        /* Cover-shaped until the image loads, then the image's own ratio. */
        aspect-ratio: auto 264 / 374;
        /* Matches the cover images in the detail carousel. */
        border-radius: 5px;
      }

      .similar-tile-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .similar-tile-title {
        display: -webkit-box;
        min-height: calc(2 * 1.25em);
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        font-size: 0.8125rem;
        font-weight: 600;
        line-height: 1.25;
      }

      .similar-tile-meta {
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
        border-radius: 5px;
      }
    `,
  ],
})
export class SimilarGameTileComponent {
  @Input({ required: true }) title!: string;
  @Input({ required: true }) platform!: string;
  @Input() releaseYear: number | null = null;
  @Input() coverUrl: string | null = null;

  @Output() tileClick = new EventEmitter<void>();

  get releaseYearLabel(): string {
    return Number.isInteger(this.releaseYear) ? String(this.releaseYear) : 'Unknown year';
  }

  onImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      target.src = 'assets/icon/placeholder.png';
    }
  }
}
