import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export const TIME_PREFERENCE_STORAGE_KEY = 'game-shelf:time-preference-v1';

@Injectable({ providedIn: 'root' })
export class TimePreferenceService {
  private static readonly DEFAULT_TIME_PREFERENCE = 15;
  private static readonly MIN_TIME_PREFERENCE = 5;
  private static readonly MAX_TIME_PREFERENCE = 100;
  private readonly preferenceSubject = new BehaviorSubject<number>(this.loadFromStorage());
  readonly timePreference$ = this.preferenceSubject.asObservable();

  getTimePreference(): number {
    return this.preferenceSubject.value;
  }

  setTimePreference(value: number): void {
    const normalized = this.normalize(value);
    this.preferenceSubject.next(normalized);

    try {
      localStorage.setItem(TIME_PREFERENCE_STORAGE_KEY, String(normalized));
    } catch {
      // Ignore storage failures.
    }
  }

  refreshFromStorage(): void {
    this.preferenceSubject.next(this.loadFromStorage());
  }

  private loadFromStorage(): number {
    try {
      const raw = localStorage.getItem(TIME_PREFERENCE_STORAGE_KEY);

      if (raw === null) {
        return TimePreferenceService.DEFAULT_TIME_PREFERENCE;
      }

      const parsed = Number.parseInt(raw, 10);
      return this.normalize(parsed);
    } catch {
      return TimePreferenceService.DEFAULT_TIME_PREFERENCE;
    }
  }

  private normalize(value: number): number {
    if (!Number.isFinite(value)) {
      return TimePreferenceService.DEFAULT_TIME_PREFERENCE;
    }

    const rounded = Math.round(value);

    return Math.max(
      TimePreferenceService.MIN_TIME_PREFERENCE,
      Math.min(rounded, TimePreferenceService.MAX_TIME_PREFERENCE)
    );
  }
}
