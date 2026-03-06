import type { Pool, PoolClient } from 'pg';
import { config } from './config.js';
import { sendFcmMulticast } from './fcm.js';
import { fetchMetadataPathFromWorker } from './metadata.js';

const RELEASE_NOTIFICATIONS_ENABLED_KEY = 'game-shelf:notifications:release:enabled';
const RELEASE_NOTIFICATION_EVENTS_KEY = 'game-shelf:notifications:release:events';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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
  stop: () => void;
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

export function startReleaseMonitor(pool: Pool): MonitorStartResult {
  if (!config.releaseMonitorEnabled) {
    console.info('[release-monitor] disabled');
    return { stop: () => undefined };
  }

  let running = false;
  const runtimeState = createMonitorRuntimeState();

  const runOnce = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;
    try {
      await processDueGames(pool, runtimeState);
    } catch (error) {
      console.error('[release-monitor] run_failed', error);
    } finally {
      running = false;
    }
  };

  void runOnce();
  const intervalMs = Math.max(30, config.releaseMonitorIntervalSeconds) * 1000;
  const timer = setInterval(() => {
    void runOnce();
  }, intervalMs);

  return {
    stop: () => {
      clearInterval(timer);
    }
  };
}

async function processDueGames(pool: Pool, runtimeState: MonitorRuntimeState): Promise<void> {
  const stats = createMonitorRunStats();
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

  const preferences = await readNotificationPreferences(pool);
  const activeTokenSet = await loadActiveTokenSet(pool);
  stats.activeTokensAtStart = activeTokenSet.size;

  for (const row of dueRows.rows) {
    const locked = await withGameLock(pool, row.igdb_game_id, row.platform_igdb_id, async () => {
      await processGameRow(pool, row, preferences, activeTokenSet, stats);
    });
    if (locked) {
      stats.processedWithLock += 1;
    } else {
      stats.lockSkipped += 1;
    }
  }

  emitRunSummary(stats);
}

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
      }
    }

    const releaseAfter = deriveReleaseInfo({
      marker: null,
      precision: null,
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

    const hltbDue = !isBootstrap && isHltbRefreshDue(lastHltbRefreshAt, mergedPayload, now);
    const metacriticDue =
      !isBootstrap && isMetacriticRefreshDue(lastMetacriticRefreshAt, mergedPayload, now);

    if (hltbEligible && hltbDue) {
      stats.hltbRefreshAttempts += 1;
      const refreshedHltb = await fetchHltbPayload({
        title: stringOrFallback(mergedPayload['title'], title),
        releaseYear: integerOrNull(mergedPayload['releaseYear']),
        platform: stringOrNull(mergedPayload['platform']) ?? platformName
      });

      if (refreshedHltb) {
        stats.hltbRefreshSuccesses += 1;
        mergedPayload = {
          ...mergedPayload,
          hltbMainHours: numberOrNull(refreshedHltb.hltbMainHours),
          hltbMainExtraHours: numberOrNull(refreshedHltb.hltbMainExtraHours),
          hltbCompletionistHours: numberOrNull(refreshedHltb.hltbCompletionistHours)
        };
      }
      lastHltbRefreshAt = nowIso;
    }

    if (metacriticEligible && metacriticDue) {
      stats.metacriticRefreshAttempts += 1;
      const refreshedMetacritic = await fetchMetacriticPayload({
        title: stringOrFallback(mergedPayload['title'], title),
        releaseYear: integerOrNull(mergedPayload['releaseYear']),
        platform: stringOrNull(mergedPayload['platform']) ?? platformName,
        platformIgdbId
      });

      if (refreshedMetacritic) {
        stats.metacriticRefreshSuccesses += 1;
        mergedPayload = {
          ...mergedPayload,
          metacriticScore: integerOrNull(refreshedMetacritic.metacriticScore),
          metacriticUrl: stringOrNull(refreshedMetacritic.metacriticUrl),
          reviewScore: integerOrNull(refreshedMetacritic.metacriticScore),
          reviewUrl: stringOrNull(refreshedMetacritic.metacriticUrl),
          reviewSource: 'metacritic'
        };
      }
      lastMetacriticRefreshAt = nowIso;
    }

    if (!isJsonEqual(originalPayload, mergedPayload)) {
      await upsertGamePayload(pool, row.igdb_game_id, platformIgdbId, mergedPayload);
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
    releaseYear: integerOrNull(refreshed['releaseYear']),
    updatedAt: new Date().toISOString()
  };
}

async function upsertGamePayload(
  pool: Pool,
  igdbGameId: string,
  platformIgdbId: number,
  payload: Record<string, unknown>
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `
      INSERT INTO games (igdb_game_id, platform_igdb_id, payload, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (igdb_game_id, platform_igdb_id)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      `,
      [igdbGameId, platformIgdbId, JSON.stringify(payload)]
    );
    await appendSyncEvent(
      client,
      'game',
      `${igdbGameId}::${String(platformIgdbId)}`,
      'upsert',
      payload
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

  return result.rowCount > 0 && (result.rows[0]?.inserted ?? 0) === 1;
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
    const lockResult = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1), $2) AS locked',
      [igdbGameId, platformIgdbId]
    );
    const locked = lockResult.rows[0]?.locked ?? false;

    if (!locked) {
      return false;
    }

    try {
      await handler();
      return true;
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1), $2)', [
          igdbGameId,
          platformIgdbId
        ]);
      } catch (error) {
        shouldDestroyClient = true;
        throw error;
      }
    }
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
  return (
    numberOrNull(payload['hltbMainHours']) !== null ||
    numberOrNull(payload['hltbMainExtraHours']) !== null ||
    numberOrNull(payload['hltbCompletionistHours']) !== null
  );
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
  return (
    integerOrNull(payload['metacriticScore']) !== null ||
    stringOrNull(payload['metacriticUrl']) !== null
  );
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

    rows.forEach((row) => {
      activeTokenSet.add(row.token);
    });

    const lastToken = rows[rows.length - 1]?.token;
    if (typeof lastToken !== 'string' || rows.length < pageSize) {
      break;
    }

    cursor = lastToken;
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
  normalizeDateString,
  readNotificationPreferences,
  reserveNotificationLog,
  finalizeNotificationLog,
  releaseNotificationLogReservation,
  withGameLock,
  runFcmTokenCleanupIfDue,
  createMonitorRuntimeState,
  evaluateRunHealth
};
