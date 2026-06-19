import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { setLiveRuntimeConfig } from '../config/runtime-config';
import { isNativePlatform } from '../utils/native-platform.util';
import { NetworkConnectivityService } from './network-connectivity.service';

export type RuntimeAvailabilityStatus = 'checking' | 'online' | 'offline' | 'service-unreachable';

export type RuntimeAvailabilityStatusListener = (status: RuntimeAvailabilityStatus) => void;

@Injectable({ providedIn: 'root' })
export class RuntimeAvailabilityService {
  private static readonly PROBE_INTERVAL_MS = 30_000;
  private initialized = false;
  private probeTimerId: number | null = null;
  private readonly statusListeners = new Set<RuntimeAvailabilityStatusListener>();

  readonly status = signal<RuntimeAvailabilityStatus>('checking');
  readonly bannerMessage = computed((): string | null => {
    switch (this.status()) {
      case 'offline':
        return 'Offline. Cached library data is still available, but sync and live lookups are paused.';
      case 'service-unreachable':
        return 'Connection unavailable. Cached data is available, but sync, search, manuals, and live metadata are currently unavailable.';
      default:
        return null;
    }
  });
  private readonly networkConnectivity = inject(NetworkConnectivityService);

  onStatusChange(listener: RuntimeAvailabilityStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  initialize(): void {
    if (this.initialized || typeof window === 'undefined') {
      return;
    }

    this.initialized = true;

    if (!this.networkConnectivity.isConnected()) {
      this.setStatus('offline');
    } else if (window.__GAME_SHELF_RUNTIME_CONFIG__) {
      this.setStatus('online');
    }

    this.networkConnectivity.onConnectedChange((connected) => {
      if (connected) {
        void this.refresh();
        return;
      }

      this.setStatus('offline');
    });

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

  async refresh(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    if (!this.networkConnectivity.isConnected()) {
      this.setStatus('offline');
      return;
    }

    const probeSucceeded = isNativePlatform()
      ? await this.probeApiHealth()
      : await this.probeRuntimeConfig();
    this.setStatus(probeSucceeded ? 'online' : 'service-unreachable');
  }

  private setStatus(status: RuntimeAvailabilityStatus): void {
    if (this.status() === status) {
      return;
    }

    this.status.set(status);
    this.statusListeners.forEach((listener) => {
      try {
        listener(status);
      } catch {
        // prevent one failing listener from breaking notification of others
      }
    });
  }

  private readonly handleResumeLikeEvent = () => {
    void this.refresh();
  };

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible') {
      return;
    }

    void this.refresh();
  };

  /**
   * On the native shell the bundled runtime-config asset is always reachable, so it cannot
   * indicate backend availability. Probe the API health endpoint on the configured host instead.
   */
  private async probeApiHealth(): Promise<boolean> {
    try {
      const baseUrl = environment.gameApiBaseUrl.trim().replace(/\/+$/, '');
      const url = new URL(`${baseUrl}/v1/health`, window.location.origin);
      url.searchParams.set('ts', String(Date.now()));
      const response = await fetch(url.toString(), { cache: 'no-store' });
      return response.ok;
    } catch {
      return false;
    }
  }

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
    const showMgcImport = this.matchLastBoolean(script, 'showMgcImport');
    const e2eFixtures = this.matchLastBoolean(script, 'e2eFixtures');
    const recommendationsExploreEnabled = this.matchLastBoolean(
      script,
      'recommendationsExploreEnabled'
    );
    const tasEnabled = this.matchLastBoolean(script, 'tasEnabled');
    const requireAuth = this.matchLastBoolean(script, 'requireAuth');

    if (
      appVersion === null &&
      showMgcImport === null &&
      e2eFixtures === null &&
      recommendationsExploreEnabled === null &&
      tasEnabled === null &&
      requireAuth === null
    ) {
      return null;
    }

    return {
      ...(appVersion !== null ? { appVersion } : {}),
      ...(showMgcImport !== null ||
      e2eFixtures !== null ||
      recommendationsExploreEnabled !== null ||
      tasEnabled !== null ||
      requireAuth !== null
        ? {
            featureFlags: {
              ...(showMgcImport !== null ? { showMgcImport } : {}),
              ...(e2eFixtures !== null ? { e2eFixtures } : {}),
              ...(recommendationsExploreEnabled !== null ? { recommendationsExploreEnabled } : {}),
              ...(tasEnabled !== null ? { tasEnabled } : {}),
              ...(requireAuth !== null ? { requireAuth } : {}),
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
