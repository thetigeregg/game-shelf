import { describe, expect, it, vi } from 'vitest';
import { SimilarGameRowComponent } from './similar-game-row.component';

vi.mock('@ionic/angular/standalone', () => {
  const Stub = () => null;
  return {
    IonBadge: Stub,
    IonItem: Stub,
    IonLabel: Stub
  };
});

describe('SimilarGameRowComponent', () => {
  it('uses input defaults and emits row click', () => {
    const component = new SimilarGameRowComponent();
    const emitSpy = vi.fn();
    component.rowClick.subscribe(emitSpy);

    component.rowClick.emit();

    expect(component.coverUrl).toBeNull();
    expect(component.headline).toBeNull();
    expect(component.badges).toEqual([]);
    expect(emitSpy).toHaveBeenCalledOnce();
  });

  it('falls back to placeholder image on error', () => {
    const component = new SimilarGameRowComponent();
    const img = document.createElement('img');
    component.onImageError({ target: img } as unknown as Event);
    expect(img.src).toContain('assets/icon/placeholder.png');
  });

  it('ignores image error events when target is not an image element', () => {
    const component = new SimilarGameRowComponent();
    const div = document.createElement('div');
    component.onImageError({ target: div } as unknown as Event);
    expect(div.tagName).toBe('DIV');
  });
});
