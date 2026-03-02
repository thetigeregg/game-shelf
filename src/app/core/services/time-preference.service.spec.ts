import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { TimePreferenceService, TIME_PREFERENCE_STORAGE_KEY } from './time-preference.service';

describe('TimePreferenceService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [TimePreferenceService]
    });
  });

  it('uses default time preference when storage is empty', () => {
    const service = TestBed.inject(TimePreferenceService);
    expect(service.getTimePreference()).toBe(15);
  });

  it('persists and reloads time preference from storage', () => {
    const service = TestBed.inject(TimePreferenceService);
    service.setTimePreference(42);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [TimePreferenceService]
    });

    const reloaded = TestBed.inject(TimePreferenceService);
    expect(reloaded.getTimePreference()).toBe(42);
    expect(localStorage.getItem(TIME_PREFERENCE_STORAGE_KEY)).toBe('42');
  });

  it('clamps out-of-range values and updates stream reactively', () => {
    const service = TestBed.inject(TimePreferenceService);
    const observed: number[] = [];
    const subscription = service.timePreference$.subscribe((value) => observed.push(value));

    service.setTimePreference(1);
    service.setTimePreference(200);

    expect(service.getTimePreference()).toBe(100);
    expect(observed).toEqual([15, 5, 100]);

    subscription.unsubscribe();
  });

  it('refreshes current value when storage changes externally', () => {
    const service = TestBed.inject(TimePreferenceService);
    localStorage.setItem(TIME_PREFERENCE_STORAGE_KEY, '33');

    service.refreshFromStorage();

    expect(service.getTimePreference()).toBe(33);
  });
});
