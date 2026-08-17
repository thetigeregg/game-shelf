import { Pool } from 'pg';
import { config } from '../config.js';
import { isEmulationCompatStatus } from '../../../shared/emulation-compat-status.mjs';
import { COMPAT_PLATFORM_MAP, getCompatPlatformConfig } from './platform-map.js';
import { findBestTitleMatch } from './title-similarity.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface CompatSourceEntry {
  rawTitle: string;
  rawLabel: string;
  normalizedStatus: string;
  sourceId: string | null;
  sourceUrl: string | null;
}

interface OwnedGameRow {
  igdb_game_id: string;
  title: string;
  match_locked: boolean;
  normalized_status: string | null;
}

export function isCompatRefreshDue(
  lastRefreshedAt: string | null,
  refreshDays: number,
  now: Date
): boolean {
  if (!lastRefreshedAt) {
    return true;
  }

  const refreshedAtMs = Date.parse(lastRefreshedAt);
  if (!Number.isFinite(refreshedAtMs)) {
    return true;
  }

  const ageMs = now.getTime() - refreshedAtMs;
  return ageMs >= Math.max(1, refreshDays) * ONE_DAY_MS;
}

async function fetchCompatList(
  platformIgdbId: number
): Promise<{ emulator: string; sourceUrl: string | null; entries: CompatSourceEntry[] }> {
  const baseUrl = config.compatScraperBaseUrl.replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/v1/compat/${String(platformIgdbId)}`, {
    headers:
      config.compatScraperToken.length > 0
        ? { Authorization: `Bearer ${config.compatScraperToken}` }
        : {},
  });

  if (!response.ok) {
    throw new Error(`compat-scraper request failed with status ${String(response.status)}`);
  }

  const body = (await response.json()) as {
    emulator: string;
    sourceUrl: string | null;
    entries: CompatSourceEntry[];
  };

  return body;
}

async function loadOwnedGamesForPlatform(
  pool: Pool,
  platformIgdbId: number
): Promise<OwnedGameRow[]> {
  const result = await pool.query<OwnedGameRow>(
    `
    SELECT
      g.igdb_game_id,
      BTRIM(COALESCE(g.payload->>'title', '')) AS title,
      COALESCE(ecs.match_locked, FALSE) AS match_locked,
      ecs.normalized_status AS normalized_status
    FROM games g
    LEFT JOIN emulation_compat_status ecs
      ON ecs.igdb_game_id = g.igdb_game_id AND ecs.platform_igdb_id = g.platform_igdb_id
    WHERE g.platform_igdb_id = $1
      AND (g.payload->>'listType') IN ('collection', 'wishlist')
      AND BTRIM(COALESCE(g.payload->>'title', '')) <> ''
    `,
    [platformIgdbId]
  );

  return result.rows;
}

const MIN_MATCH_SCORE = 20;

export async function refreshCompatSource(pool: Pool, platformIgdbId: number): Promise<void> {
  const platformConfig = getCompatPlatformConfig(platformIgdbId);
  if (!platformConfig) {
    throw new Error(`Platform ${String(platformIgdbId)} is not compat-eligible.`);
  }

  const now = new Date();

  try {
    const { emulator, sourceUrl, entries } = await fetchCompatList(platformIgdbId);
    const ownedGames = await loadOwnedGamesForPlatform(pool, platformIgdbId);
    // Games already locked (manual override) or already at this emulator's best
    // reachable status are stable — they can't improve, so skip re-fetch/re-match work.
    const candidates = ownedGames.filter(
      (game) => !game.match_locked && game.normalized_status !== platformConfig.bestStatus
    );

    let matchedCount = ownedGames.filter((game) => game.normalized_status !== null).length;

    for (const game of candidates) {
      const best = findBestTitleMatch(game.title, entries, (entry) => entry.rawTitle);

      if (!best || best.score < MIN_MATCH_SCORE) {
        continue;
      }

      const normalizedStatus = isEmulationCompatStatus(best.candidate.normalizedStatus)
        ? best.candidate.normalizedStatus
        : 'incomplete';

      await pool.query(
        `
        INSERT INTO emulation_compat_status (
          igdb_game_id, platform_igdb_id, emulator, normalized_status, raw_label,
          raw_source_id, source_url, match_confidence, match_query_title,
          match_locked, enrichment_retry, matched_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, '{}'::jsonb, $10, NOW())
        ON CONFLICT (igdb_game_id, platform_igdb_id) DO UPDATE SET
          emulator = EXCLUDED.emulator,
          normalized_status = EXCLUDED.normalized_status,
          raw_label = EXCLUDED.raw_label,
          raw_source_id = EXCLUDED.raw_source_id,
          source_url = EXCLUDED.source_url,
          match_confidence = EXCLUDED.match_confidence,
          match_query_title = EXCLUDED.match_query_title,
          matched_at = EXCLUDED.matched_at,
          updated_at = NOW()
        WHERE emulation_compat_status.match_locked = FALSE
        `,
        [
          game.igdb_game_id,
          platformIgdbId,
          emulator,
          normalizedStatus,
          best.candidate.rawLabel,
          best.candidate.sourceId,
          best.candidate.sourceUrl,
          best.score,
          game.title,
          now.toISOString(),
        ]
      );

      if (game.normalized_status === null) {
        matchedCount += 1;
      }
    }

    await pool.query(
      `
      INSERT INTO emulation_compat_source_state (
        platform_igdb_id, emulator, source_url, last_refreshed_at,
        last_refresh_status, last_refresh_error, last_entry_count, last_matched_count, updated_at
      ) VALUES ($1, $2, $3, NOW(), 'success', NULL, $4, $5, NOW())
      ON CONFLICT (platform_igdb_id) DO UPDATE SET
        emulator = EXCLUDED.emulator,
        source_url = EXCLUDED.source_url,
        last_refreshed_at = NOW(),
        last_refresh_status = 'success',
        last_refresh_error = NULL,
        last_entry_count = EXCLUDED.last_entry_count,
        last_matched_count = EXCLUDED.last_matched_count,
        updated_at = NOW()
      `,
      [platformIgdbId, emulator, sourceUrl, entries.length, matchedCount]
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(
      `
      INSERT INTO emulation_compat_source_state (
        platform_igdb_id, emulator, source_url, last_refresh_status, last_refresh_error, updated_at
      ) VALUES ($1, $2, $3, 'error', $4, NOW())
      ON CONFLICT (platform_igdb_id) DO UPDATE SET
        last_refresh_status = 'error',
        last_refresh_error = EXCLUDED.last_refresh_error,
        updated_at = NOW()
      `,
      [platformIgdbId, platformConfig.emulator, platformConfig.sourceUrl, message]
    );
    throw error;
  }
}

export async function enqueueForcedCompatRefreshJobs(
  pool: Pool,
  options: { respectStaleness: boolean }
): Promise<{ enqueued: number; deduped: number; errors: number }> {
  const now = new Date();
  const stateResult = await pool.query<{
    platform_igdb_id: number;
    last_refreshed_at: string | null;
  }>(`SELECT platform_igdb_id, last_refreshed_at FROM emulation_compat_source_state`);
  const lastRefreshedByPlatform = new Map(
    stateResult.rows.map((row) => [row.platform_igdb_id, row.last_refreshed_at])
  );

  let enqueued = 0;
  let deduped = 0;
  let errors = 0;

  for (const platformIgdbId of getCompatEligiblePlatformIds()) {
    const lastRefreshedAt = lastRefreshedByPlatform.get(platformIgdbId) ?? null;
    const due =
      !options.respectStaleness ||
      isCompatRefreshDue(lastRefreshedAt, config.compatPeriodicRefreshDays, now);

    if (!due) {
      deduped += 1;
      continue;
    }

    try {
      await refreshCompatSource(pool, platformIgdbId);
      enqueued += 1;
    } catch {
      errors += 1;
    }
  }

  return { enqueued, deduped, errors };
}

function getCompatEligiblePlatformIds(): number[] {
  return [...COMPAT_PLATFORM_MAP.keys()];
}
