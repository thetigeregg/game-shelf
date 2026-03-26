import { describe, expect, it, vi } from 'vitest';
import { DetailMediaSlideComponent } from './detail-media-slide.component';

describe('DetailMediaSlideComponent', () => {
  function createComponent(): DetailMediaSlideComponent {
    return new DetailMediaSlideComponent();
  }

  it('uses placeholder when src is blank and keeps valid src', () => {
    const component = createComponent();
    component.src = '   ';
    expect(component.displaySrc).toBe('assets/icon/placeholder.png');

    component.src = 'https://images.example.com/cover.jpg';
    expect(component.displaySrc).toBe('https://images.example.com/cover.jpg');
  });

  it('does not assign image urls until the slide is marked loadable', () => {
    const component = createComponent();
    component.src = 'https://images.igdb.com/igdb/image/upload/t_720p/hash.jpg';
    component.shouldLoad = false;

    expect(component.displaySrc).toBeNull();
    expect(component.displayBackdropSrc).toBeNull();
    expect(component.displayBackdropStyle).toBeNull();
  });

  it('routes IGDB screenshots through the proxy with retina detail assets', () => {
    const component = createComponent();
    component.src = 'https://images.igdb.com/igdb/image/upload/t_720p/hash.jpg';

    expect(component.displaySrc).toContain('/v1/images/proxy?url=');
    expect(component.displaySrc).toContain(encodeURIComponent('t_720p_2x/hash.jpg'));
  });

  it('derives a lower-resolution backdrop for IGDB screenshots and keeps other sources', () => {
    const component = createComponent();
    component.src = 'https://images.igdb.com/igdb/image/upload/t_720p/hash.jpg';
    expect(component.displayBackdropSrc).toContain('/v1/images/proxy?url=');
    expect(component.displayBackdropSrc).toContain(
      encodeURIComponent('https://images.igdb.com/igdb/image/upload/t_screenshot_med/hash.jpg')
    );

    component.src = 'https://images.igdb.com/igdb/image/upload/t_screenshot_big/hash.jpg';
    expect(component.displayBackdropSrc).toContain(
      encodeURIComponent('https://images.igdb.com/igdb/image/upload/t_screenshot_med/hash.jpg')
    );

    component.src = 'https://images.igdb.com/igdb/image/upload/t_screenshot_huge/hash.jpg';
    expect(component.displayBackdropSrc).toContain(
      encodeURIComponent('https://images.igdb.com/igdb/image/upload/t_screenshot_med/hash.jpg')
    );

    component.src = ' https://images.igdb.com/igdb/image/upload/t_screenshot_med_2x/hash.jpg ';
    expect(component.displayBackdropSrc).toContain(
      encodeURIComponent('https://images.igdb.com/igdb/image/upload/t_screenshot_med/hash.jpg')
    );

    component.src = 'https://images.igdb.com/igdb/image/upload/t_1080p/hash.jpg';
    expect(component.displayBackdropSrc).toContain(
      encodeURIComponent('https://images.igdb.com/igdb/image/upload/t_screenshot_med/hash.jpg')
    );

    component.src = 'https://images.example.com/backdrop.jpg';
    expect(component.displayBackdropSrc).toBe('https://images.example.com/backdrop.jpg');

    component.src = '   ';
    expect(component.displayBackdropSrc).toBe('assets/icon/placeholder.png');
  });

  it('updates the backdrop request when src changes without using the preloader flow', () => {
    const component = createComponent();

    component.src = 'https://images.igdb.com/igdb/image/upload/t_720p/first.jpg';
    const firstBackdropSrc = component.displayBackdropSrc;

    component.src = 'https://images.igdb.com/igdb/image/upload/t_720p/second.jpg';

    expect(component.showPreloader).toBe(false);
    expect(component.displayBackdropSrc).not.toBe(firstBackdropSrc);
    expect(component.displayBackdropSrc).toContain(
      encodeURIComponent('https://images.igdb.com/igdb/image/upload/t_screenshot_med/second.jpg')
    );
  });

  it('resets retry marker on successful image load', () => {
    const component = createComponent();
    const image = document.createElement('img');
    image.dataset.detailRetryAttempted = '1';

    component.onImageLoad({ target: image } as unknown as Event);

    expect(image.dataset.detailRetryAttempted).toBe('');
  });

  it('shows the preloader only until the current image source settles', () => {
    const component = createComponent();
    const firstSrc = 'https://images.example.com/cover.jpg';
    const nextSrc = 'https://images.example.com/cover-2.jpg';
    const image = document.createElement('img');
    let currentSrc = firstSrc;

    component.showPreloader = true;
    component.src = firstSrc;

    Object.defineProperty(image, 'currentSrc', {
      get: () => currentSrc,
      configurable: true,
    });

    expect(component.shouldShowPreloader).toBe(true);

    component.onImageLoad({ target: image } as unknown as Event);
    expect(component.shouldShowPreloader).toBe(false);

    component.src = nextSrc;
    expect(component.shouldShowPreloader).toBe(true);

    currentSrc = nextSrc;
    component.onImageLoad({ target: image } as unknown as Event);
    expect(component.shouldShowPreloader).toBe(false);
  });

  it('retries once with cache-busted URL, then falls back to placeholder', () => {
    const component = createComponent();
    const image = document.createElement('img');
    component.src = 'https://images.igdb.com/igdb/image/upload/t_720p/hash.jpg';
    Object.defineProperty(image, 'currentSrc', {
      value: 'https://example.com/cover.jpg',
      configurable: true,
    });

    component.onImageError({ target: image } as unknown as Event);
    expect(image.dataset.detailRetryAttempted).toBe('1');
    expect(image.src).toContain('https://example.com/cover.jpg');
    expect(image.src).toContain('_img_retry=');
    expect(component.displayBackdropSrc).toContain('_img_retry=');

    component.onImageError({ target: image } as unknown as Event);
    expect(image.src).toContain('assets/icon/placeholder.png');
  });

  it('keeps the preloader active through retry and clears it after terminal fallback', () => {
    const component = createComponent();
    const image = document.createElement('img');
    let currentSrc = 'https://example.com/cover.jpg';

    component.showPreloader = true;
    component.src = currentSrc;

    Object.defineProperty(image, 'currentSrc', {
      get: () => currentSrc,
      configurable: true,
    });

    expect(component.shouldShowPreloader).toBe(true);

    component.onImageError({ target: image } as unknown as Event);
    expect(image.dataset.detailRetryAttempted).toBe('1');
    expect(component.shouldShowPreloader).toBe(true);

    currentSrc = image.src;
    component.onImageError({ target: image } as unknown as Event);
    expect(image.src).toContain('assets/icon/placeholder.png');
    expect(component.shouldShowPreloader).toBe(false);
  });

  it('does not retry placeholder images and handles blob/data image paths', () => {
    const component = createComponent();

    const placeholder = document.createElement('img');
    Object.defineProperty(placeholder, 'currentSrc', {
      value: 'https://site/assets/icon/placeholder.png',
      configurable: true,
    });
    component.onImageError({ target: placeholder } as unknown as Event);
    expect(placeholder.dataset.detailRetryAttempted).toBeUndefined();

    const blobImage = document.createElement('img');
    Object.defineProperty(blobImage, 'currentSrc', { value: 'blob:abc', configurable: true });
    component.onImageError({ target: blobImage } as unknown as Event);
    expect(blobImage.src).toContain('blob:abc');

    const dataImage = document.createElement('img');
    Object.defineProperty(dataImage, 'currentSrc', {
      value: 'data:image/png;base64,AAA',
      configurable: true,
    });
    component.onImageError({ target: dataImage } as unknown as Event);
    expect(dataImage.src).toContain('assets/icon/placeholder.png');
  });

  it('handles invalid event targets without throwing', () => {
    const component = createComponent();
    const callLoad = () => {
      component.onImageLoad({ target: {} } as unknown as Event);
    };
    const callError = () => {
      component.onImageError({ target: {} } as unknown as Event);
    };
    expect(callLoad).not.toThrow();
    expect(callError).not.toThrow();
  });

  it('uses original string when URL parsing throws', () => {
    const component = createComponent();
    const image = document.createElement('img');
    Object.defineProperty(image, 'currentSrc', { value: '://bad-url', configurable: true });

    const originalUrl = globalThis.URL;
    const ThrowingUrl = function ThrowingUrl(): never {
      throw new Error('boom');
    } as unknown as typeof URL;
    vi.stubGlobal('URL', ThrowingUrl);

    component.onImageError({ target: image } as unknown as Event);
    expect(image.src).toContain('://bad-url');

    vi.stubGlobal('URL', originalUrl);
  });
});
