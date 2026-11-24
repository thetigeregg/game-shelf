import { describe, expect, it, vi } from 'vitest';
import { SimilarGameTileComponent } from './similar-game-tile.component';

describe('SimilarGameTileComponent', () => {
  it('uses input defaults and emits tile click', () => {
    const component = new SimilarGameTileComponent();
    const emitSpy = vi.fn();
    component.tileClick.subscribe(emitSpy);

    component.tileClick.emit();

    expect(component.coverUrl).toBeNull();
    expect(emitSpy).toHaveBeenCalledOnce();
  });

  it('labels the release year, or says it is unknown', () => {
    const component = new SimilarGameTileComponent();
    expect(component.releaseYearLabel).toBe('Unknown year');

    component.releaseYear = 2015;
    expect(component.releaseYearLabel).toBe('2015');
  });

  it('falls back to placeholder image on error', () => {
    const component = new SimilarGameTileComponent();
    const img = document.createElement('img');
    component.onImageError({ target: img } as unknown as Event);
    expect(img.src).toContain('assets/icon/placeholder.png');
  });

  it('ignores image error events when target is not an image element', () => {
    const component = new SimilarGameTileComponent();
    const div = document.createElement('div');
    component.onImageError({ target: div } as unknown as Event);
    expect(div.tagName).toBe('DIV');
  });
});
