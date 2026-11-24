import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { IonSpinner } from '@ionic/angular';

/** How close to the right edge (px) the strip asks for the next page. */
export const SIMILAR_STRIP_LOAD_MORE_THRESHOLD_PX = 160;

/**
 * Sideways-scrolling row of similar-game tiles. Emits `loadMore` once the
 * end of the row is in reach (or already visible because the row does not
 * overflow yet). It asks again only after an input changes (`itemCount`,
 * `canLoadMore`, or `loading` ending) or after the user scrolls away from the
 * end and back, so a page that adds no visible items is followed up.
 */
@Component({
  selector: 'app-similar-games-strip',
  standalone: true,
  imports: [IonSpinner],
  template: `
    <div #scroller class="similar-strip" role="list">
      <ng-content />
      @if (canLoadMore) {
        <div class="similar-strip-more" aria-hidden="true">
          <ion-spinner name="crescent"></ion-spinner>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .similar-strip {
        display: flex;
        gap: 12px;
        padding: 12px 16px 16px;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        scroll-padding-inline: 16px;
        scroll-snap-type: x proximity;
        scrollbar-width: none;
      }

      .similar-strip::-webkit-scrollbar {
        display: none;
      }

      /* Mouse users get a thin scrollbar: there is no swipe to discover the overflow. */
      @media (hover: hover) and (pointer: fine) {
        .similar-strip {
          scrollbar-width: thin;
        }

        .similar-strip::-webkit-scrollbar {
          display: block;
          height: 6px;
        }

        .similar-strip::-webkit-scrollbar-thumb {
          border-radius: 3px;
          background: rgba(var(--ion-text-color-rgb, 0, 0, 0), 0.25);
        }
      }

      .similar-strip-more {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        width: 48px;
      }
    `,
  ],
})
export class SimilarGamesStripComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() canLoadMore = false;
  @Input() itemCount = 0;
  /** True while the parent fetches a page; no requests are made meanwhile. */
  @Input() loading = false;

  @Output() loadMore = new EventEmitter<void>();

  @ViewChild('scroller') private scroller?: ElementRef<HTMLDivElement>;

  private readonly ngZone = inject(NgZone);
  private loadMorePending = false;
  private checkRafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private removeScrollListener: (() => void) | null = null;
  private readonly scrollListener = (): void => {
    this.onScroll();
  };

  ngOnChanges(): void {
    this.loadMorePending = false;
    this.scheduleCheck();
  }

  ngAfterViewInit(): void {
    const element = this.scroller?.nativeElement;

    if (element) {
      // Outside the zone: a scroll only runs change detection when it emits.
      this.ngZone.runOutsideAngular(() => {
        element.addEventListener('scroll', this.scrollListener, { passive: true });
      });
      this.removeScrollListener = () => {
        element.removeEventListener('scroll', this.scrollListener);
      };
    }

    if (element && typeof ResizeObserver === 'function') {
      // Catches the row becoming visible (segment switch) or changing width.
      this.resizeObserver = new ResizeObserver(() => {
        this.scheduleCheck();
      });
      this.resizeObserver.observe(element);
    }

    this.scheduleCheck();
  }

  ngOnDestroy(): void {
    this.removeScrollListener?.();
    this.removeScrollListener = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.checkRafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.checkRafId);
    }
    this.checkRafId = null;
  }

  onScroll(): void {
    this.checkNearEnd();
  }

  checkNearEnd(): void {
    const element = this.scroller?.nativeElement;

    // A hidden row (clientWidth 0) would always look "at the end".
    if (!element || !this.canLoadMore || this.loading || element.clientWidth === 0) {
      return;
    }

    const remaining = element.scrollWidth - element.scrollLeft - element.clientWidth;

    if (remaining > SIMILAR_STRIP_LOAD_MORE_THRESHOLD_PX) {
      this.loadMorePending = false;
      return;
    }

    if (this.loadMorePending) {
      return;
    }

    this.loadMorePending = true;
    this.ngZone.run(() => {
      this.loadMore.emit();
    });
  }

  private scheduleCheck(): void {
    if (typeof requestAnimationFrame !== 'function') {
      return;
    }

    if (this.checkRafId !== null) {
      cancelAnimationFrame(this.checkRafId);
    }

    this.checkRafId = requestAnimationFrame(() => {
      this.checkRafId = null;
      this.checkNearEnd();
    });
  }
}
