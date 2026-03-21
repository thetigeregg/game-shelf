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

  it('derives a lower-resolution backdrop for IGDB screenshots and keeps other sources', () => {
    const component = createComponent();
    component.src = 'https://images.igdb.com/igdb/image/upload/t_screenshot_huge/hash.jpg';
    expect(component.displayBackdropSrc).toBe(
      'https://images.igdb.com/igdb/image/upload/t_screenshot_med/hash.jpg'
    );

    component.src = 'https://images.example.com/backdrop.jpg';
    expect(component.displayBackdropSrc).toBe('https://images.example.com/backdrop.jpg');

    component.src = '   ';
    expect(component.displayBackdropSrc).toBe('assets/icon/placeholder.png');
  });

  it('resets retry marker on successful image load', () => {
    const component = createComponent();
    const image = document.createElement('img');
    image.dataset.detailRetryAttempted = '1';

    component.onImageLoad({ target: image } as unknown as Event);

    expect(image.dataset.detailRetryAttempted).toBe('');
  });

  it('retries once with cache-busted URL, then falls back to placeholder', () => {
    const component = createComponent();
    const image = document.createElement('img');
    Object.defineProperty(image, 'currentSrc', {
      value: 'https://example.com/cover.jpg',
      configurable: true,
    });

    component.onImageError({ target: image } as unknown as Event);
    expect(image.dataset.detailRetryAttempted).toBe('1');
    expect(image.src).toContain('https://example.com/cover.jpg');
    expect(image.src).toContain('_img_retry=');

    component.onImageError({ target: image } as unknown as Event);
    expect(image.src).toContain('assets/icon/placeholder.png');
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
