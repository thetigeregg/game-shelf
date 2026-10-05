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
