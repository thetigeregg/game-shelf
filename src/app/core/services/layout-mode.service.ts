import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, fromEventPattern } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';
import { DESKTOP_LAYOUT_MEDIA_QUERY, LayoutMode } from '../layout/layout-mode';

@Injectable({
  providedIn: 'root'
})
export class LayoutModeService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly modeSubject = new BehaviorSubject<LayoutMode>(this.detectMode());

  readonly mode$ = this.modeSubject.asObservable().pipe(distinctUntilChanged());

  constructor() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQueryList = window.matchMedia(DESKTOP_LAYOUT_MEDIA_QUERY);
    this.modeSubject.next(mediaQueryList.matches ? 'desktop' : 'mobile');

    fromEventPattern<MediaQueryListEvent>(
      (handler) => {
        mediaQueryList.addEventListener('change', handler);
      },
      (handler) => {
        mediaQueryList.removeEventListener('change', handler);
      }
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        this.modeSubject.next(event.matches ? 'desktop' : 'mobile');
      });
  }

  get mode(): LayoutMode {
    return this.modeSubject.value;
  }

  private detectMode(): LayoutMode {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return 'mobile';
    }

    return window.matchMedia(DESKTOP_LAYOUT_MEDIA_QUERY).matches ? 'desktop' : 'mobile';
  }
}
