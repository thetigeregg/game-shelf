import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutModeService } from './layout-mode.service';

describe('LayoutModeService', () => {
  let mediaListeners: Map<string, EventListenerOrEventListenerObject>;
  let mediaQueryMatches: boolean;

  function dispatchMediaChange(matches: boolean): void {
    const handler = mediaListeners.get('change');
    if (typeof handler === 'function') {
      handler({ matches } as MediaQueryListEvent);
    }
  }

  beforeEach(() => {
    mediaListeners = new Map();
    mediaQueryMatches = false;

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        get matches() {
          return mediaQueryMatches;
        },
        addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
          mediaListeners.set(type, listener);
        }),
        removeEventListener: vi.fn()
      }))
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function createService(): LayoutModeService {
    TestBed.configureTestingModule({ providers: [LayoutModeService] });
    return TestBed.inject(LayoutModeService);
  }

  it('reports mobile when media query does not match desktop breakpoint', () => {
    mediaQueryMatches = false;
    const service = createService();
    expect(service.mode).toBe('mobile');
  });

  it('reports desktop when media query matches desktop breakpoint', () => {
    mediaQueryMatches = true;
    const service = createService();
    expect(service.mode).toBe('desktop');
  });

  it('mode$ emits current mode on subscription', async () => {
    mediaQueryMatches = false;
    const service = createService();
    const mode = await firstValueFrom(service.mode$);
    expect(mode).toBe('mobile');
  });

  it('updates mode to desktop when media query change fires with matches=true', async () => {
    mediaQueryMatches = false;
    const service = createService();

    dispatchMediaChange(true);

    const mode = await firstValueFrom(service.mode$);
    expect(mode).toBe('desktop');
    expect(service.mode).toBe('desktop');
  });

  it('updates mode to mobile when media query change fires with matches=false', async () => {
    mediaQueryMatches = true;
    const service = createService();

    dispatchMediaChange(false);

    const mode = await firstValueFrom(service.mode$);
    expect(mode).toBe('mobile');
    expect(service.mode).toBe('mobile');
  });

  describe('when matchMedia is unavailable (SSR / constrained environments)', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: undefined
      });
    });

    it('defaults to mobile without throwing', () => {
      const service = createService();
      expect(service.mode).toBe('mobile');
    });

    it('mode$ emits mobile', async () => {
      const service = createService();
      const mode = await firstValueFrom(service.mode$);
      expect(mode).toBe('mobile');
    });
  });
});
