import type { Pool, PoolClient } from 'pg';
import { config } from './config.js';
import { BackgroundJobRepository } from './background-jobs.js';
import { sendFcmMulticast } from './fcm.js';
import { fetchMetadataPathFromWorker } from './metadata.js';

const RELEASE_NOTIFICATIONS_ENABLED_KEY = 'game-shelf:notifications:release:enabled';
const RELEASE_NOTIFICATION_EVENTS_KEY = 'game-shelf:notifications:release:events';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Safety bound to prevent unbounded memory growth if token volume spikes.
const MAX_ACTIVE_TOKENS_PER_RUN = 20_000;
const QUEUED_GAME_CONTEXT_CACHE_TTL_MS = 10_000;
const DUE_SELECTION_SOURCE_ID = 'games_collection_or_wishlist_due';

type ReleaseEventType =
  | 'release_date_set'
  | 'release_date_changed'
  | 'release_date_removed'
  | 'release_day';
type ReleaseState = 'unknown' | 'scheduled' | 'released';
type ReleasePrecision = 'unknown' | 'year' | 'quarter' | 'month' | 'day';

interface DueGameRow {
  igdb_game_id: string;
  platform_igdb_id: number;
  payload: Record<string, unknown> | null;
  watch_exists: boolean;
  last_known_release_marker: string | null;
  last_known_release_precision: string | null;
  last_known_release_date: string | null;
  last_known_release_year: number | null;
  last_seen_state: string | null;
  last_hltb_refresh_at: string | null;
  last_metacritic_refresh_at: string | null;
  last_notified_release_day: string | null;
}

interface NotificationPreferences {
  enabled: boolean;
  events: {
    set: boolean;
    changed: boolean;
    removed: boolean;
    day: boolean;
  };
}

interface ReleaseEvent {
  type: ReleaseEventType;
  title: string;
  body: string;
  eventKey: string;
  releaseMarker: string | null;
}

interface ReleaseInfo {
  precision: ReleasePrecision;
  marker: string | null;
  date: string | null;
  year: number | null;
  display: string | null;
}

interface MonitorStartResult {
  stop: () => Promise<void>;
}

interface MonitorRunStats {
  startedAtIso: string;
  dueGames: number;
  activeTokensAtStart: number;
  processedWithLock: number;
  lockSkipped: number;
  gameFailures: number;
  igdbRefreshAttempts: number;
  igdbRefreshSuccesses: number;
  hltbRefreshAttempts: number;
  hltbRefreshSuccesses: number;
  metacriticRefreshAttempts: number;
  metacriticRefreshSuccesses: number;
  eventsConsidered: number;
  eventsDisabled: number;
  eventsReleaseDayAlreadyNotified: number;
  eventsSkippedNoTokens: number;
  eventsSkippedDuplicate: number;
  eventsReserved: number;
  sendAttempts: number;
  sendBatchSuccess: number;
  sendBatchFailure: number;
  sendNoSuccessReservationsReleased: number;
  eventsSent: number;
  invalidTokensDeactivated: number;
  tokenCleanupRan: boolean;
  tokensDeactivatedByCleanup: number;
  tokensPrunedByCleanup: number;
}

interface MonitorRuntimeState {
  nextFcmTokenCleanupAtMs: number;
}

/* node:coverage disable */
interface QueuedGameContextCacheEntry {
  loadedAtMs: number;
  preferences: NotificationPreferences;
  activeTokenSet: Set<string>;
}

let queuedGameContextCache = new WeakMap<Pool, QueuedGameContextCacheEntry>();
let queuedGameContextInflight = new WeakMap<Pool, Promise<QueuedGameContextCacheEntry>>();

