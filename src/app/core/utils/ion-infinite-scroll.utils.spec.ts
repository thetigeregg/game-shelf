import { describe, expect, it, vi } from 'vitest';
import { completeIonInfiniteScroll } from './ion-infinite-scroll.utils';

describe('completeIonInfiniteScroll', () => {
  it('completes when ion infinite target exposes complete()', async () => {
    const complete = vi.fn().mockResolvedValue(undefined);
    await completeIonInfiniteScroll({ target: { complete } } as unknown as Event);
    expect(complete).toHaveBeenCalledOnce();
  });

  it('no-ops when event target is missing complete()', async () => {
    await expect(completeIonInfiniteScroll({ target: {} } as unknown as Event)).resolves.toBe(
      undefined
    );
  });
});
