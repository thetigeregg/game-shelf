import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  encodeCanvasAsDataUrl,
  getApproximateStringBytes,
  getCompressionOutputMimeType,
  loadImageFromDataUrl
} from './game-list-image-utils';

const RealImage = globalThis.Image;

class SuccessfulImage {
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;

  public set src(_: string) {
    this.onload?.();
  }
}

class FailingImage {
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;

  public set src(_: string) {
    this.onerror?.();
  }
}

afterEach(() => {
  globalThis.Image = RealImage;
});

describe('game-list-image-utils', () => {
  it('resolves image when load succeeds', async () => {
    globalThis.Image = SuccessfulImage as unknown as typeof Image;
    const result = await loadImageFromDataUrl('data:image/png;base64,abc');
    expect(result).not.toBeNull();
  });

  it('returns null when image load fails', async () => {
    globalThis.Image = FailingImage as unknown as typeof Image;
    const result = await loadImageFromDataUrl('data:image/png;base64,abc');
    expect(result).toBeNull();
  });

  it('accepts only valid image data urls from canvas encoding', () => {
    const canvas = {
      toDataURL: vi.fn<() => string>().mockReturnValue('data:image/webp;base64,abc123')
    } as unknown as HTMLCanvasElement;
    expect(encodeCanvasAsDataUrl(canvas, 'image/webp', 0.8)).toBe('data:image/webp;base64,abc123');

    const invalidCanvas = {
      toDataURL: vi.fn<() => string>().mockReturnValue('blob:https://example.com/x')
    } as unknown as HTMLCanvasElement;
    expect(encodeCanvasAsDataUrl(invalidCanvas, 'image/jpeg', 0.75)).toBeNull();
  });

  it('maps output mime type based on input type', () => {
    expect(getCompressionOutputMimeType('image/jpeg')).toBe('image/jpeg');
    expect(getCompressionOutputMimeType('image/jpg')).toBe('image/jpeg');
    expect(getCompressionOutputMimeType('image/png')).toBe('image/webp');
  });

  it('estimates string bytes by string length', () => {
    expect(getApproximateStringBytes('abc')).toBe(3);
    expect(getApproximateStringBytes('')).toBe(0);
  });
});
