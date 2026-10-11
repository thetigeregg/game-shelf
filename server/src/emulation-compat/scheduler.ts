import { Pool } from 'pg';
import { config } from '../config.js';
import { COMPAT_PLATFORM_MAP } from './platform-map.js';
import {
  describeErrorCause,
  isCompatPlatformDue,
  loadCompatSourceStates,
  refreshCompatSource,
} from './refresh.js';

interface MonitorStartResult {
  stop: () => Promise<void>;
}

export function startEmulationCompatMonitor(pool: Pool): MonitorStartResult {
  if (config.compatScraperBaseUrl.length === 0) {
    console.info('[emulation-compat] disabled (COMPAT_SCRAPER_BASE_URL not set)');
    return { stop: () => Promise.resolve() };
  }

  let running = false;
  let stopped = false;
  let currentRun: Promise<void> | null = null;
  const intervalMs = Math.max(30, config.releaseMonitorIntervalSeconds) * 1000;

  console.info('[emulation-compat] started', {
    intervalMs,
    compatPeriodicRefreshDays: config.compatPeriodicRefreshDays,
    platforms: [...COMPAT_PLATFORM_MAP.keys()],
  });

  const runOnce = async (): Promise<void> => {
    if (stopped || running) {
      return;
    }

    running = true;
    const run = (async () => {
      const now = new Date();
      const stateByPlatform = await loadCompatSourceStates(pool);

      for (const platformIgdbId of COMPAT_PLATFORM_MAP.keys()) {
        if (!isCompatPlatformDue(stateByPlatform.get(platformIgdbId), now)) {
          continue;
        }

        try {
          await refreshCompatSource(pool, platformIgdbId);
        } catch (error) {
          console.error('[emulation-compat] refresh_failed', {
            platformIgdbId,
            message: error instanceof Error ? error.message : String(error),
            ...describeErrorCause(error),
          });
        }
      }
    })()
      .catch((error: unknown) => {
        console.error('[emulation-compat] run_failed', error);
      })
      .finally(() => {
        running = false;
        if (currentRun === run) {
          currentRun = null;
        }
      });
    currentRun = run;
    await run;
  };

  void runOnce();
  const timer = setInterval(() => {
    void runOnce();
  }, intervalMs);

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      if (currentRun) {
        await currentRun;
      }
    },
  };
}
