import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export const PRICE_PREFERENCE_STORAGE_KEY = 'game-shelf:price-preference-v1';

@Injectable({ providedIn: 'root' })
export class PricePreferenceService {
  private static readonly DEFAULT_PRICE_PREFERENCE = 10;
  private static readonly MIN_PRICE_PREFERENCE = 5;
  private static readonly MAX_PRICE_PREFERENCE = 100;
  private readonly preferenceSubject = new BehaviorSubject(this.loadFromStorage());
  readonly pricePreference$ = this.preferenceSubject.asObservable();

  getPricePreference(): number {
    return this.preferenceSubject.value;
  }

  setPricePreference(value: number): void {
    const normalized = this.normalize(value);
    this.preferenceSubject.next(normalized);

    try {
      localStorage.setItem(PRICE_PREFERENCE_STORAGE_KEY, String(normalized));
    } catch {
      // Ignore storage failures.
    }
  }

  refreshFromStorage(): void {
    this.preferenceSubject.next(this.loadFromStorage());
  }

  private loadFromStorage(): number {
    try {
      const raw = localStorage.getItem(PRICE_PREFERENCE_STORAGE_KEY);

      if (raw === null) {
        return PricePreferenceService.DEFAULT_PRICE_PREFERENCE;
      }

      const parsed = Number.parseInt(raw, 10);
      return this.normalize(parsed);
    } catch {
      return PricePreferenceService.DEFAULT_PRICE_PREFERENCE;
    }
  }

  private normalize(value: number): number {
    if (!Number.isFinite(value)) {
      return PricePreferenceService.DEFAULT_PRICE_PREFERENCE;
    }

    const rounded = Math.round(value);

    return Math.max(
      PricePreferenceService.MIN_PRICE_PREFERENCE,
      Math.min(rounded, PricePreferenceService.MAX_PRICE_PREFERENCE)
    );
  }
}
