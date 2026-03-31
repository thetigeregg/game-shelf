import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { SwUpdate, UnrecoverableStateEvent, VersionReadyEvent } from '@angular/service-worker';
import { Subscription } from 'rxjs';
import { normalizeHttpError } from '../utils/normalize-http-error';

const PENDING_RELOAD_MARKER_STORAGE_KEY = 'game_shelf_pending_reload_app_version';

@Injectable({ providedIn: 'root' })
export class PwaUpdateService {
  private initialized = false;
  private readonly subscriptions = new Subscription();
  private readonly destroyRef = inject(DestroyRef);
  private readonly swUpdate = inject(SwUpdate);

  readonly updateReady = signal<VersionReadyEvent | null>(null);
  readonly unrecoverableState = signal<UnrecoverableStateEvent | null>(null);

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', this.handleResumeLikeEvent);
        window.removeEventListener('pageshow', this.handleResumeLikeEvent);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      }
      this.subscriptions.unsubscribe();
      this.initialized = false;
    });
  }

  initialize(): void {
    if (this.initialized || typeof window === 'undefined' || !this.swUpdate.isEnabled) {
      return;
    }

    this.initialized = true;

    this.subscriptions.add(
      this.swUpdate.versionUpdates.subscribe((event) => {
        if (event.type === 'VERSION_READY') {
          this.updateReady.set(event);
        }
      })
    );

    this.subscriptions.add(
      this.swUpdate.unrecoverable.subscribe((event) => {
        this.unrecoverableState.set(event);
      })
    );

    window.addEventListener('focus', this.handleResumeLikeEvent);
    window.addEventListener('pageshow', this.handleResumeLikeEvent);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    void this.checkForUpdate();
  }

  async checkForUpdate(): Promise<void> {
    if (!this.swUpdate.isEnabled) {
      return;
    }

    try {
      await this.swUpdate.checkForUpdate();
    } catch (error: unknown) {
      console.warn('[pwa-update] check_for_update_failed', normalizeHttpError(error));
    }
  }

  async activateUpdateAndReload(reloadMarker: string): Promise<boolean> {
    if (typeof window === 'undefined') {
      return false;
    }

    this.markPendingReloadMarker(reloadMarker);

    if (this.swUpdate.isEnabled) {
      try {
        const activated = await this.swUpdate.activateUpdate();
        if (!activated) {
          this.clearPendingReloadMarker();
          console.warn('[pwa-update] activate_update_skipped');
          return false;
        }
      } catch (error: unknown) {
        this.clearPendingReloadMarker();
        console.warn('[pwa-update] activate_update_failed', normalizeHttpError(error));
        return false;
      }
    }

    this.reload();
    return true;
  }

  markPendingReloadMarker(reloadMarker: string): void {
    if (typeof window === 'undefined' || reloadMarker.trim().length === 0) {
      return;
    }

    try {
      window.sessionStorage.setItem(PENDING_RELOAD_MARKER_STORAGE_KEY, reloadMarker);
    } catch {
      return;
    }
  }

  peekPendingReloadMarker(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      return window.sessionStorage.getItem(PENDING_RELOAD_MARKER_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  consumePendingReloadMarker(): string | null {
    const value = this.peekPendingReloadMarker();

    if (value === null) {
      return null;
    }

    this.clearPendingReloadMarker();
    return value;
  }

  clearPendingReloadMarker(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.sessionStorage.removeItem(PENDING_RELOAD_MARKER_STORAGE_KEY);
    } catch {
      return;
    }
  }

  reload(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.location.reload();
  }

  private readonly handleResumeLikeEvent = () => {
    void this.checkForUpdate();
  };

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible') {
      return;
    }

    void this.checkForUpdate();
  };
}
