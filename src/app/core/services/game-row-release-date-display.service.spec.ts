import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY,
  GameRowReleaseDateDisplayService,
  WISHLIST_RELEASE_DATE_DISPLAY_STORAGE_KEY,
} from './game-row-release-date-display.service';

describe('GameRowReleaseDateDisplayService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [GameRowReleaseDateDisplayService],
    });
  });

  it('defaults both list types to year when storage is empty', () => {
    const service = TestBed.inject(GameRowReleaseDateDisplayService);

    expect(service.getPreference('collection')).toBe('year');
    expect(service.getPreference('wishlist')).toBe('year');
  });

  it('persists and reloads collection and wishlist values independently', () => {
    const service = TestBed.inject(GameRowReleaseDateDisplayService);
    service.setPreference('collection', 'monthYear');
    service.setPreference('wishlist', 'fullDate');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [GameRowReleaseDateDisplayService],
    });

    const reloaded = TestBed.inject(GameRowReleaseDateDisplayService);
    expect(reloaded.getPreference('collection')).toBe('monthYear');
    expect(reloaded.getPreference('wishlist')).toBe('fullDate');
    expect(localStorage.getItem(COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY)).toBe('monthYear');
    expect(localStorage.getItem(WISHLIST_RELEASE_DATE_DISPLAY_STORAGE_KEY)).toBe('fullDate');
  });

  it('normalizes invalid stored values back to year', () => {
    localStorage.setItem(COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY, 'bad-value');
    localStorage.setItem(WISHLIST_RELEASE_DATE_DISPLAY_STORAGE_KEY, 'unknown');

    const service = TestBed.inject(GameRowReleaseDateDisplayService);
    expect(service.getPreference('collection')).toBe('year');
    expect(service.getPreference('wishlist')).toBe('year');
  });

  it('emits reactive updates for each list type', () => {
    const service = TestBed.inject(GameRowReleaseDateDisplayService);
    const collectionObserved: string[] = [];
    const wishlistObserved: string[] = [];

    const collectionSubscription = service
      .getPreference$('collection')
      .subscribe((value) => collectionObserved.push(value));
    const wishlistSubscription = service
      .getPreference$('wishlist')
      .subscribe((value) => wishlistObserved.push(value));

    service.setPreference('collection', 'monthYear');
    service.setPreference('wishlist', 'fullDate');

    expect(collectionObserved).toEqual(['year', 'monthYear']);
    expect(wishlistObserved).toEqual(['year', 'fullDate']);

    collectionSubscription.unsubscribe();
    wishlistSubscription.unsubscribe();
  });

  it('refreshes current value when storage changes externally', () => {
    const service = TestBed.inject(GameRowReleaseDateDisplayService);
    localStorage.setItem(COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY, 'monthYear');
    localStorage.setItem(WISHLIST_RELEASE_DATE_DISPLAY_STORAGE_KEY, 'fullDate');

    service.refreshFromStorage();

    expect(service.getPreference('collection')).toBe('monthYear');
    expect(service.getPreference('wishlist')).toBe('fullDate');
  });

  it('falls back to defaults when storage access throws', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    const service = TestBed.inject(GameRowReleaseDateDisplayService);
    expect(service.getPreference('collection')).toBe('year');
    expect(service.getPreference('wishlist')).toBe('year');

    getItemSpy.mockRestore();
  });

  it('tolerates storage write failures while keeping normalized in-memory values', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const service = TestBed.inject(GameRowReleaseDateDisplayService);

    service.setPreference('collection', 'monthYear');
    service.setPreference('wishlist', 'fullDate');

    expect(service.getPreference('collection')).toBe('monthYear');
    expect(service.getPreference('wishlist')).toBe('fullDate');

    setItemSpy.mockRestore();
  });
});
