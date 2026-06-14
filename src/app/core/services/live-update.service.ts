import { Injectable, inject } from '@angular/core';
import { App } from '@capacitor/app';
import { LiveUpdate } from '@capawesome/capacitor-live-update';

import { environment } from '../../../environments/environment';
import { DebugLogService } from './debug-log.service';
import {
  buildLiveUpdateManifestUrl,
  parseIosLiveUpdateManifest,
  resolveBackendOriginFromGameApiBaseUrl,
  shouldStageLiveUpdateManifest,
  type IosLiveUpdateManifest,
} from './live-update.logic';
import { isNativePlatform } from '../utils/native-platform.util';

const MANIFEST_FETCH_TIMEOUT_MS = 8000;
const RESUME_CHECK_INTERVAL_MS = 15 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class LiveUpdateService {
  private readonly debugLogService = inject(DebugLogService);
  private resumeListenerAttached = false;
  private lastCheckAt = 0;
  private checkInFlight: Promise<void> | null = null;

  isEnabled(): boolean {
    return isNativePlatform() && environment.production;
  }

  async checkAndStageUpdate(force = false): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    if (!force && this.checkInFlight !== null) {
      return this.checkInFlight;
    }

    this.checkInFlight = this.runCheckAndStageUpdate(force).finally(() => {
      this.checkInFlight = null;
    });

    return this.checkInFlight;
  }

  async markReady(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    try {
      const result = await LiveUpdate.ready();
      this.debugLogService.info('live_update.ready', {
        currentBundleId: result.currentBundleId ?? null,
        previousBundleId: result.previousBundleId ?? null,
        rollback: result.rollback,
      });
    } catch (error: unknown) {
      this.debugLogService.error('live_update.ready_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  initializeResumeChecks(): void {
    if (!this.isEnabled() || this.resumeListenerAttached) {
      return;
    }

    this.resumeListenerAttached = true;

    void App.addListener('appStateChange', (state) => {
      if (state.isActive) {
        void this.checkAndStageUpdate();
      }
    }).catch((error: unknown) => {
      this.debugLogService.error('live_update.resume_listener_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async runCheckAndStageUpdate(force: boolean): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastCheckAt < RESUME_CHECK_INTERVAL_MS) {
      return;
    }

    this.lastCheckAt = now;

    try {
      const versionCode = (await LiveUpdate.getVersionCode()).versionCode.trim();
      if (versionCode.length === 0) {
        this.debugLogService.info('live_update.skip_missing_version_code');
        return;
      }

      const backendOrigin = resolveBackendOriginFromGameApiBaseUrl(environment.gameApiBaseUrl);
      if (backendOrigin === null) {
        this.debugLogService.info('live_update.skip_missing_backend_origin');
        return;
      }

      const manifest = await this.fetchManifest(backendOrigin, versionCode);
      const [{ bundleId: currentBundleId }, { bundleId: nextBundleId }] = await Promise.all([
        LiveUpdate.getCurrentBundle(),
        LiveUpdate.getNextBundle(),
      ]);

      const decision = shouldStageLiveUpdateManifest({
        manifest,
        nativeBuildNumber: versionCode,
        currentBundleId: currentBundleId ?? null,
        nextBundleId: nextBundleId ?? null,
      });

      if (!decision.shouldStage || manifest === null) {
        this.debugLogService.info('live_update.skip', { reason: decision.reason });
        return;
      }

      await LiveUpdate.downloadBundle({
        url: manifest.url,
        bundleId: manifest.bundleId,
        checksum: manifest.checksum,
        signature: manifest.signature,
      });

      await LiveUpdate.setNextBundle({ bundleId: manifest.bundleId });

      this.debugLogService.info('live_update.staged', {
        bundleId: manifest.bundleId,
        semver: manifest.semver,
        nativeBuildNumber: manifest.nativeBuildNumber,
      });
    } catch (error: unknown) {
      this.debugLogService.error('live_update.check_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async fetchManifest(
    backendOrigin: string,
    nativeBuildNumber: string
  ): Promise<IosLiveUpdateManifest | null> {
    const manifestUrl = buildLiveUpdateManifestUrl(backendOrigin, nativeBuildNumber);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, MANIFEST_FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(manifestUrl, {
        cache: 'no-store',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      this.debugLogService.info('live_update.manifest_missing', {
        status: response.status,
        manifestUrl,
      });
      return null;
    }

    const payload: unknown = await response.json();
    const manifest = parseIosLiveUpdateManifest(payload);

    if (manifest === null) {
      this.debugLogService.error('live_update.manifest_invalid', { manifestUrl });
    }

    return manifest;
  }
}
