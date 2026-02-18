import { AfterViewInit, Directive, ElementRef, NgZone, OnDestroy, inject } from '@angular/core';

@Directive({
  selector: 'ion-content[appAutoContentOffsets]',
  standalone: true
})
export class AutoContentOffsetsDirective implements AfterViewInit, OnDestroy {
  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly ngZone = inject(NgZone);
  private resizeObserver?: ResizeObserver;
  private mutationObserver?: MutationObserver;
  private frameHandle: number | null = null;
  private readonly onWindowResize = () => this.scheduleRefresh();

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => {
      this.scheduleRefresh();
      window.addEventListener('resize', this.onWindowResize, { passive: true });

      const container = this.findContainer();
      const observedElements = [container, ...this.getDirectChildren(container, 'ION-HEADER')];
      const footerElements = this.getDirectChildren(container, 'ION-FOOTER');
      observedElements.push(...footerElements);

      this.resizeObserver = new ResizeObserver(() => this.scheduleRefresh());
      for (const element of observedElements) {
        this.resizeObserver.observe(element);
      }

      this.mutationObserver = new MutationObserver(() => this.scheduleRefresh());
      this.mutationObserver.observe(container, {
        childList: true,
        subtree: true,
        attributes: true
      });
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.onWindowResize);
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();

    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private scheduleRefresh(): void {
    if (this.frameHandle !== null) {
      return;
    }

    this.frameHandle = requestAnimationFrame(() => {
      this.frameHandle = null;
      this.refreshOffsets();
    });
  }

  private refreshOffsets(): void {
    const host = this.hostRef.nativeElement;
    const container = this.findContainer();
    const topOffset = this.sumHeights(this.getDirectChildren(container, 'ION-HEADER'));
    const bottomOffset = this.sumHeights(this.getDirectChildren(container, 'ION-FOOTER'));

    host.style.setProperty('--offset-top', `${topOffset}px`);
    host.style.setProperty('--offset-bottom', `${bottomOffset}px`);
  }

  private findContainer(): HTMLElement {
    const host = this.hostRef.nativeElement;
    let current: HTMLElement | null = host.parentElement;

    while (current) {
      const hasHeader = this.getDirectChildren(current, 'ION-HEADER').length > 0;
      const hasFooter = this.getDirectChildren(current, 'ION-FOOTER').length > 0;
      if (hasHeader || hasFooter) {
        return current;
      }

      current = current.parentElement;
    }

    return document.body;
  }

  private getDirectChildren(container: HTMLElement, tagName: string): HTMLElement[] {
    return Array.from(container.children).filter(
      (child): child is HTMLElement => child.tagName === tagName
    );
  }

  private sumHeights(elements: HTMLElement[]): number {
    return elements.reduce((sum, element) => sum + element.getBoundingClientRect().height, 0);
  }
}
