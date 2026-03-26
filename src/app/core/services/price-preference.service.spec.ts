import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PricePreferenceService, PRICE_PREFERENCE_STORAGE_KEY } from './price-preference.service';

describe('PricePreferenceService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [PricePreferenceService],
    });
  });

  it('uses default price preference when storage is empty', () => {
    const service = TestBed.inject(PricePreferenceService);
    expect(service.getPricePreference()).toBe(10);
  });

  it('persists and reloads price preference from storage', () => {
    const service = TestBed.inject(PricePreferenceService);
    service.setPricePreference(42);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [PricePreferenceService],
    });

    const reloaded = TestBed.inject(PricePreferenceService);
    expect(reloaded.getPricePreference()).toBe(42);
    expect(localStorage.getItem(PRICE_PREFERENCE_STORAGE_KEY)).toBe('42');
  });

  it('clamps out-of-range values and updates stream reactively', () => {
    const service = TestBed.inject(PricePreferenceService);
    const observed: number[] = [];
    const subscription = service.pricePreference$.subscribe((value) => observed.push(value));

    service.setPricePreference(1);
    service.setPricePreference(200);

    expect(service.getPricePreference()).toBe(100);
    expect(observed).toEqual([10, 5, 100]);

    subscription.unsubscribe();
  });

  it('refreshes current value when storage changes externally', () => {
    const service = TestBed.inject(PricePreferenceService);
    localStorage.setItem(PRICE_PREFERENCE_STORAGE_KEY, '33');

    service.refreshFromStorage();

    expect(service.getPricePreference()).toBe(33);
  });

  it('falls back to defaults when storage access throws', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    const service = TestBed.inject(PricePreferenceService);
    expect(service.getPricePreference()).toBe(10);

    getItemSpy.mockRestore();
  });
});
