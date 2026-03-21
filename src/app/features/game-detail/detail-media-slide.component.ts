import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-detail-media-slide',
  templateUrl: './detail-media-slide.component.html',
  styleUrls: ['./detail-media-slide.component.scss'],
  standalone: true,
})
export class DetailMediaSlideComponent {
  private static readonly PLACEHOLDER_SRC = 'assets/icon/placeholder.png';
  private static readonly RETRY_DATASET_KEY = 'detailRetryAttempted';
  private static readonly IGDB_SCREENSHOT_SIZE_PATTERN =
    /(\/igdb\/image\/upload\/)t_screenshot_(?:med|big|huge)(?:_2x)?\//;
  @Input() src: string | null | undefined;
  @Input() alt = '';
  @Input() loading: 'eager' | 'lazy' = 'eager';
  @Input() showPreloader = false;

  get displaySrc(): string {
    const value = typeof this.src === 'string' ? this.src.trim() : '';
    return value.length > 0 ? value : DetailMediaSlideComponent.PLACEHOLDER_SRC;
  }

  get displayBackdropSrc(): string | null {
    return this.buildBackdropSrc(this.displaySrc);
  }

  onImageLoad(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      target.dataset[DetailMediaSlideComponent.RETRY_DATASET_KEY] = '';
    }
  }

  onImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      const currentSrc = (target.currentSrc || target.src || '').trim();

      if (currentSrc.includes(DetailMediaSlideComponent.PLACEHOLDER_SRC)) {
        return;
      }

      const hasRetried = target.dataset[DetailMediaSlideComponent.RETRY_DATASET_KEY] === '1';

      if (!hasRetried) {
        target.dataset[DetailMediaSlideComponent.RETRY_DATASET_KEY] = '1';
        const retrySrc = this.buildRetryImageSrc(currentSrc);

        if (retrySrc) {
          target.src = retrySrc;
          return;
        }
      }

      target.src = DetailMediaSlideComponent.PLACEHOLDER_SRC;
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

  private buildBackdropSrc(source: string): string {
    const normalized = source.trim();

    if (normalized.length === 0) {
      return DetailMediaSlideComponent.PLACEHOLDER_SRC;
    }

    if (DetailMediaSlideComponent.IGDB_SCREENSHOT_SIZE_PATTERN.test(normalized)) {
      return normalized.replace(
        DetailMediaSlideComponent.IGDB_SCREENSHOT_SIZE_PATTERN,
        '$1t_screenshot_med/'
      );
    }

    return normalized;
  }
}
