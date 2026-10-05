import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMillisecondsUntilNextUtcDay, watchUtcDayChanges } from './utc-day-change';

describe('utc-day-change', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes the delay until the next UTC midnight', () => {
    expect(getMillisecondsUntilNextUtcDay(new Date('2026-06-15T23:59:59.000Z'))).toBe(1000);
    expect(getMillisecondsUntilNextUtcDay(new Date('2026-06-15T00:00:00.000Z'))).toBe(
      24 * 60 * 60 * 1000
    );
  });

  it('emits at every UTC day rollover and not before', () => {
    vi.setSystemTime(new Date('2026-06-15T23:00:00.000Z'));
    const onDayChange = vi.fn();
    const subscription = watchUtcDayChanges().subscribe(onDayChange);

    vi.advanceTimersByTime(60 * 60 * 1000 - 1);
    expect(onDayChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onDayChange).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(onDayChange).toHaveBeenCalledTimes(2);

    subscription.unsubscribe();
  });

  it('clears the pending timer on unsubscribe', () => {
    vi.setSystemTime(new Date('2026-06-15T23:00:00.000Z'));
    const onDayChange = vi.fn();
    const subscription = watchUtcDayChanges().subscribe(onDayChange);

    subscription.unsubscribe();

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);
    expect(onDayChange).not.toHaveBeenCalled();
  });
});
