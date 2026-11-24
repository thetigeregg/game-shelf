import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SIMILAR_STRIP_LOAD_MORE_THRESHOLD_PX,
  SimilarGamesStripComponent,
} from './similar-games-strip.component';

vi.mock('@ionic/angular', () => ({ IonSpinner: () => null }));

interface ScrollerMetrics {
  clientWidth: number;
  scrollWidth: number;
  scrollLeft: number;
}

function createStrip(metrics: ScrollerMetrics): {
  strip: SimilarGamesStripComponent;
  scroller: ScrollerMetrics;
  emitSpy: ReturnType<typeof vi.fn>;
} {
  const strip = TestBed.runInInjectionContext(() => new SimilarGamesStripComponent());
  const scroller = { ...metrics };
  (strip as unknown as { scroller: ElementRef<ScrollerMetrics> }).scroller = new ElementRef(
    scroller
  );
  const emitSpy = vi.fn();
  strip.loadMore.subscribe(emitSpy);
  return { strip, scroller, emitSpy };
}

describe('SimilarGamesStripComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for more once when scrolled near the end', () => {
    const { strip, scroller, emitSpy } = createStrip({
      clientWidth: 400,
      scrollWidth: 1200,
      scrollLeft: 0,
    });
    strip.canLoadMore = true;

    strip.onScroll();
    expect(emitSpy).not.toHaveBeenCalled();

    scroller.scrollLeft = 1200 - 400 - SIMILAR_STRIP_LOAD_MORE_THRESHOLD_PX;
    strip.onScroll();
    strip.onScroll();
    expect(emitSpy).toHaveBeenCalledOnce();
  });

  it('asks again after new items arrive', () => {
    const { strip, emitSpy } = createStrip({ clientWidth: 400, scrollWidth: 450, scrollLeft: 0 });
    strip.canLoadMore = true;

    strip.checkNearEnd();
    strip.checkNearEnd();
    expect(emitSpy).toHaveBeenCalledOnce();

    strip.itemCount = 10;
    strip.ngOnChanges();
    vi.runAllTimers();
    expect(emitSpy).toHaveBeenCalledTimes(2);
  });

  it('asks again after scrolling away from the end and back', () => {
    const { strip, scroller, emitSpy } = createStrip({
      clientWidth: 400,
      scrollWidth: 1200,
      scrollLeft: 800,
    });
    strip.canLoadMore = true;

    strip.onScroll();
    scroller.scrollLeft = 0;
    strip.onScroll();
    scroller.scrollLeft = 800;
    strip.onScroll();

    expect(emitSpy).toHaveBeenCalledTimes(2);
  });

  it('fills a row that does not overflow on the first check', () => {
    const { strip, emitSpy } = createStrip({ clientWidth: 700, scrollWidth: 700, scrollLeft: 0 });
    strip.canLoadMore = true;

    strip.ngOnChanges();
    vi.runAllTimers();

    expect(emitSpy).toHaveBeenCalledOnce();
  });

  it('waits while the parent is loading, then asks again once it finishes', () => {
    const { strip, emitSpy } = createStrip({ clientWidth: 400, scrollWidth: 400, scrollLeft: 0 });
    strip.canLoadMore = true;

    strip.checkNearEnd();
    expect(emitSpy).toHaveBeenCalledOnce();

    strip.loading = true;
    strip.ngOnChanges();
    vi.runAllTimers();
    expect(emitSpy).toHaveBeenCalledOnce();

    // The page added nothing visible: itemCount is unchanged, only loading ends.
    strip.loading = false;
    strip.ngOnChanges();
    vi.runAllTimers();
    expect(emitSpy).toHaveBeenCalledTimes(2);
  });

  it('listens for scroll outside the zone and stops on destroy', () => {
    const strip = TestBed.runInInjectionContext(() => new SimilarGamesStripComponent());
    const element = document.createElement('div');
    Object.defineProperties(element, {
      clientWidth: { value: 400 },
      scrollWidth: { value: 400 },
    });
    (strip as unknown as { scroller: ElementRef<HTMLDivElement> }).scroller = new ElementRef(
      element
    );
    const emitSpy = vi.fn();
    strip.loadMore.subscribe(emitSpy);
    strip.canLoadMore = true;
    strip.ngAfterViewInit();
    vi.runAllTimers();
    expect(emitSpy).toHaveBeenCalledOnce();

    const resetPending = (): void => {
      (strip as unknown as { loadMorePending: boolean }).loadMorePending = false;
    };
    resetPending();
    element.dispatchEvent(new Event('scroll'));
    expect(emitSpy).toHaveBeenCalledTimes(2);

    strip.ngOnDestroy();
    resetPending();
    element.dispatchEvent(new Event('scroll'));
    expect(emitSpy).toHaveBeenCalledTimes(2);
  });

  it('does nothing when there is nothing more to load', () => {
    const { strip, emitSpy } = createStrip({ clientWidth: 400, scrollWidth: 400, scrollLeft: 0 });
    strip.canLoadMore = false;

    strip.onScroll();

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('ignores a hidden row', () => {
    const { strip, emitSpy } = createStrip({ clientWidth: 0, scrollWidth: 0, scrollLeft: 0 });
    strip.canLoadMore = true;

    strip.onScroll();

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('cancels a pending check on destroy', () => {
    const { strip, emitSpy } = createStrip({ clientWidth: 400, scrollWidth: 400, scrollLeft: 0 });
    strip.canLoadMore = true;

    strip.ngOnChanges();
    strip.ngOnDestroy();
    vi.runAllTimers();

    expect(emitSpy).not.toHaveBeenCalled();
  });
});
