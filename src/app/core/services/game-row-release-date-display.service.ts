import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { GameRowReleaseDateDisplay, ListType } from '../models/game.models';

export const COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY =
  'game-shelf:release-date-display:collection:v1';
export const WISHLIST_RELEASE_DATE_DISPLAY_STORAGE_KEY =
  'game-shelf:release-date-display:wishlist:v1';

@Injectable({ providedIn: 'root' })
export class GameRowReleaseDateDisplayService {
  private static readonly DEFAULT_DISPLAY: GameRowReleaseDateDisplay = 'year';

  private readonly collectionPreferenceSubject = new BehaviorSubject<GameRowReleaseDateDisplay>(
    this.loadFromStorage('collection')
  );
  private readonly wishlistPreferenceSubject = new BehaviorSubject<GameRowReleaseDateDisplay>(
    this.loadFromStorage('wishlist')
  );

  readonly collectionPreference$ = this.collectionPreferenceSubject.asObservable();
  readonly wishlistPreference$ = this.wishlistPreferenceSubject.asObservable();

  getPreference(listType: ListType): GameRowReleaseDateDisplay {
    return this.getSubject(listType).value;
  }

  getPreference$(listType: ListType): Observable<GameRowReleaseDateDisplay> {
    return listType === 'collection' ? this.collectionPreference$ : this.wishlistPreference$;
  }

  setPreference(listType: ListType, value: GameRowReleaseDateDisplay): void {
    const normalized = this.normalize(value);
    this.getSubject(listType).next(normalized);

    try {
      localStorage.setItem(this.getStorageKey(listType), normalized);
    } catch {
      // Ignore storage failures.
    }
  }

  refreshFromStorage(listType?: ListType): void {
    if (!listType || listType === 'collection') {
      this.collectionPreferenceSubject.next(this.loadFromStorage('collection'));
    }

    if (!listType || listType === 'wishlist') {
      this.wishlistPreferenceSubject.next(this.loadFromStorage('wishlist'));
    }
  }

  normalize(value: unknown): GameRowReleaseDateDisplay {
    return value === 'monthYear' || value === 'fullDate' || value === 'year'
      ? value
      : GameRowReleaseDateDisplayService.DEFAULT_DISPLAY;
  }

  private loadFromStorage(listType: ListType): GameRowReleaseDateDisplay {
    try {
      return this.normalize(localStorage.getItem(this.getStorageKey(listType)));
    } catch {
      return GameRowReleaseDateDisplayService.DEFAULT_DISPLAY;
    }
  }

  private getSubject(listType: ListType): BehaviorSubject<GameRowReleaseDateDisplay> {
    return listType === 'collection'
      ? this.collectionPreferenceSubject
      : this.wishlistPreferenceSubject;
  }

  private getStorageKey(listType: ListType): string {
    return listType === 'collection'
      ? COLLECTION_RELEASE_DATE_DISPLAY_STORAGE_KEY
      : WISHLIST_RELEASE_DATE_DISPLAY_STORAGE_KEY;
  }
}