export function startReleaseMonitor(pool: Pool): MonitorStartResult {
  if (!config.releaseMonitorEnabled) {
    console.info('[release-monitor] disabled');
    return { stop: () => Promise.resolve() };
  }

  let running = false;
  let stopped = false;
  let currentRun: Promise<void> | null = null;
  const runtimeState = createMonitorRuntimeState();
  const intervalMs = Math.max(30, config.releaseMonitorIntervalSeconds) * 1000;
  console.info('[release-monitor] started', {
    intervalMs,
    batchSize: config.releaseMonitorBatchSize,
    hltbPeriodicRefreshDays: config.hltbPeriodicRefreshDays,
    metacriticPeriodicRefreshDays: config.metacriticPeriodicRefreshDays
  });

  const runOnce = async (): Promise<void> => {
    if (stopped || running) {
      return;
    }

    running = true;
    const run = (async () => {
      await processDueGames(pool, runtimeState);
    })()
      .catch((error: unknown) => {
        console.error('[release-monitor] run_failed', error);
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
    }
  };
}

async function processDueGames(pool: Pool, runtimeState: MonitorRuntimeState): Promise<void> {
  const stats = createMonitorRunStats();
  console.info('[release-monitor] run_started', {
    startedAtIso: stats.startedAtIso,
    batchSize: config.releaseMonitorBatchSize,
    dueSelectionSource: DUE_SELECTION_SOURCE_ID
  });
  await runFcmTokenCleanupIfDue(pool, stats, runtimeState);

  const dueRows = await pool.query<DueGameRow>(
    `
    SELECT
      g.igdb_game_id,
      g.platform_igdb_id,
      g.payload,
      (rws.igdb_game_id IS NOT NULL) AS watch_exists,
      rws.last_known_release_marker,
      rws.last_known_release_precision,
      rws.last_known_release_date,
      rws.last_known_release_year,
      rws.last_seen_state,
      rws.last_hltb_refresh_at,
      rws.last_metacritic_refresh_at,
      rws.last_notified_release_day
    FROM games g
    LEFT JOIN release_watch_state rws
      ON rws.igdb_game_id = g.igdb_game_id AND rws.platform_igdb_id = g.platform_igdb_id
    WHERE (g.payload->>'listType') IN ('collection', 'wishlist')
      AND COALESCE(rws.next_check_at, NOW()) <= NOW()
    ORDER BY COALESCE(rws.next_check_at, NOW()) ASC
    LIMIT $1
    `,
    [config.releaseMonitorBatchSize]
  );
  stats.dueGames = dueRows.rows.length;

  if (dueRows.rows.length === 0) {
    emitRunSummary(stats);
    return;
  }

  for (const row of dueRows.rows) {
    try {
      const queued = await enqueueReleaseMonitorGameJob(pool, row);
      if (queued) {
        stats.processedWithLock += 1;
      } else {
        stats.lockSkipped += 1;
      }
    } catch (error) {
      stats.gameFailures += 1;
      if (config.releaseMonitorDebugLogs) {
        console.warn('[release-monitor] lock_or_process_failed', {
          igdbGameId: row.igdb_game_id,
          platformIgdbId: row.platform_igdb_id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  emitRunSummary(stats);
}

async function enqueueReleaseMonitorGameJob(pool: Pool, row: DueGameRow): Promise<boolean> {
  /* node:coverage disable */
  const jobs = new BackgroundJobRepository(pool);
  const dedupeKey = `release-monitor:${row.igdb_game_id}:${String(row.platform_igdb_id)}`;
  const payload: Record<string, unknown> = {
    igdb_game_id: row.igdb_game_id,
    platform_igdb_id: row.platform_igdb_id,
    payload: row.payload ?? {},
    watch_exists: row.watch_exists,
    last_known_release_marker: row.last_known_release_marker,
    last_known_release_precision: row.last_known_release_precision,
    last_known_release_date: row.last_known_release_date,
    last_known_release_year: row.last_known_release_year,
    last_seen_state: row.last_seen_state,
    last_hltb_refresh_at: row.last_hltb_refresh_at,
    last_metacritic_refresh_at: row.last_metacritic_refresh_at,
    last_notified_release_day: row.last_notified_release_day
  };
  const queued = await jobs.enqueue({
    jobType: 'release_monitor_game',
    dedupeKey,
    payload,
    priority: 80,
    maxAttempts: 5
  });
  return !queued.deduped;
  /* node:coverage enable */
}

function parseDueGameRowFromPayload(payload: Record<string, unknown>): DueGameRow | null {
  /* node:coverage disable */
  const igdbGameId = stringOrNull(payload['igdb_game_id']);
  const platformIgdbId = integerOrNull(payload['platform_igdb_id']);
  if (igdbGameId === null || platformIgdbId === null) {
    return null;
  }

  const rowPayloadRaw = payload['payload'];
  const rowPayload =
    rowPayloadRaw && typeof rowPayloadRaw === 'object' && !Array.isArray(rowPayloadRaw)
      ? (rowPayloadRaw as Record<string, unknown>)
      : null;

  return {
    igdb_game_id: igdbGameId,
    platform_igdb_id: platformIgdbId,
    payload: rowPayload,
    watch_exists: payload['watch_exists'] === true,
    last_known_release_marker: stringOrNull(payload['last_known_release_marker']),
    last_known_release_precision: stringOrNull(payload['last_known_release_precision']),
    last_known_release_date: stringOrNull(payload['last_known_release_date']),
    last_known_release_year: integerOrNull(payload['last_known_release_year']),
    last_seen_state: stringOrNull(payload['last_seen_state']),
    last_hltb_refresh_at: stringOrNull(payload['last_hltb_refresh_at']),
    last_metacritic_refresh_at: stringOrNull(payload['last_metacritic_refresh_at']),
    last_notified_release_day: stringOrNull(payload['last_notified_release_day'])
  };
  /* node:coverage enable */
}

async function processQueuedReleaseMonitorGame(
  pool: Pool,
  payload: Record<string, unknown>
): Promise<void> {
  /* node:coverage disable */
  const row = parseDueGameRowFromPayload(payload);
  if (!row) {
    throw new Error('Invalid release monitor game payload.');
  }

  const stats = createMonitorRunStats();
  const queuedContext = await getQueuedGameContext(pool);
  const preferences = queuedContext.preferences;
  const activeTokenSet = queuedContext.activeTokenSet;
  stats.activeTokensAtStart = activeTokenSet.size;

  const locked = await withGameLock(pool, row.igdb_game_id, row.platform_igdb_id, async () => {
    await processGameRow(pool, row, preferences, activeTokenSet, stats);
  });
  if (!locked && config.releaseMonitorDebugLogs) {
    console.info('[release-monitor] queued_game_lock_skipped', {
      igdbGameId: row.igdb_game_id,
      platformIgdbId: row.platform_igdb_id
    });
  }
  /* node:coverage enable */
}

async function getQueuedGameContext(pool: Pool): Promise<QueuedGameContextCacheEntry> {
  const nowMs = Date.now();
  const cached = queuedGameContextCache.get(pool);
  if (cached && nowMs - cached.loadedAtMs <= QUEUED_GAME_CONTEXT_CACHE_TTL_MS) {
    return cached;
  }

  const inflight = queuedGameContextInflight.get(pool);
  if (inflight) {
    return inflight;
  }

  const loader = (async () => {
    const preferences = await readNotificationPreferences(pool);
    const activeTokenSet = await loadActiveTokenSet(pool);
    const entry: QueuedGameContextCacheEntry = {
      loadedAtMs: Date.now(),
      preferences,
      activeTokenSet
    };
    queuedGameContextCache.set(pool, entry);
    return entry;
  })().finally(() => {
    queuedGameContextInflight.delete(pool);
  });

  queuedGameContextInflight.set(pool, loader);
  return loader;
}

function clearQueuedGameContextCache(): void {
  queuedGameContextCache = new WeakMap<Pool, QueuedGameContextCacheEntry>();
  queuedGameContextInflight = new WeakMap<Pool, Promise<QueuedGameContextCacheEntry>>();
}
/* node:coverage enable */

async function processGameRow(
  pool: Pool,
  row: DueGameRow,
  preferences: NotificationPreferences,
  activeTokenSet: Set<string>,
  stats: MonitorRunStats
): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const originalPayload = row.payload ?? {};
  const isBootstrap = !row.watch_exists;
  let mergedPayload = originalPayload;
  const title = stringOrFallback(originalPayload['title'], 'Unknown title');
  const platformName = stringOrNull(originalPayload['platform']);
  const platformIgdbId = row.platform_igdb_id;
  const releaseBefore = deriveReleaseInfo({
    marker: stringOrNull(row.last_known_release_marker),
    precision: normalizeReleasePrecision(row.last_known_release_precision),
    releaseDate:
      stringOrNull(row.last_known_release_date) ?? stringOrNull(originalPayload['releaseDate']),
    releaseYear: integerOrNull(row.last_known_release_year ?? originalPayload['releaseYear'])
  });

  let lastHltbRefreshAt = row.last_hltb_refresh_at;
  let lastMetacriticRefreshAt = row.last_metacritic_refresh_at;

  try {
    if (!isBootstrap) {
      stats.igdbRefreshAttempts += 1;
      const refreshed = await fetchGameById(row.igdb_game_id);
      if (refreshed) {
        stats.igdbRefreshSuccesses += 1;
        mergedPayload = mergePayloadForRefresh(originalPayload, refreshed);
      } else if (config.releaseMonitorDebugLogs) {
        console.debug('[release-monitor] igdb_refresh_empty', {
          igdbGameId: row.igdb_game_id,
          platformIgdbId,
          title
        });
      }
    }

    const releaseAfter = deriveReleaseInfo({
      marker: stringOrNull(mergedPayload['releaseMarker']),
      precision: normalizeReleasePrecision(stringOrNull(mergedPayload['releasePrecision'])),
      releaseDate: stringOrNull(mergedPayload['releaseDate']),
      releaseYear: integerOrNull(mergedPayload['releaseYear'])
    });
    const releaseStateAfter = deriveReleaseState(releaseAfter, now);
    const releaseStateBefore =
      normalizeReleaseState(row.last_seen_state) ?? deriveReleaseState(releaseBefore, now);
    const hltbEligible = isWithinPastYears(releaseAfter, now, config.hltbPeriodicRefreshYears);
    const metacriticEligible = isWithinPastYears(
      releaseAfter,
      now,
      config.metacriticPeriodicRefreshYears
    );
    const hasExistingHltb = hasHltbValues(mergedPayload);
    const hasExistingMetacritic = hasMetacriticValues(mergedPayload);

    if (isBootstrap && hasExistingHltb && hltbEligible) {
      // Seed periodic timer from existing library metadata to avoid immediate re-scrape flood.
      lastHltbRefreshAt = nowIso;
    }
    if (isBootstrap && hasExistingMetacritic && metacriticEligible) {
      // Seed periodic timer from existing library metadata to avoid immediate re-scrape flood.
      lastMetacriticRefreshAt = nowIso;
    }

    const hltbDue =
      !isBootstrap &&
      !isProviderMatchLocked(mergedPayload, 'hltbMatchLocked') &&
      isHltbRefreshDue(lastHltbRefreshAt, mergedPayload, now);
    const metacriticDue =
      !isBootstrap &&
      !isProviderMatchLocked(mergedPayload, 'reviewMatchLocked') &&
      isMetacriticRefreshDue(lastMetacriticRefreshAt, mergedPayload, now);

    if (hltbEligible && hltbDue) {
      stats.hltbRefreshAttempts += 1;
      const hltbRefreshQuery = resolveHltbRefreshQuery(mergedPayload, title, platformName);
      const refreshedHltb = await fetchHltbPayload({
        title: hltbRefreshQuery.title,
        releaseYear: hltbRefreshQuery.releaseYear,
        platform: hltbRefreshQuery.platform
      });

      if (refreshedHltb) {
        stats.hltbRefreshSuccesses += 1;
        mergedPayload = {
          ...mergedPayload,
          hltbMainHours: finiteNumberOrNull(refreshedHltb.hltbMainHours),
          hltbMainExtraHours: finiteNumberOrNull(refreshedHltb.hltbMainExtraHours),
          hltbCompletionistHours: finiteNumberOrNull(refreshedHltb.hltbCompletionistHours)
        };
      }
      // Advance cadence on attempt (not just success) to avoid repeatedly
      // hammering the scraper for titles that currently return no match.
      lastHltbRefreshAt = nowIso;
    }

    if (metacriticEligible && metacriticDue) {
      stats.metacriticRefreshAttempts += 1;
      const reviewRefreshQuery = resolveReviewRefreshQuery(
        mergedPayload,
        title,
        platformName,
        platformIgdbId
      );
      const refreshedReview = await fetchReviewPayload(reviewRefreshQuery);

      if (refreshedReview) {
        stats.metacriticRefreshSuccesses += 1;
        mergedPayload = mergeReviewRefreshPayload(mergedPayload, refreshedReview);
      }
      // Advance cadence on attempt (not just success) to avoid repeatedly
      // hammering the scraper for titles that currently return no match.
      lastMetacriticRefreshAt = nowIso;
    }

    const payloadPatch = buildPayloadPatch(originalPayload, mergedPayload);
    if (Object.keys(payloadPatch).length > 0) {
      await upsertGamePayload(pool, row.igdb_game_id, platformIgdbId, payloadPatch);
    }

    const releaseEvents = isBootstrap
      ? []
      : buildReleaseEvents({
          igdbGameId: row.igdb_game_id,
          platformIgdbId,
          title: stringOrFallback(mergedPayload['title'], title),
          releaseBefore,
          releaseAfter,
          now
        });

    const sentEventTypes = new Set<ReleaseEventType>();
    const lastNotifiedReleaseDay = normalizeDateString(row.last_notified_release_day);

    for (const event of releaseEvents) {
      stats.eventsConsidered += 1;

      if (!isEventEnabled(preferences, event.type)) {
        stats.eventsDisabled += 1;
        continue;
      }

      const shouldSkipReleaseDay =
        event.type === 'release_day' &&
        lastNotifiedReleaseDay === normalizeDateString(event.releaseMarker);
      if (shouldSkipReleaseDay) {
        stats.eventsReleaseDayAlreadyNotified += 1;
        continue;
      }

      if (activeTokenSet.size === 0) {
        stats.eventsSkippedNoTokens += 1;
        continue;
      }

      const reserved = await reserveNotificationLog(pool, event, row.igdb_game_id, platformIgdbId);
      if (!reserved) {
        stats.eventsSkippedDuplicate += 1;
        continue;
      }
      stats.eventsReserved += 1;

      stats.sendAttempts += 1;

      const sendResult = await sendFcmMulticast([...activeTokenSet], {
        title: event.title,
        body: event.body,
        data: {
          eventType: event.type,
          eventKey: event.eventKey,
          igdbGameId: row.igdb_game_id,
          platformIgdbId: String(platformIgdbId),
          releaseDate: event.releaseMarker ?? '',
          route: '/tabs/wishlist'
        }
      });
      stats.sendBatchSuccess += sendResult.successCount;
      stats.sendBatchFailure += sendResult.failureCount;

      if (sendResult.successCount <= 0) {
        await releaseNotificationLogReservation(pool, event.eventKey);
        stats.sendNoSuccessReservationsReleased += 1;
        continue;
      }

      sentEventTypes.add(event.type);
      stats.eventsSent += 1;

      await finalizeNotificationLog(pool, event, event.eventKey, sendResult.successCount);

      if (sendResult.invalidTokens.length > 0) {
        sendResult.invalidTokens.forEach((token) => {
          activeTokenSet.delete(token);
        });
        stats.invalidTokensDeactivated += sendResult.invalidTokens.length;
        await pool.query(
          `
          UPDATE fcm_tokens
          SET is_active = FALSE, updated_at = NOW()
          WHERE token = ANY($1::text[])
          `,
          [sendResult.invalidTokens]
        );
      }
    }

    const nextCheckAt = computeNextCheckAt(
      releaseAfter,
      now,
      hltbEligible,
      lastHltbRefreshAt,
      metacriticEligible,
      lastMetacriticRefreshAt
    );
    await upsertWatchState(pool, {
      igdbGameId: row.igdb_game_id,
      platformIgdbId,
      release: releaseAfter,
      releaseState: releaseStateAfter,
      lastIgdbRefreshAt: isBootstrap ? null : nowIso,
      lastHltbRefreshAt,
      lastMetacriticRefreshAt,
      nextCheckAt,
      sentEventTypes,
      releaseBefore,
      releaseStateBefore
    });
  } catch (error) {
    stats.gameFailures += 1;
    const nextCheckAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
    try {
      await pool.query(
        `
        INSERT INTO release_watch_state (
          igdb_game_id,
          platform_igdb_id,
          last_known_release_marker,
          last_known_release_precision,
          last_known_release_date,
          last_known_release_year,
          last_seen_state,
          next_check_at,
          last_error,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, NOW())
        ON CONFLICT (igdb_game_id, platform_igdb_id)
        DO UPDATE SET
          next_check_at = EXCLUDED.next_check_at,
          last_error = EXCLUDED.last_error,
          updated_at = NOW()
        `,
        [
          row.igdb_game_id,
          row.platform_igdb_id,
          releaseBefore.marker,
          releaseBefore.precision,
          releaseBefore.date,
          releaseBefore.year,
          normalizeReleaseState(row.last_seen_state) ?? 'unknown',
          nextCheckAt,
          error instanceof Error ? error.message : String(error)
        ]
      );
    } catch (persistenceError) {
      console.warn('[release-monitor] failure_state_persist_failed', {
        igdbGameId: row.igdb_game_id,
        platformIgdbId: row.platform_igdb_id,
        error:
          persistenceError instanceof Error ? persistenceError.message : String(persistenceError)
      });
    }
    if (config.releaseMonitorDebugLogs) {
      console.warn('[release-monitor] game_failed', {
        igdbGameId: row.igdb_game_id,
        platformIgdbId: row.platform_igdb_id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

async function fetchGameById(igdbGameId: string): Promise<Record<string, unknown> | null> {
  const response = await fetchMetadataPathFromWorker(`/v1/games/${encodeURIComponent(igdbGameId)}`);
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { item?: unknown };
  return isRecord(payload.item) ? payload.item : null;
}

function resolveHltbRefreshQuery(
  payload: Record<string, unknown>,
  fallbackTitle: string,
  fallbackPlatform: string | null
): { title: string; releaseYear: number | null; platform: string | null } {
  const title =
    stringOrNull(payload['hltbMatchQueryTitle']) ??
    stringOrFallback(payload['title'], fallbackTitle);
  const releaseYear =
    integerOrNull(payload['hltbMatchQueryReleaseYear']) ?? integerOrNull(payload['releaseYear']);
  const platform =
    stringOrNull(payload['hltbMatchQueryPlatform']) ??
    stringOrNull(payload['platform']) ??
    fallbackPlatform;

  return { title, releaseYear, platform };
}

function resolveReviewRefreshQuery(
  payload: Record<string, unknown>,
  fallbackTitle: string,
  fallbackPlatform: string | null,
  fallbackPlatformIgdbId: number
): {
  title: string;
  releaseYear: number | null;
  platform: string | null;
  platformIgdbId: number;
  reviewMatchMobygamesGameId: number | null;
} {
  const title =
    stringOrNull(payload['reviewMatchQueryTitle']) ??
    stringOrFallback(payload['title'], fallbackTitle);
  const releaseYear =
    integerOrNull(payload['reviewMatchQueryReleaseYear']) ?? integerOrNull(payload['releaseYear']);
  const platform =
    stringOrNull(payload['reviewMatchQueryPlatform']) ??
    stringOrNull(payload['platform']) ??
    fallbackPlatform;
  const platformIgdbId =
    integerOrNull(payload['reviewMatchPlatformIgdbId']) ?? fallbackPlatformIgdbId;
  const reviewMatchMobygamesGameId = integerOrNull(payload['reviewMatchMobygamesGameId']);

  return {
    title,
    releaseYear,
    platform,
    platformIgdbId,
    reviewMatchMobygamesGameId:
      typeof reviewMatchMobygamesGameId === 'number' && reviewMatchMobygamesGameId > 0
        ? reviewMatchMobygamesGameId
        : null
  };
}

interface HltbApiResponse {
  item?: {
    hltbMainHours?: unknown;
    hltbMainExtraHours?: unknown;
    hltbCompletionistHours?: unknown;
  } | null;
}

interface MetacriticApiResponse {
  item?: {
    metacriticScore?: unknown;
    metacriticUrl?: unknown;
  } | null;
}

interface MobyGamesApiResponse {
  games?: Array<{
    game_id?: unknown;
    moby_url?: unknown;
    critic_score?: unknown;
    moby_score?: unknown;
  }> | null;
}

type RefreshedReviewPayload =
  | {
      source: 'metacritic';
      metacriticScore: number | null;
      metacriticUrl: string | null;
    }
  | {
      source: 'mobygames';
      mobygamesGameId: number | null;
      mobyScore: number | null;
      reviewScore: number | null;
      reviewUrl: string | null;
    };

async function fetchHltbPayload(params: {
  title: string;
  releaseYear: number | null;
  platform: string | null;
}): Promise<HltbApiResponse['item'] | null> {
  if (params.title.trim().length < 2) {
    return null;
  }

  const response = await fetchMetadataPathFromWorker('/v1/hltb/search', {
    q: params.title,
    releaseYear: params.releaseYear ?? undefined,
    platform: params.platform ?? undefined
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as HltbApiResponse;
  return payload.item ?? null;
}

async function fetchMetacriticPayload(params: {
  title: string;
  releaseYear: number | null;
  platform: string | null;
  platformIgdbId: number;
}): Promise<MetacriticApiResponse['item'] | null> {
  if (params.title.trim().length < 2) {
    return null;
  }

  const response = await fetchMetadataPathFromWorker('/v1/metacritic/search', {
    q: params.title,
    releaseYear: params.releaseYear ?? undefined,
    platform: params.platform ?? undefined,
    platformIgdbId: params.platformIgdbId
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as MetacriticApiResponse;
  return payload.item ?? null;
}

async function fetchReviewPayload(params: {
  title: string;
  releaseYear: number | null;
  platform: string | null;
  platformIgdbId: number;
  reviewMatchMobygamesGameId: number | null;
}): Promise<RefreshedReviewPayload | null> {
  if (params.reviewMatchMobygamesGameId !== null) {
    const mobygames = await fetchMobygamesPayload({
      title: params.title,
      reviewMatchMobygamesGameId: params.reviewMatchMobygamesGameId
    });
    if (!mobygames) {
      return null;
    }

    return {
      source: 'mobygames',
      mobygamesGameId: mobygames.mobygamesGameId,
      mobyScore: mobygames.mobyScore,
      reviewScore: mobygames.reviewScore,
      reviewUrl: mobygames.reviewUrl
    };
  }

  const metacritic = await fetchMetacriticPayload({
    title: params.title,
    releaseYear: params.releaseYear,
    platform: params.platform,
    platformIgdbId: params.platformIgdbId
  });
  if (!metacritic) {
    return null;
  }

  return {
    source: 'metacritic',
    metacriticScore: finiteNumberOrNull(metacritic.metacriticScore),
    metacriticUrl: stringOrNull(metacritic.metacriticUrl)
  };
}

async function fetchMobygamesPayload(params: {
  title: string;
  reviewMatchMobygamesGameId: number;
}): Promise<{
  mobygamesGameId: number | null;
  mobyScore: number | null;
  reviewScore: number | null;
  reviewUrl: string | null;
} | null> {
  if (params.title.trim().length < 2) {
    return null;
  }

  const response = await fetchMetadataPathFromWorker('/v1/mobygames/search', {
    q: params.title,
    id: params.reviewMatchMobygamesGameId,
    limit: 5,
    format: 'normal',
    include: 'game_id,moby_url,moby_score,critic_score'
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as MobyGamesApiResponse;
  const games = Array.isArray(payload.games) ? payload.games : [];
  const firstGame = games.at(0);
  if (!firstGame) {
    return null;
  }
  const matched =
    games.find((entry) => integerOrNull(entry.game_id) === params.reviewMatchMobygamesGameId) ??
    firstGame;

  const criticScore = normalizeReviewScore(finiteNumberOrStringOrNull(matched.critic_score));
  const mobyScore = normalizeRawMobyScore(finiteNumberOrStringOrNull(matched.moby_score));
  const reviewScore =
    criticScore ??
    normalizeReviewScore(
      mobyScore !== null && mobyScore > 0 && mobyScore <= 10 ? mobyScore * 10 : mobyScore
    );

  return {
    mobygamesGameId: integerOrNull(matched.game_id),
    mobyScore,
    reviewScore,
    reviewUrl: stringOrNull(matched.moby_url)
  };
}

function mergePayloadForRefresh(
  existing: Record<string, unknown>,
  refreshed: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...existing,
    title: stringOrFallback(
      refreshed['title'],
      stringOrFallback(existing['title'], 'Unknown title')
    ),
    storyline: stringOrNull(refreshed['storyline']),
    summary: stringOrNull(refreshed['summary']),
    gameType: stringOrNull(refreshed['gameType']),
    similarGameIgdbIds: arrayOfStringsOrEmpty(refreshed['similarGameIgdbIds']),
    collections: arrayOfStringsOrEmpty(refreshed['collections']),
    developers: arrayOfStringsOrEmpty(refreshed['developers']),
    franchises: arrayOfStringsOrEmpty(refreshed['franchises']),
    genres: arrayOfStringsOrEmpty(refreshed['genres']),
    publishers: arrayOfStringsOrEmpty(refreshed['publishers']),
    releaseDate: stringOrNull(refreshed['releaseDate']),
    releaseMarker:
      stringOrNull(refreshed['releaseMarker']) ?? stringOrNull(existing['releaseMarker']),
    releasePrecision:
      normalizeReleasePrecision(stringOrNull(refreshed['releasePrecision'])) ??
      normalizeReleasePrecision(stringOrNull(existing['releasePrecision'])),
    releaseYear: integerOrNull(refreshed['releaseYear']),
    updatedAt: new Date().toISOString()
  };
}

function mergeMetacriticRefreshPayload(
  existing: Record<string, unknown>,
  refreshed: {
    metacriticScore?: unknown;
    metacriticUrl?: unknown;
  }
): Record<string, unknown> {
  const normalizedMetacriticScore = finiteNumberOrNull(refreshed.metacriticScore);
  const nextPayload: Record<string, unknown> = {
    ...existing,
    metacriticScore: normalizedMetacriticScore,
    metacriticUrl: stringOrNull(refreshed.metacriticUrl)
  };

  const existingReviewSource = stringOrNull(existing['reviewSource']);
  const shouldOverwriteReview =
    existingReviewSource === null || existingReviewSource === 'metacritic';

  if (shouldOverwriteReview) {
    nextPayload['reviewScore'] = normalizedMetacriticScore;
    nextPayload['reviewUrl'] = stringOrNull(refreshed.metacriticUrl);
    nextPayload['reviewSource'] = 'metacritic';
  }

  return nextPayload;
}

function mergeMobygamesRefreshPayload(
  existing: Record<string, unknown>,
  refreshed: {
    mobygamesGameId: number | null;
    mobyScore: number | null;
    reviewScore: number | null;
    reviewUrl: string | null;
  }
): Record<string, unknown> {
  const nextPayload: Record<string, unknown> = {
    ...existing,
    mobygamesGameId: refreshed.mobygamesGameId,
    mobyScore: refreshed.mobyScore
  };

  const existingReviewSource = stringOrNull(existing['reviewSource']);
  const shouldOverwriteReview =
    existingReviewSource === null || existingReviewSource === 'mobygames';

  if (shouldOverwriteReview) {
    nextPayload['reviewScore'] = refreshed.reviewScore;
    nextPayload['reviewUrl'] = refreshed.reviewUrl;
    nextPayload['reviewSource'] = 'mobygames';
  }

  return nextPayload;
}

function mergeReviewRefreshPayload(
  existing: Record<string, unknown>,
  refreshed: RefreshedReviewPayload
): Record<string, unknown> {
  if (refreshed.source === 'mobygames') {
    return mergeMobygamesRefreshPayload(existing, {
      mobygamesGameId: refreshed.mobygamesGameId,
      mobyScore: refreshed.mobyScore,
      reviewScore: refreshed.reviewScore,
      reviewUrl: refreshed.reviewUrl
    });
  }

  return mergeMetacriticRefreshPayload(existing, {
    metacriticScore: refreshed.metacriticScore,
    metacriticUrl: refreshed.metacriticUrl
  });
}

async function upsertGamePayload(
  pool: Pool,
  igdbGameId: string,
  platformIgdbId: number,
  payloadPatch: Record<string, unknown>
): Promise<void> {
  // Intentionally use a dedicated transaction so game payload and sync event
  // are committed atomically. Concurrency is still serialized by withGameLock:
  // advisory lock ownership is session-scoped and held for the entire handler.
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const updateResult = await client.query<{ payload: unknown }>(
      `
      UPDATE games
      SET payload = games.payload || $3::jsonb, updated_at = NOW()
      WHERE igdb_game_id = $1
        AND platform_igdb_id = $2
        AND games.payload IS DISTINCT FROM (games.payload || $3::jsonb)
      RETURNING payload
      `,
      [igdbGameId, platformIgdbId, JSON.stringify(payloadPatch)]
    );
    const updatedPayload =
      updateResult.rows[0]?.payload && typeof updateResult.rows[0].payload === 'object'
        ? (updateResult.rows[0].payload as Record<string, unknown>)
        : null;
    if (!updatedPayload) {
      await client.query('COMMIT');
      return;
    }
    await appendSyncEvent(
      client,
      'game',
      `${igdbGameId}::${String(platformIgdbId)}`,
      'upsert',
      updatedPayload
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function appendSyncEvent(
  client: PoolClient,
  entityType: 'game',
  entityKey: string,
  operation: 'upsert',
  payload: unknown
): Promise<void> {
  await client.query(
    `
    INSERT INTO sync_events (entity_type, entity_key, operation, payload, server_timestamp)
    VALUES ($1, $2, $3, $4::jsonb, NOW())
    `,
    [entityType, entityKey, operation, JSON.stringify(payload)]
  );
}

async function readNotificationPreferences(pool: Pool): Promise<NotificationPreferences> {
  // Current deployment model is single-user/personal server, so notification
  // settings are treated as global preferences from the shared settings table.
  // If this becomes multi-user, this read path must be scoped per user/device.
  const result = await pool.query<{ setting_key: string; setting_value: string }>(
    `
    SELECT setting_key, setting_value
    FROM settings
    WHERE setting_key = ANY($1::text[])
    `,
    [[RELEASE_NOTIFICATIONS_ENABLED_KEY, RELEASE_NOTIFICATION_EVENTS_KEY]]
  );

  const valueByKey = new Map(result.rows.map((row) => [row.setting_key, row.setting_value]));
  const enabledRaw = (valueByKey.get(RELEASE_NOTIFICATIONS_ENABLED_KEY) ?? 'false')
    .trim()
    .toLowerCase();
  const enabled = enabledRaw !== 'false' && enabledRaw !== '0' && enabledRaw !== 'no';
  const eventDefaults = { set: true, changed: true, removed: true, day: true };
  const eventsRaw = valueByKey.get(RELEASE_NOTIFICATION_EVENTS_KEY);

  if (!eventsRaw) {
    return { enabled, events: eventDefaults };
  }

  try {
    const parsed = JSON.parse(eventsRaw) as Record<string, unknown>;
    return {
      enabled,
      events: {
        set: parsed['set'] === false ? false : true,
        changed: parsed['changed'] === false ? false : true,
        removed: parsed['removed'] === false ? false : true,
        day: parsed['day'] === false ? false : true
      }
    };
  } catch {
    return { enabled, events: eventDefaults };
  }
}

function isEventEnabled(preferences: NotificationPreferences, type: ReleaseEventType): boolean {
  if (!preferences.enabled) {
    return false;
  }

  if (type === 'release_date_set') {
    return preferences.events.set;
  }

  if (type === 'release_date_changed') {
    return preferences.events.changed;
  }

  if (type === 'release_date_removed') {
    return preferences.events.removed;
  }

  return preferences.events.day;
}

function buildReleaseEvents(args: {
  igdbGameId: string;
  platformIgdbId: number;
  title: string;
  releaseBefore: ReleaseInfo;
  releaseAfter: ReleaseInfo;
  now: Date;
}): ReleaseEvent[] {
  const events: ReleaseEvent[] = [];
  const before = args.releaseBefore;
  const after = args.releaseAfter;
  const beforeKnown = before.precision !== 'unknown' && before.marker !== null;
  const afterKnown = after.precision !== 'unknown' && after.marker !== null;

  if (!beforeKnown && afterKnown) {
    const afterMarker = after.marker ?? 'unknown';
    const afterDisplay = after.display ?? afterMarker;
    events.push({
      type: 'release_date_set',
      title: `${args.title}: Release date set`,
      body: `${args.title} now has a release timing (${afterDisplay}).`,
      eventKey: `release_date_set:${args.igdbGameId}:${String(args.platformIgdbId)}:${after.precision}:${afterMarker}`,
      releaseMarker: afterMarker
    });
  }

  if (
    beforeKnown &&
    afterKnown &&
    (before.marker !== after.marker || before.precision !== after.precision)
  ) {
    const beforeMarker = before.marker ?? 'unknown';
    const afterMarker = after.marker ?? 'unknown';
    const beforeDisplay = before.display ?? beforeMarker;
    const afterDisplay = after.display ?? afterMarker;
    events.push({
      type: 'release_date_changed',
      title: `${args.title}: Release date changed`,
      body: `${args.title} moved from ${beforeDisplay} to ${afterDisplay}.`,
      eventKey: `release_date_changed:${args.igdbGameId}:${String(args.platformIgdbId)}:${before.precision}:${beforeMarker}:${after.precision}:${afterMarker}`,
      releaseMarker: afterMarker
    });
  }

  if (beforeKnown && !afterKnown) {
    const beforeMarker = before.marker ?? 'unknown';
    events.push({
      type: 'release_date_removed',
      title: `${args.title}: Release date removed`,
      body: `${args.title} no longer has a confirmed release date.`,
      eventKey: `release_date_removed:${args.igdbGameId}:${String(args.platformIgdbId)}:${before.precision}:${beforeMarker}`,
      releaseMarker: null
    });
  }

  if (
    after.precision === 'day' &&
    after.marker !== null &&
    after.marker === formatDateOnly(args.now)
  ) {
    // This can evaluate true across multiple monitor runs on release day; delivery
    // remains single-shot via event_key reservation in release_notification_log.
    events.push({
      type: 'release_day',
      title: `${args.title} releases today`,
      body: `${args.title} has reached its scheduled release date.`,
      eventKey: `release_day:${args.igdbGameId}:${String(args.platformIgdbId)}:${after.marker}`,
      releaseMarker: after.marker
    });
  }

  return events;
}

async function reserveNotificationLog(
  pool: Pool,
  event: ReleaseEvent,
  igdbGameId: string,
  platformIgdbId: number
): Promise<boolean> {
  const result = await pool.query<{ inserted: number }>(
    `
    INSERT INTO release_notification_log (event_type, igdb_game_id, platform_igdb_id, event_key, payload, sent_count)
    VALUES ($1, $2, $3, $4, $5::jsonb, 0)
    ON CONFLICT (event_key) DO NOTHING
    RETURNING 1 AS inserted
    `,
    [
      event.type,
      igdbGameId,
      platformIgdbId,
      event.eventKey,
      JSON.stringify({
        title: event.title,
        body: event.body,
        releaseDate: event.releaseMarker
      })
    ]
  );

  return (result.rowCount ?? 0) > 0;
}

async function finalizeNotificationLog(
  pool: Pool,
  event: ReleaseEvent,
  eventKey: string,
  sentCount: number
): Promise<void> {
  await pool.query(
    `
    UPDATE release_notification_log
    SET payload = $1::jsonb, sent_count = $2
    WHERE event_key = $3
    `,
    [
      JSON.stringify({
        title: event.title,
        body: event.body,
        releaseDate: event.releaseMarker
      }),
      sentCount,
      eventKey
    ]
  );
}

async function releaseNotificationLogReservation(pool: Pool, eventKey: string): Promise<void> {
  await pool.query(
    `
    DELETE FROM release_notification_log
    WHERE event_key = $1
      AND sent_count = 0
    `,
    [eventKey]
  );
}

async function withGameLock(
  pool: Pool,
  igdbGameId: string,
  platformIgdbId: number,
  handler: () => Promise<void>
): Promise<boolean> {
  const client = await pool.connect();
  let shouldDestroyClient = false;

  try {
    // Session-level advisory lock: this lock remains held on this connection
    // until explicit pg_advisory_unlock (or connection termination). We keep
    // this client checked out while handler() runs to serialize per-game work.
    const lockResult = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1), $2) AS locked',
      [igdbGameId, platformIgdbId]
    );
    const locked = lockResult.rows[0]?.locked ?? false;

    if (!locked) {
      return false;
    }

    let handlerError: Error | null = null;
    try {
      await handler();
    } catch (error) {
      handlerError = error instanceof Error ? error : new Error(String(error));
    }

    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1), $2)', [
        igdbGameId,
        platformIgdbId
      ]);
    } catch (error) {
      shouldDestroyClient = true;
      if (handlerError !== null) {
        throw handlerError;
      }
      throw error instanceof Error ? error : new Error(String(error));
    }

    if (handlerError !== null) {
      throw handlerError;
    }

    return true;
  } finally {
    client.release(shouldDestroyClient);
  }
}

async function upsertWatchState(
  pool: Pool,
  args: {
    igdbGameId: string;
    platformIgdbId: number;
    release: ReleaseInfo;
    releaseState: ReleaseState;
    lastIgdbRefreshAt: string | null;
    lastHltbRefreshAt: string | null;
    lastMetacriticRefreshAt: string | null;
    nextCheckAt: string;
    sentEventTypes: Set<ReleaseEventType>;
    releaseBefore: ReleaseInfo;
    releaseStateBefore: ReleaseState;
  }
): Promise<void> {
  const updateSetAt = args.sentEventTypes.has('release_date_set') ? new Date().toISOString() : null;
  const updateChangeAt = args.sentEventTypes.has('release_date_changed')
    ? new Date().toISOString()
    : null;
  const updateUnsetAt = args.sentEventTypes.has('release_date_removed')
    ? new Date().toISOString()
    : null;
  const updateReleaseDay =
    args.sentEventTypes.has('release_day') && args.release.date ? args.release.date : null;

  await pool.query(
    `
    INSERT INTO release_watch_state (
      igdb_game_id,
      platform_igdb_id,
      last_known_release_marker,
      last_known_release_precision,
      last_known_release_date,
      last_known_release_year,
      last_seen_state,
      last_igdb_refresh_at,
      last_hltb_refresh_at,
      last_metacritic_refresh_at,
      next_check_at,
      last_notified_set_at,
      last_notified_change_at,
      last_notified_unset_at,
      last_notified_release_day,
      last_error,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10::timestamptz, $11::timestamptz, $12::timestamptz, $13::timestamptz, $14::timestamptz, $15, NULL, NOW())
    ON CONFLICT (igdb_game_id, platform_igdb_id)
    DO UPDATE SET
      last_known_release_marker = EXCLUDED.last_known_release_marker,
      last_known_release_precision = EXCLUDED.last_known_release_precision,
      last_known_release_date = EXCLUDED.last_known_release_date,
      last_known_release_year = EXCLUDED.last_known_release_year,
      last_seen_state = EXCLUDED.last_seen_state,
      last_igdb_refresh_at = EXCLUDED.last_igdb_refresh_at,
      last_hltb_refresh_at = EXCLUDED.last_hltb_refresh_at,
      last_metacritic_refresh_at = EXCLUDED.last_metacritic_refresh_at,
      next_check_at = EXCLUDED.next_check_at,
      last_notified_set_at = COALESCE(EXCLUDED.last_notified_set_at, release_watch_state.last_notified_set_at),
      last_notified_change_at = COALESCE(EXCLUDED.last_notified_change_at, release_watch_state.last_notified_change_at),
      last_notified_unset_at = COALESCE(EXCLUDED.last_notified_unset_at, release_watch_state.last_notified_unset_at),
      last_notified_release_day = COALESCE(EXCLUDED.last_notified_release_day, release_watch_state.last_notified_release_day),
      last_error = NULL,
      updated_at = NOW()
    `,
    [
      args.igdbGameId,
      args.platformIgdbId,
      args.release.marker,
      args.release.precision,
      args.release.date,
      args.release.year,
      args.releaseState,
      args.lastIgdbRefreshAt,
      args.lastHltbRefreshAt,
      args.lastMetacriticRefreshAt,
      args.nextCheckAt,
      updateSetAt,
      updateChangeAt,
      updateUnsetAt,
      updateReleaseDay
    ]
  );

  if (config.releaseMonitorDebugLogs) {
    console.info('[release-monitor] state_updated', {
      igdbGameId: args.igdbGameId,
      platformIgdbId: args.platformIgdbId,
      releaseDateBefore: args.releaseBefore.marker,
      releaseDateAfter: args.release.marker,
      releasePrecisionBefore: args.releaseBefore.precision,
      releasePrecisionAfter: args.release.precision,
      releaseStateBefore: args.releaseStateBefore,
      releaseStateAfter: args.releaseState,
      nextCheckAt: args.nextCheckAt,
      sentEvents: [...args.sentEventTypes]
    });
  }
}

function computeNextCheckAt(
  release: ReleaseInfo,
  now: Date,
  hltbEligible: boolean,
  lastHltbRefreshAt: string | null,
  metacriticEligible: boolean,
  lastMetacriticRefreshAt: string | null
): string {
  const nowMs = now.getTime();
  let nextReleaseCheckMs = nowMs + ONE_DAY_MS;

  if (release.precision === 'unknown') {
    const currentYear = now.getUTCFullYear();
    if (release.year !== null && release.year < currentYear) {
      nextReleaseCheckMs = nowMs + 365 * ONE_DAY_MS;
    } else {
      nextReleaseCheckMs = nowMs + 7 * ONE_DAY_MS;
    }
  } else if (release.precision === 'day' && release.date) {
    const releaseMs = Date.parse(`${release.date}T00:00:00.000Z`);
    const deltaDays = Math.floor((releaseMs - nowMs) / ONE_DAY_MS);

    if (deltaDays >= 0 && deltaDays <= 30) {
      nextReleaseCheckMs = nowMs + 6 * 60 * 60 * 1000;
    } else if (deltaDays >= 31 && deltaDays <= 120) {
      nextReleaseCheckMs = nowMs + ONE_DAY_MS;
    } else if (deltaDays < 0 && Math.abs(deltaDays) <= 30) {
      nextReleaseCheckMs = nowMs + ONE_DAY_MS;
    } else {
      nextReleaseCheckMs = nowMs + 365 * ONE_DAY_MS;
    }
  } else if (release.precision === 'month' || release.precision === 'quarter') {
    const releaseMs = getReleaseInfoTimestamp(release);
    if (releaseMs !== null) {
      const deltaDays = Math.floor((releaseMs - nowMs) / ONE_DAY_MS);
      nextReleaseCheckMs = deltaDays > 0 ? nowMs + 7 * ONE_DAY_MS : nowMs + 30 * ONE_DAY_MS;
    } else {
      nextReleaseCheckMs = nowMs + 7 * ONE_DAY_MS;
    }
  } else if (release.precision === 'year') {
    const currentYear = now.getUTCFullYear();
    if (release.year !== null && release.year < currentYear) {
      nextReleaseCheckMs = nowMs + 365 * ONE_DAY_MS;
    } else {
      nextReleaseCheckMs = nowMs + 30 * ONE_DAY_MS;
    }
  }

  let nextRefreshCheckMs = Number.POSITIVE_INFINITY;
  if (hltbEligible) {
    const hltbIntervalMs = Math.max(1, config.hltbPeriodicRefreshDays) * ONE_DAY_MS;
    const hltbLastMs = lastHltbRefreshAt ? Date.parse(lastHltbRefreshAt) : Number.NaN;
    const nextHltbCheckMs = Number.isFinite(hltbLastMs) ? hltbLastMs + hltbIntervalMs : nowMs;
    nextRefreshCheckMs = Math.min(nextRefreshCheckMs, nextHltbCheckMs);
  }

  if (metacriticEligible) {
    const metacriticIntervalMs = Math.max(1, config.metacriticPeriodicRefreshDays) * ONE_DAY_MS;
    const metacriticLastMs = lastMetacriticRefreshAt
      ? Date.parse(lastMetacriticRefreshAt)
      : Number.NaN;
    const nextMetacriticCheckMs = Number.isFinite(metacriticLastMs)
      ? metacriticLastMs + metacriticIntervalMs
      : nowMs;
    nextRefreshCheckMs = Math.min(nextRefreshCheckMs, nextMetacriticCheckMs);
  }

  return new Date(Math.min(nextReleaseCheckMs, nextRefreshCheckMs)).toISOString();
}

function isHltbRefreshDue(
  lastHltbRefreshAt: string | null,
  payload: Record<string, unknown>,
  now: Date
): boolean {
  const hasHltb = hasHltbValues(payload);
  if (!hasHltb) {
    return true;
  }

  if (!lastHltbRefreshAt) {
    return true;
  }

  const refreshedAtMs = Date.parse(lastHltbRefreshAt);
  if (!Number.isFinite(refreshedAtMs)) {
    return true;
  }

  const ageMs = now.getTime() - refreshedAtMs;
  return ageMs >= Math.max(1, config.hltbPeriodicRefreshDays) * ONE_DAY_MS;
}

function hasHltbValues(payload: Record<string, unknown>): boolean {
  const hltbMainHours = payload['hltbMainHours'];
  const hltbMainExtraHours = payload['hltbMainExtraHours'];
  const hltbCompletionistHours = payload['hltbCompletionistHours'];
  const hasMainHours = typeof hltbMainHours === 'number' && Number.isFinite(hltbMainHours);
  const hasMainExtraHours =
    typeof hltbMainExtraHours === 'number' && Number.isFinite(hltbMainExtraHours);
  const hasCompletionistHours =
    typeof hltbCompletionistHours === 'number' && Number.isFinite(hltbCompletionistHours);

  return hasMainHours || hasMainExtraHours || hasCompletionistHours;
}

function isMetacriticRefreshDue(
  lastMetacriticRefreshAt: string | null,
  payload: Record<string, unknown>,
  now: Date
): boolean {
  const hasMetacritic = hasMetacriticValues(payload);
  if (!hasMetacritic) {
    return true;
  }

  if (!lastMetacriticRefreshAt) {
    return true;
  }

  const refreshedAtMs = Date.parse(lastMetacriticRefreshAt);
  if (!Number.isFinite(refreshedAtMs)) {
    return true;
  }

  const ageMs = now.getTime() - refreshedAtMs;
  return ageMs >= Math.max(1, config.metacriticPeriodicRefreshDays) * ONE_DAY_MS;
}

function hasMetacriticValues(payload: Record<string, unknown>): boolean {
  const metacriticScore = payload['metacriticScore'];
  const hasFiniteScore = typeof metacriticScore === 'number' && Number.isFinite(metacriticScore);
  return hasFiniteScore || stringOrNull(payload['metacriticUrl']) !== null;
}

function deriveReleaseState(release: ReleaseInfo, now: Date): ReleaseState {
  if (release.precision === 'unknown' || release.marker === null) {
    return 'unknown';
  }

  if (release.precision !== 'day') {
    const releaseTimestamp = getReleaseInfoTimestamp(release);
    if (releaseTimestamp === null) {
      return 'unknown';
    }

    return releaseTimestamp > now.getTime() ? 'scheduled' : 'released';
  }

  const nowDate = formatDateOnly(now);
  return release.date !== null && release.date > nowDate ? 'scheduled' : 'released';
}

function normalizeReleaseState(value: string | null): ReleaseState | null {
  if (value === 'unknown' || value === 'scheduled' || value === 'released') {
    return value;
  }

  return null;
}

function isWithinPastYears(release: ReleaseInfo, now: Date, years: number): boolean {
  if (release.precision === 'unknown' || release.marker === null) {
    return false;
  }

  const releaseMs = getReleaseInfoTimestamp(release);
  if (releaseMs === null) {
    return false;
  }

  if (!Number.isFinite(releaseMs)) {
    return false;
  }

  if (releaseMs > now.getTime()) {
    return false;
  }

  const thresholdMs = now.getTime() - Math.max(1, years) * 365 * ONE_DAY_MS;
  return releaseMs >= thresholdMs;
}

function deriveReleaseInfo(input: {
  marker: string | null;
  precision: ReleasePrecision | null;
  releaseDate: string | null;
  releaseYear: number | null;
}): ReleaseInfo {
  if (input.precision && input.precision !== 'unknown' && input.marker) {
    return normalizeReleaseInfoFromPrecision(input.precision, input.marker);
  }

  const fromDate = parseReleaseMarkerFromString(input.releaseDate);
  if (fromDate) {
    return normalizeReleaseInfoFromPrecision(fromDate.precision, fromDate.marker);
  }

  if (input.releaseYear !== null) {
    return normalizeReleaseInfoFromPrecision('year', String(input.releaseYear));
  }

  return {
    precision: 'unknown',
    marker: null,
    date: null,
    year: null,
    display: null
  };
}

function normalizeReleaseInfoFromPrecision(
  precision: ReleasePrecision,
  marker: string
): ReleaseInfo {
  const normalizedMarker = marker.trim();

  if (precision === 'day') {
    const day = normalizeDateString(normalizedMarker);
    if (day === null) {
      return {
        precision: 'unknown',
        marker: null,
        date: null,
        year: null,
        display: null
      };
    }

    return {
      precision: 'day',
      marker: day,
      date: day,
      year: integerOrNull(day.slice(0, 4)),
      display: day
    };
  }

  if (precision === 'month') {
    const monthMatch = normalizedMarker.match(/^(\d{4})-(\d{2})$/);
    if (!monthMatch) {
      return {
        precision: 'unknown',
        marker: null,
        date: null,
        year: null,
        display: null
      };
    }
    const monthValue = Number.parseInt(monthMatch[2], 10);
    if (!Number.isInteger(monthValue) || monthValue < 1 || monthValue > 12) {
      return {
        precision: 'unknown',
        marker: null,
        date: null,
        year: null,
        display: null
      };
    }

    return {
      precision: 'month',
      marker: `${monthMatch[1]}-${monthMatch[2]}`,
      date: null,
      year: integerOrNull(monthMatch[1]),
      display: `${monthMatch[1]}-${monthMatch[2]}`
    };
  }

  if (precision === 'quarter') {
    const quarterMatch = normalizedMarker.match(/^(\d{4})-Q([1-4])$/i);
    if (!quarterMatch) {
      return {
        precision: 'unknown',
        marker: null,
        date: null,
        year: null,
        display: null
      };
    }

    const year = quarterMatch[1];
    const quarter = quarterMatch[2];
    return {
      precision: 'quarter',
      marker: `${year}-Q${quarter}`,
      date: null,
      year: integerOrNull(year),
      display: `Q${quarter} ${year}`
    };
  }

  if (precision === 'year') {
    const yearMatch = normalizedMarker.match(/^(\d{4})$/);
    if (!yearMatch) {
      return {
        precision: 'unknown',
        marker: null,
        date: null,
        year: null,
        display: null
      };
    }

    return {
      precision: 'year',
      marker: yearMatch[1],
      date: null,
      year: integerOrNull(yearMatch[1]),
      display: yearMatch[1]
    };
  }

  return {
    precision: 'unknown',
    marker: null,
    date: null,
    year: null,
    display: null
  };
}

function parseReleaseMarkerFromString(value: string | null): {
  precision: ReleasePrecision;
  marker: string;
} | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return null;
  }

  const day = normalizeDateString(normalized);
  if (day !== null) {
    return { precision: 'day', marker: day };
  }

  const monthMatch = normalized.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    return { precision: 'month', marker: `${monthMatch[1]}-${monthMatch[2]}` };
  }

  const quarterMatch = normalized.match(/^(\d{4})-Q([1-4])$/i);
  if (quarterMatch) {
    return { precision: 'quarter', marker: `${quarterMatch[1]}-Q${quarterMatch[2]}` };
  }

  const yearMatch = normalized.match(/^(\d{4})$/);
  if (yearMatch) {
    return { precision: 'year', marker: yearMatch[1] };
  }

  const quarterNaturalMatch = normalized.match(/^Q([1-4])\s+(\d{4})$/i);
  if (quarterNaturalMatch) {
    return { precision: 'quarter', marker: `${quarterNaturalMatch[2]}-Q${quarterNaturalMatch[1]}` };
  }

  return null;
}

function getReleaseInfoTimestamp(release: ReleaseInfo): number | null {
  if (release.precision === 'day' && release.date) {
    const ms = Date.parse(`${release.date}T00:00:00.000Z`);
    return Number.isFinite(ms) ? ms : null;
  }

  if (release.precision === 'month' && release.marker) {
    const ms = Date.parse(`${release.marker}-01T00:00:00.000Z`);
    return Number.isFinite(ms) ? ms : null;
  }

  if (release.precision === 'quarter' && release.marker) {
    const match = release.marker.match(/^(\d{4})-Q([1-4])$/i);
    if (!match) {
      return null;
    }

    const year = Number.parseInt(match[1], 10);
    const quarter = Number.parseInt(match[2], 10);
    const month = quarter * 3 - 2;
    const monthLabel = String(month).padStart(2, '0');
    const ms = Date.parse(`${String(year)}-${monthLabel}-01T00:00:00.000Z`);
    return Number.isFinite(ms) ? ms : null;
  }

  if (release.precision === 'year' && release.year !== null) {
    const ms = Date.parse(`${String(release.year)}-01-01T00:00:00.000Z`);
    return Number.isFinite(ms) ? ms : null;
  }

  return null;
}

function normalizeReleasePrecision(value: string | null): ReleasePrecision | null {
  if (
    value === 'unknown' ||
    value === 'year' ||
    value === 'quarter' ||
    value === 'month' ||
    value === 'day'
  ) {
    return value;
  }

  return null;
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeDateString(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';

  const isoPrefixMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/);
  if (!isoPrefixMatch) {
    return null;
  }

  return isoPrefixMatch[1];
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function stringOrFallback(value: unknown, fallback: string): string {
  return stringOrNull(value) ?? fallback;
}

function integerOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function isProviderMatchLocked(payload: Record<string, unknown>, key: string): boolean {
  return payload[key] === true;
}

function finiteNumberOrStringOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeReviewScore(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0 || value > 100) {
    return null;
  }
  return Math.round(value * 10) / 10;
}

function normalizeRawMobyScore(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0 || value > 10) {
    return null;
  }
  return Math.round(value * 10) / 10;
}

function arrayOfStringsOrEmpty(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildPayloadPatch(
  current: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, nextValue] of Object.entries(next)) {
    const currentValue = current[key];
    if (!isJsonEqual({ v: currentValue }, { v: nextValue })) {
      patch[key] = nextValue;
    }
  }
  return patch;
}

function createMonitorRunStats(): MonitorRunStats {
  return {
    startedAtIso: new Date().toISOString(),
    dueGames: 0,
    activeTokensAtStart: 0,
    processedWithLock: 0,
    lockSkipped: 0,
    gameFailures: 0,
    igdbRefreshAttempts: 0,
    igdbRefreshSuccesses: 0,
    hltbRefreshAttempts: 0,
    hltbRefreshSuccesses: 0,
    metacriticRefreshAttempts: 0,
    metacriticRefreshSuccesses: 0,
    eventsConsidered: 0,
    eventsDisabled: 0,
    eventsReleaseDayAlreadyNotified: 0,
    eventsSkippedNoTokens: 0,
    eventsSkippedDuplicate: 0,
    eventsReserved: 0,
    sendAttempts: 0,
    sendBatchSuccess: 0,
    sendBatchFailure: 0,
    sendNoSuccessReservationsReleased: 0,
    eventsSent: 0,
    invalidTokensDeactivated: 0,
    tokenCleanupRan: false,
    tokensDeactivatedByCleanup: 0,
    tokensPrunedByCleanup: 0
  };
}

async function loadActiveTokenSet(pool: Pool): Promise<Set<string>> {
  const activeTokenSet = new Set<string>();
  const pageSize = 1000;
  let cursor: string | null = null;
  let capped = false;

  for (;;) {
    let rows: Array<{ token: string }>;
    if (cursor === null) {
      const result = await pool.query<{ token: string }>(
        `
        SELECT token
        FROM fcm_tokens
        WHERE is_active = TRUE
        ORDER BY token ASC
        LIMIT $1
        `,
        [pageSize]
      );
      rows = result.rows;
    } else {
      const result = await pool.query<{ token: string }>(
        `
        SELECT token
        FROM fcm_tokens
        WHERE is_active = TRUE
          AND token > $1
        ORDER BY token ASC
        LIMIT $2
        `,
        [cursor, pageSize]
      );
      rows = result.rows;
    }

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      if (activeTokenSet.size >= MAX_ACTIVE_TOKENS_PER_RUN) {
        capped = true;
        break;
      }
      activeTokenSet.add(row.token);
    }

    if (capped) {
      break;
    }

    const lastToken = rows[rows.length - 1]?.token;
    if (typeof lastToken !== 'string' || rows.length < pageSize) {
      break;
    }

    cursor = lastToken;
  }

  if (capped) {
    console.warn('[release-monitor] active_tokens_capped', {
      maxActiveTokensPerRun: MAX_ACTIVE_TOKENS_PER_RUN,
      loadedActiveTokens: activeTokenSet.size
    });
  }

  return activeTokenSet;
}

function emitRunSummary(stats: MonitorRunStats): void {
  const shouldLog =
    config.releaseMonitorDebugLogs ||
    stats.dueGames > 0 ||
    stats.tokenCleanupRan ||
    stats.eventsSent > 0 ||
    stats.gameFailures > 0;

  if (!shouldLog) {
    return;
  }

  console.info('[release-monitor] run_summary', stats);

  const healthWarnings = evaluateRunHealth(stats);
  healthWarnings.forEach((warning) => {
    console.warn('[release-monitor] run_health_warning', warning);
  });
}

async function runFcmTokenCleanupIfDue(
  pool: Pool,
  stats: MonitorRunStats,
  runtimeState: MonitorRuntimeState
): Promise<void> {
  if (!config.fcmTokenCleanupEnabled) {
    return;
  }

  const nowMs = Date.now();
  if (nowMs < runtimeState.nextFcmTokenCleanupAtMs) {
    return;
  }

  runtimeState.nextFcmTokenCleanupAtMs =
    nowMs + Math.max(1, config.fcmTokenCleanupIntervalHours) * 60 * 60 * 1000;

  try {
    const staleDeactivateResult = await pool.query(
      `
      UPDATE fcm_tokens
      SET is_active = FALSE, updated_at = NOW()
      WHERE is_active = TRUE
        AND last_seen_at < NOW() - ($1::int * INTERVAL '1 day')
      `,
      [config.fcmTokenStaleDeactivateDays]
    );
    const pruneResult = await pool.query(
      `
      DELETE FROM fcm_tokens
      WHERE is_active = FALSE
        AND updated_at < NOW() - ($1::int * INTERVAL '1 day')
      `,
      [config.fcmTokenInactivePurgeDays]
    );

    stats.tokenCleanupRan = true;
    stats.tokensDeactivatedByCleanup = staleDeactivateResult.rowCount ?? 0;
    stats.tokensPrunedByCleanup = pruneResult.rowCount ?? 0;
  } catch (error) {
    console.warn('[release-monitor] token_cleanup_failed', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function createMonitorRuntimeState(): MonitorRuntimeState {
  return {
    nextFcmTokenCleanupAtMs: 0
  };
}

function evaluateRunHealth(stats: MonitorRunStats): Array<{ code: string; detail: string }> {
  const warnings: Array<{ code: string; detail: string }> = [];
  const totalSendResponses = stats.sendBatchSuccess + stats.sendBatchFailure;
  const sendFailureRatio = totalSendResponses > 0 ? stats.sendBatchFailure / totalSendResponses : 0;
  if (
    totalSendResponses > 0 &&
    sendFailureRatio >= Math.max(0, config.releaseMonitorWarnSendFailureRatio)
  ) {
    warnings.push({
      code: 'send_failure_ratio_high',
      detail: `failure_ratio=${sendFailureRatio.toFixed(3)} threshold=${config.releaseMonitorWarnSendFailureRatio.toFixed(3)}`
    });
  }

  const invalidRatio =
    stats.sendBatchSuccess > 0 ? stats.invalidTokensDeactivated / stats.sendBatchSuccess : 0;
  if (
    stats.sendBatchSuccess > 0 &&
    invalidRatio >= Math.max(0, config.releaseMonitorWarnInvalidTokenRatio)
  ) {
    warnings.push({
      code: 'invalid_token_ratio_high',
      detail: `invalid_ratio=${invalidRatio.toFixed(3)} threshold=${config.releaseMonitorWarnInvalidTokenRatio.toFixed(3)}`
    });
  }

  if (stats.gameFailures > 0) {
    warnings.push({
      code: 'game_failures_present',
      detail: `game_failures=${String(stats.gameFailures)}`
    });
  }

  return warnings;
}

export const releaseMonitorInternals = {
  processDueGames,
  processGameRow,
  enqueueReleaseMonitorGameJob,
  processQueuedReleaseMonitorGame,
  buildReleaseEvents,
  computeNextCheckAt,
  deriveReleaseState,
  deriveReleaseInfo,
  normalizeReleaseInfoFromPrecision,
  parseReleaseMarkerFromString,
  getReleaseInfoTimestamp,
  normalizeReleasePrecision,
  isWithinPastYears,
  isHltbRefreshDue,
  hasHltbValues,
  isMetacriticRefreshDue,
  hasMetacriticValues,
  isProviderMatchLocked,
  finiteNumberOrNull,
  numberOrNull,
  normalizeDateString,
  resolveHltbRefreshQuery,
  resolveReviewRefreshQuery,
  mergeReviewRefreshPayload,
  mergeMetacriticRefreshPayload,
  mergeMobygamesRefreshPayload,
  readNotificationPreferences,
  reserveNotificationLog,
  finalizeNotificationLog,
  releaseNotificationLogReservation,
  withGameLock,
  runFcmTokenCleanupIfDue,
  createMonitorRuntimeState,
  evaluateRunHealth,
  loadActiveTokenSet,
  clearQueuedGameContextCache
};
