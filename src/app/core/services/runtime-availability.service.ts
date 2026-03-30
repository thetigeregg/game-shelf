import { Injectable, signal } from '@angular/core';
import { setLiveRuntimeConfig } from '../config/runtime-config';

export type RuntimeAvailabilityStatus = 'checking' | 'online' | 'offline' | 'service-unreachable';

@Injectable({ providedIn: 'root' })
export class RuntimeAvailabilityService {
  private static readonly PROBE_INTERVAL_MS = 30_000;
  private initialized = false;
  private probeTimerId: number | null = null;

  readonly status = signal<RuntimeAvailabilityStatus>('checking');

  initialize(): void {
    if (this.initialized || typeof window === 'undefined') {
      return;
    }

    this.initialized = true;

    if (!navigator.onLine) {
      this.status.set('offline');
    } else if (window.__GAME_SHELF_RUNTIME_CONFIG__) {
      this.status.set('online');
    }

    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    window.addEventListener('focus', this.handleResumeLikeEvent);
    window.addEventListener('pageshow', this.handleResumeLikeEvent);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.probeTimerId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      void this.refresh();
    }, RuntimeAvailabilityService.PROBE_INTERVAL_MS);

    void this.refresh();
  }

  bannerMessage(): string | null {
    switch (this.status()) {
      case 'offline':
        return 'Offline. Cached library data is still available, but sync and live lookups are paused.';
      case 'service-unreachable':
        return 'Connection unavailable. Cached data is available, but sync, search, manuals, and live metadata are currently unavailable.';
      default:
        return null;
    }
  }

  async refresh(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    if (!navigator.onLine) {
      this.status.set('offline');
      return;
    }

    const probeSucceeded = await this.probeRuntimeConfig();
    this.status.set(probeSucceeded ? 'online' : 'service-unreachable');
  }

  private readonly handleOnline = () => {
    void this.refresh();
  };

  private readonly handleOffline = () => {
    this.status.set('offline');
  };

  private readonly handleResumeLikeEvent = () => {
    void this.refresh();
  };

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible') {
      return;
    }

    void this.refresh();
  };

  private async probeRuntimeConfig(): Promise<boolean> {
    try {
      const response = await fetch(this.buildProbeUrl(), {
        cache: 'no-store',
        credentials: 'same-origin',
      });

      if (!response.ok) {
        return false;
      }

      const script = await response.text();
      const parsedConfig = this.parseRuntimeConfigScript(script);

      if (parsedConfig !== null) {
        setLiveRuntimeConfig(parsedConfig);
      }

      return true;
    } catch {
      return false;
    }
  }

  private buildProbeUrl(): string {
    const url = new URL('/assets/runtime-config.js', window.location.origin);
    url.searchParams.set('ts', String(Date.now()));
    return url.toString();
  }

  private parseRuntimeConfigScript(script: string): unknown {
    if (script.trim().length === 0) {
      return null;
    }

    const appVersion = this.matchLastString(script, 'appVersion');
    const firebaseCdnVersion = this.matchLastString(script, 'firebaseCdnVersion');
    const firebaseVapidKey = this.matchLastString(script, 'firebaseVapidKey');
    const showMgcImport = this.matchLastBoolean(script, 'showMgcImport');
    const e2eFixtures = this.matchLastBoolean(script, 'e2eFixtures');
    const recommendationsExploreEnabled = this.matchLastBoolean(
      script,
      'recommendationsExploreEnabled'
    );
    const tasEnabled = this.matchLastBoolean(script, 'tasEnabled');
    const firebase = {
      apiKey: this.matchLastString(script, 'apiKey'),
      authDomain: this.matchLastString(script, 'authDomain'),
      projectId: this.matchLastString(script, 'projectId'),
      storageBucket: this.matchLastString(script, 'storageBucket'),
      messagingSenderId: this.matchLastString(script, 'messagingSenderId'),
      appId: this.matchLastString(script, 'appId'),
    };

    if (
      appVersion === null &&
      firebaseCdnVersion === null &&
      firebaseVapidKey === null &&
      Object.values(firebase).every((value) => value === null) &&
      showMgcImport === null &&
      e2eFixtures === null &&
      recommendationsExploreEnabled === null &&
      tasEnabled === null
    ) {
      return null;
    }

    return {
      ...(appVersion !== null ? { appVersion } : {}),
      ...(firebaseCdnVersion !== null ? { firebaseCdnVersion } : {}),
      ...(firebaseVapidKey !== null ? { firebaseVapidKey } : {}),
      ...(Object.values(firebase).some((value) => value !== null)
        ? {
            firebase: {
              ...(firebase.apiKey !== null ? { apiKey: firebase.apiKey } : {}),
              ...(firebase.authDomain !== null ? { authDomain: firebase.authDomain } : {}),
              ...(firebase.projectId !== null ? { projectId: firebase.projectId } : {}),
              ...(firebase.storageBucket !== null ? { storageBucket: firebase.storageBucket } : {}),
              ...(firebase.messagingSenderId !== null
                ? { messagingSenderId: firebase.messagingSenderId }
                : {}),
              ...(firebase.appId !== null ? { appId: firebase.appId } : {}),
            },
          }
        : {}),
      ...(showMgcImport !== null ||
      e2eFixtures !== null ||
      recommendationsExploreEnabled !== null ||
      tasEnabled !== null
        ? {
            featureFlags: {
              ...(showMgcImport !== null ? { showMgcImport } : {}),
              ...(e2eFixtures !== null ? { e2eFixtures } : {}),
              ...(recommendationsExploreEnabled !== null ? { recommendationsExploreEnabled } : {}),
              ...(tasEnabled !== null ? { tasEnabled } : {}),
            },
          }
        : {}),
    };
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private matchLastString(script: string, key: string): string | null {
    const escapedKey = this.escapeRegExp(key);
    const pattern = new RegExp(
      `["']?${escapedKey}["']?\\s*:\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`,
      'g'
    );
    let lastValue: string | null = null;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(script)) !== null) {
      try {
        lastValue = JSON.parse(`"${match[2]}"`) as string;
      } catch {
        lastValue = match[2];
      }
    }

    return lastValue;
  }

  private matchLastBoolean(script: string, key: string): boolean | null {
    const escapedKey = this.escapeRegExp(key);
    const pattern = new RegExp(`["']?${escapedKey}["']?\\s*:\\s*(true|false)`, 'g');
    let lastValue: boolean | null = null;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(script)) !== null) {
      lastValue = match[1] === 'true';
    }

    return lastValue;
  }
}
