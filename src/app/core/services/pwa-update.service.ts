import { Injectable, inject, signal } from '@angular/core';
import { SwUpdate, UnrecoverableStateEvent, VersionReadyEvent } from '@angular/service-worker';
import { normalizeHttpError } from '../utils/normalize-http-error';

const PENDING_RELOAD_APP_VERSION_STORAGE_KEY = 'game_shelf_pending_reload_app_version';

@Injectable({ providedIn: 'root' })
export class PwaUpdateService {
  private initialized = false;
  private readonly swUpdate = inject(SwUpdate);

  readonly updateReady = signal<VersionReadyEvent | null>(null);
  readonly unrecoverableState = signal<UnrecoverableStateEvent | null>(null);

  initialize(): void {
    if (this.initialized || typeof window === 'undefined' || !this.swUpdate.isEnabled) {
      return;
    }

    this.initialized = true;

    this.swUpdate.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY') {
        this.updateReady.set(event);
      }
    });

    this.swUpdate.unrecoverable.subscribe((event) => {
      this.unrecoverableState.set(event);
    });

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

  async activateUpdateAndReload(version: string): Promise<boolean> {
    if (typeof window === 'undefined') {
      return false;
    }

    this.markPendingReloadVersion(version);

    if (this.swUpdate.isEnabled) {
      try {
        const activated = await this.swUpdate.activateUpdate();
        if (!activated) {
          this.clearPendingReloadVersion();
          console.warn('[pwa-update] activate_update_skipped');
          return false;
        }
      } catch (error: unknown) {
        this.clearPendingReloadVersion();
        console.warn('[pwa-update] activate_update_failed', normalizeHttpError(error));
        return false;
      }
    }

    this.reload();
    return true;
  }

  markPendingReloadVersion(version: string): void {
    if (typeof window === 'undefined' || version.trim().length === 0) {
      return;
    }

    try {
      window.sessionStorage.setItem(PENDING_RELOAD_APP_VERSION_STORAGE_KEY, version);
    } catch {
      return;
    }
  }

  consumePendingReloadVersion(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }

    let value: string | null;
    try {
      value = window.sessionStorage.getItem(PENDING_RELOAD_APP_VERSION_STORAGE_KEY);
    } catch {
      return null;
    }

    if (value === null) {
      return null;
    }

    try {
      window.sessionStorage.removeItem(PENDING_RELOAD_APP_VERSION_STORAGE_KEY);
    } catch {
      return null;
    }

    return value;
  }

  private clearPendingReloadVersion(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.sessionStorage.removeItem(PENDING_RELOAD_APP_VERSION_STORAGE_KEY);
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
