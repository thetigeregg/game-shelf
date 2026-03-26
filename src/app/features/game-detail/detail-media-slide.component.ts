import { Component, Input } from '@angular/core';
import {
  getDetailMediaPlaceholderSrc,
  toDetailMediaBackdropUrl,
  toDetailMediaRenderUrl,
} from './detail-media-url.utils';

@Component({
  selector: 'app-detail-media-slide',
  templateUrl: './detail-media-slide.component.html',
  styleUrls: ['./detail-media-slide.component.scss'],
  standalone: true,
})
export class DetailMediaSlideComponent {
  private static readonly PLACEHOLDER_SRC = getDetailMediaPlaceholderSrc();
  private static readonly RETRY_DATASET_KEY = 'detailRetryAttempted';
  private rawSrc: string | null | undefined;
  private requestedImageSrc: string | null = null;
  private currentImageRequestSrc: string | null = null;
  private imageLoadSettled = false;
  @Input()
  set src(value: string | null | undefined) {
    this.rawSrc = value;
    this.syncRequestedImageSource();
  }

  get src(): string | null | undefined {
    return this.rawSrc;
  }

  @Input() alt = '';
  @Input() shouldLoad = true;
  @Input() showPreloader = false;

  get displaySrc(): string | null {
    if (!this.shouldLoad) {
      return null;
    }

    return toDetailMediaRenderUrl(this.src) ?? DetailMediaSlideComponent.PLACEHOLDER_SRC;
  }

  get displayBackdropSrc(): string | null {
    if (!this.shouldLoad) {
      return null;
    }

    const backdropSource = this.currentImageRequestSrc ?? this.displaySrc ?? this.src;
    return toDetailMediaBackdropUrl(backdropSource) ?? DetailMediaSlideComponent.PLACEHOLDER_SRC;
  }

  get displayBackdropStyle(): string | null {
    return this.displayBackdropSrc ? `url(${this.displayBackdropSrc})` : null;
  }

  get shouldShowPreloader(): boolean {
    const displaySrc = this.displaySrc;

    if (!this.showPreloader || !this.shouldLoad || !displaySrc) {
      return false;
    }

    this.syncRequestedImageSource(displaySrc);

    return !this.imageLoadSettled;
  }

  onImageLoad(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      target.dataset[DetailMediaSlideComponent.RETRY_DATASET_KEY] = '';
      this.currentImageRequestSrc = target.currentSrc || target.src || this.displaySrc;
      this.markImageSettled(target.currentSrc || target.src || this.displaySrc);
    }
  }

  onImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      const currentSrc = (target.currentSrc || target.src || '').trim();

      if (currentSrc.includes(DetailMediaSlideComponent.PLACEHOLDER_SRC)) {
        this.markImageSettled(currentSrc);
        return;
      }

      const hasRetried = target.dataset[DetailMediaSlideComponent.RETRY_DATASET_KEY] === '1';

      if (!hasRetried) {
        target.dataset[DetailMediaSlideComponent.RETRY_DATASET_KEY] = '1';
        const retrySrc = this.buildRetryImageSrc(currentSrc);

        if (retrySrc) {
          this.currentImageRequestSrc = retrySrc;
          this.markImagePending(retrySrc);
          target.src = retrySrc;
          return;
        }
      }

      this.currentImageRequestSrc = DetailMediaSlideComponent.PLACEHOLDER_SRC;
      target.src = DetailMediaSlideComponent.PLACEHOLDER_SRC;
      this.markImageSettled(DetailMediaSlideComponent.PLACEHOLDER_SRC);
    }
  }

  private buildRetryImageSrc(source: string): string | null {
    const normalized = source.trim();

    if (!normalized || normalized.startsWith('data:image/')) {
      return null;
    }

    if (normalized.startsWith('blob:')) {
      return normalized;
    }

    try {
      const parsed = new URL(normalized, window.location.origin);
      parsed.searchParams.set('_img_retry', Date.now().toString());
      return parsed.toString();
    } catch {
      return normalized;
    }
  }

  private markImagePending(source: string | null | undefined): void {
    const normalized = this.normalizeComparableSrc(source);

    if (!normalized) {
      return;
    }

    this.imageLoadSettled = false;
  }

  private markImageSettled(source: string | null | undefined): void {
    const normalized = this.normalizeComparableSrc(source);

    if (!normalized) {
      return;
    }

    this.imageLoadSettled = true;
  }

  private syncRequestedImageSource(displaySrc = this.displaySrc): void {
    const normalizedDisplaySrc = this.normalizeComparableSrc(displaySrc);

    if (this.requestedImageSrc === normalizedDisplaySrc) {
      return;
    }

    this.requestedImageSrc = normalizedDisplaySrc;
    this.currentImageRequestSrc = displaySrc;
    this.imageLoadSettled = false;
  }

  private normalizeComparableSrc(source: string | null | undefined): string | null {
    const normalized = typeof source === 'string' ? source.trim() : '';

    if (!normalized) {
      return null;
    }

    try {
      return new URL(normalized, window.location.origin).toString();
    } catch {
      return normalized;
    }
  }
}
