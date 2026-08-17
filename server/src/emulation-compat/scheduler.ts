import { Pool } from 'pg';
import { config } from '../config.js';
import { COMPAT_PLATFORM_MAP } from './platform-map.js';
import { isCompatRefreshDue, refreshCompatSource } from './refresh.js';

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
    try {
      const now = new Date();
      const stateResult = await pool.query<{
        platform_igdb_id: number;
        last_refreshed_at: string | null;
      }>(`SELECT platform_igdb_id, last_refreshed_at FROM emulation_compat_source_state`);
      const lastRefreshedByPlatform = new Map(
        stateResult.rows.map((row) => [row.platform_igdb_id, row.last_refreshed_at])
      );

      for (const platformIgdbId of COMPAT_PLATFORM_MAP.keys()) {
        const lastRefreshedAt = lastRefreshedByPlatform.get(platformIgdbId) ?? null;
        if (!isCompatRefreshDue(lastRefreshedAt, config.compatPeriodicRefreshDays, now)) {
          continue;
        }

        try {
          await refreshCompatSource(pool, platformIgdbId);
        } catch (error) {
          console.error('[emulation-compat] refresh_failed', {
            platformIgdbId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      console.error('[emulation-compat] run_failed', error);
    } finally {
      running = false;
    }
  };

  void runOnce();
  const timer = setInterval(() => {
    void runOnce();
  }, intervalMs);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      return Promise.resolve();
    },
  };
}
