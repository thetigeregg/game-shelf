import { Observable, defer, timer } from 'rxjs';
import { map, repeat } from 'rxjs/operators';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function getMillisecondsUntilNextUtcDay(now: Date = new Date()): number {
  return MILLISECONDS_PER_DAY - (now.getTime() % MILLISECONDS_PER_DAY);
}

/**
 * Emits each time the UTC calendar day rolls over. The delay is recomputed on
 * every cycle, so a timer that fires early or late (throttled or suspended tab)
 * re-aligns to the next UTC midnight. Unsubscribing clears the pending timer.
 */
export function watchUtcDayChanges(): Observable<void> {
  return defer(() => timer(getMillisecondsUntilNextUtcDay())).pipe(
    repeat(),
    map(() => undefined)
  );
}

export function getMillisecondsUntilNextLocalDay(now: Date = new Date()): number {
  const nextLocalMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  return nextLocalMidnight.getTime() - now.getTime();
}

/**
 * Emits each time the device's local calendar day rolls over. Like
 * {@link watchUtcDayChanges}, the delay is recomputed on every cycle.
 */
export function watchLocalDayChanges(): Observable<void> {
  return defer(() => timer(getMillisecondsUntilNextLocalDay())).pipe(
    repeat(),
    map(() => undefined)
  );
}
