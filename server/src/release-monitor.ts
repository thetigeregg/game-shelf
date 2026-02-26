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

interface DueGameRow {
  igdb_game_id: string;
  platform_igdb_id: number;
  payload: Record<string, unknown> | null;
  watch_exists: boolean;
  last_known_release_date: string | null;
  last_known_release_year: number | null;
  last_seen_state: string | null;
  last_hltb_refresh_at: string | null;
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
  releaseDate: string | null;
}

interface MonitorStartResult {
  stop: () => void;
}

export function startReleaseMonitor(pool: Pool): MonitorStartResult {
  if (!config.releaseMonitorEnabled) {
    console.info('[release-monitor] disabled');
    return { stop: () => undefined };
  }

  let running = false;

  const runOnce = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;
    try {
      await processDueGames(pool);
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

async function processDueGames(pool: Pool): Promise<void> {
  const dueRows = await pool.query<DueGameRow>(
    `
    SELECT
      g.igdb_game_id,
      g.platform_igdb_id,
      g.payload,
      (rws.igdb_game_id IS NOT NULL) AS watch_exists,
      rws.last_known_release_date,
      rws.last_known_release_year,
      rws.last_seen_state,
      rws.last_hltb_refresh_at,
      rws.last_notified_release_day
    FROM games g
    LEFT JOIN release_watch_state rws
      ON rws.igdb_game_id = g.igdb_game_id AND rws.platform_igdb_id = g.platform_igdb_id
    WHERE COALESCE(rws.next_check_at, NOW()) <= NOW()
    ORDER BY COALESCE(rws.next_check_at, NOW()) ASC
    LIMIT $1
    `,
    [config.releaseMonitorBatchSize]
  );

  if (dueRows.rows.length === 0) {
    return;
  }

  const preferences = await readNotificationPreferences(pool);
  const tokenRows = await pool.query<{ token: string }>(
    'SELECT token FROM fcm_tokens WHERE is_active = TRUE'
  );
  const activeTokens = tokenRows.rows.map((row) => row.token);

  for (const row of dueRows.rows) {
    await processGameRow(pool, row, preferences, activeTokens);
  }
}

async function processGameRow(
  pool: Pool,
  row: DueGameRow,
  preferences: NotificationPreferences,
  activeTokens: string[]
): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const originalPayload = row.payload ?? {};
  const isBootstrap = !row.watch_exists;
  let mergedPayload = originalPayload;
  const title = stringOrFallback(originalPayload['title'], 'Unknown title');
  const platformName = stringOrNull(originalPayload['platform']);
  const platformIgdbId = row.platform_igdb_id;
  const releaseDateBefore = normalizeDateString(
    row.last_known_release_date ?? stringOrNull(originalPayload['releaseDate'])
  );
  const releaseYearBefore = integerOrNull(
    row.last_known_release_year ?? originalPayload['releaseYear']
  );

  let lastHltbRefreshAt = row.last_hltb_refresh_at;

  try {
    if (!isBootstrap) {
      const refreshed = await fetchGameById(row.igdb_game_id);
      if (refreshed) {
        mergedPayload = mergePayloadForRefresh(originalPayload, refreshed);
      }
    }

    const releaseDateAfter = normalizeDateString(stringOrNull(mergedPayload['releaseDate']));
    const releaseYearAfter = integerOrNull(mergedPayload['releaseYear']);
    const releaseStateAfter = deriveReleaseState(releaseDateAfter, now);
    const releaseStateBefore =
      normalizeReleaseState(row.last_seen_state) ?? deriveReleaseState(releaseDateBefore, now);
    const hltbEligible = isWithinPastYears(releaseDateAfter, now, config.hltbPeriodicRefreshYears);
    const hasExistingHltb = hasHltbValues(mergedPayload);

    if (isBootstrap && hasExistingHltb && hltbEligible) {
      // Seed periodic timer from existing library metadata to avoid immediate re-scrape flood.
      lastHltbRefreshAt = nowIso;
    }

    const hltbDue = !isBootstrap && isHltbRefreshDue(lastHltbRefreshAt, mergedPayload, now);

    if (hltbEligible && hltbDue) {
      const refreshedHltb = await fetchHltbPayload({
        title: stringOrFallback(mergedPayload['title'], title),
        releaseYear: integerOrNull(mergedPayload['releaseYear']),
        platform: stringOrNull(mergedPayload['platform']) ?? platformName
      });

      if (refreshedHltb) {
        mergedPayload = {
          ...mergedPayload,
          hltbMainHours: numberOrNull(refreshedHltb.hltbMainHours),
          hltbMainExtraHours: numberOrNull(refreshedHltb.hltbMainExtraHours),
          hltbCompletionistHours: numberOrNull(refreshedHltb.hltbCompletionistHours)
        };
      }
      lastHltbRefreshAt = nowIso;
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
          releaseDateBefore,
          releaseDateAfter,
          now
        });

    const sentEventTypes = new Set<ReleaseEventType>();
    const lastNotifiedReleaseDay = normalizeDateString(row.last_notified_release_day);

    for (const event of releaseEvents) {
      if (!isEventEnabled(preferences, event.type)) {
        continue;
      }

      const shouldSkipReleaseDay =
        event.type === 'release_day' &&
        lastNotifiedReleaseDay === normalizeDateString(event.releaseDate);
      if (shouldSkipReleaseDay) {
        continue;
      }

      const alreadyLogged = await hasNotificationLog(pool, event.eventKey);
      if (alreadyLogged) {
        continue;
      }

      if (activeTokens.length === 0) {
        continue;
      }

      const sendResult = await sendFcmMulticast(activeTokens, {
        title: event.title,
        body: event.body,
        data: {
          eventType: event.type,
          eventKey: event.eventKey,
          igdbGameId: row.igdb_game_id,
          platformIgdbId: String(platformIgdbId),
          releaseDate: event.releaseDate ?? '',
          route: '/tabs/wishlist'
        }
      });

      if (sendResult.successCount <= 0) {
        continue;
      }

      sentEventTypes.add(event.type);

      await insertNotificationLog(
        pool,
        event,
        row.igdb_game_id,
        platformIgdbId,
        sendResult.successCount
      );

      if (sendResult.invalidTokens.length > 0) {
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

    const nextCheckAt = computeNextCheckAt(releaseDateAfter, now, hltbEligible, lastHltbRefreshAt);
    await upsertWatchState(pool, {
      igdbGameId: row.igdb_game_id,
      platformIgdbId,
      releaseDate: releaseDateAfter,
      releaseYear: releaseYearAfter,
      releaseState: releaseStateAfter,
      lastIgdRefreshAt: isBootstrap ? null : nowIso,
      lastHltbRefreshAt,
      nextCheckAt,
      sentEventTypes,
      releaseDateBefore,
      releaseStateBefore
    });
  } catch (error) {
    const nextCheckAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
    await pool.query(
      `
      INSERT INTO release_watch_state (
        igdb_game_id,
        platform_igdb_id,
        last_known_release_date,
        last_known_release_year,
        last_seen_state,
        next_check_at,
        last_error,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, NOW())
      ON CONFLICT (igdb_game_id, platform_igdb_id)
      DO UPDATE SET
        next_check_at = EXCLUDED.next_check_at,
        last_error = EXCLUDED.last_error,
        updated_at = NOW()
      `,
      [
        row.igdb_game_id,
        row.platform_igdb_id,
        releaseDateBefore,
        releaseYearBefore,
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
  const enabledRaw = (valueByKey.get(RELEASE_NOTIFICATIONS_ENABLED_KEY) ?? 'true')
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
  releaseDateBefore: string | null;
  releaseDateAfter: string | null;
  now: Date;
}): ReleaseEvent[] {
  const events: ReleaseEvent[] = [];
  const before = args.releaseDateBefore;
  const after = args.releaseDateAfter;

  if (before === null && after !== null) {
    events.push({
      type: 'release_date_set',
      title: `${args.title}: Release date set`,
      body: `${args.title} now has a release date (${after}).`,
      eventKey: `release_date_set:${args.igdbGameId}:${String(args.platformIgdbId)}:${after}`,
      releaseDate: after
    });
  }

  if (before !== null && after !== null && before !== after) {
    events.push({
      type: 'release_date_changed',
      title: `${args.title}: Release date changed`,
      body: `${args.title} moved from ${before} to ${after}.`,
      eventKey: `release_date_changed:${args.igdbGameId}:${String(args.platformIgdbId)}:${before}:${after}`,
      releaseDate: after
    });
  }

  if (before !== null && after === null) {
    events.push({
      type: 'release_date_removed',
      title: `${args.title}: Release date removed`,
      body: `${args.title} no longer has a confirmed release date.`,
      eventKey: `release_date_removed:${args.igdbGameId}:${String(args.platformIgdbId)}:${before}`,
      releaseDate: null
    });
  }

  if (after !== null && after === formatDateOnly(args.now)) {
    events.push({
      type: 'release_day',
      title: `${args.title} releases today`,
      body: `${args.title} has reached its scheduled release date.`,
      eventKey: `release_day:${args.igdbGameId}:${String(args.platformIgdbId)}:${after}`,
      releaseDate: after
    });
  }

  return events;
}

async function hasNotificationLog(pool: Pool, eventKey: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    'SELECT EXISTS(SELECT 1 FROM release_notification_log WHERE event_key = $1) AS exists',
    [eventKey]
  );

  return result.rows[0]?.exists ?? false;
}

async function insertNotificationLog(
  pool: Pool,
  event: ReleaseEvent,
  igdbGameId: string,
  platformIgdbId: number,
  sentCount: number
): Promise<boolean> {
  try {
    await pool.query(
      `
      INSERT INTO release_notification_log (event_type, igdb_game_id, platform_igdb_id, event_key, payload, sent_count)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      `,
      [
        event.type,
        igdbGameId,
        platformIgdbId,
        event.eventKey,
        JSON.stringify({
          title: event.title,
          body: event.body,
          releaseDate: event.releaseDate
        }),
        sentCount
      ]
    );
    return true;
  } catch {
    return false;
  }
}

async function upsertWatchState(
  pool: Pool,
  args: {
    igdbGameId: string;
    platformIgdbId: number;
    releaseDate: string | null;
    releaseYear: number | null;
    releaseState: ReleaseState;
    lastIgdRefreshAt: string | null;
    lastHltbRefreshAt: string | null;
    nextCheckAt: string;
    sentEventTypes: Set<ReleaseEventType>;
    releaseDateBefore: string | null;
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
    args.sentEventTypes.has('release_day') && args.releaseDate ? args.releaseDate : null;

  await pool.query(
    `
    INSERT INTO release_watch_state (
      igdb_game_id,
      platform_igdb_id,
      last_known_release_date,
      last_known_release_year,
      last_seen_state,
      last_igdb_refresh_at,
      last_hltb_refresh_at,
      next_check_at,
      last_notified_set_at,
      last_notified_change_at,
      last_notified_unset_at,
      last_notified_release_day,
      last_error,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9::timestamptz, $10::timestamptz, $11::timestamptz, $12, NULL, NOW())
    ON CONFLICT (igdb_game_id, platform_igdb_id)
    DO UPDATE SET
      last_known_release_date = EXCLUDED.last_known_release_date,
      last_known_release_year = EXCLUDED.last_known_release_year,
      last_seen_state = EXCLUDED.last_seen_state,
      last_igdb_refresh_at = EXCLUDED.last_igdb_refresh_at,
      last_hltb_refresh_at = EXCLUDED.last_hltb_refresh_at,
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
      args.releaseDate,
      args.releaseYear,
      args.releaseState,
      args.lastIgdRefreshAt,
      args.lastHltbRefreshAt,
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
      releaseDateBefore: args.releaseDateBefore,
      releaseDateAfter: args.releaseDate,
      releaseStateBefore: args.releaseStateBefore,
      releaseStateAfter: args.releaseState,
      nextCheckAt: args.nextCheckAt,
      sentEvents: [...args.sentEventTypes]
    });
  }
}

function computeNextCheckAt(
  releaseDate: string | null,
  now: Date,
  hltbEligible: boolean,
  lastHltbRefreshAt: string | null
): string {
  const nowMs = now.getTime();
  let nextReleaseCheckMs = nowMs + ONE_DAY_MS;

  if (releaseDate === null) {
    nextReleaseCheckMs = nowMs + ONE_DAY_MS;
  } else {
    const releaseMs = Date.parse(`${releaseDate}T00:00:00.000Z`);
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
  }

  if (!hltbEligible) {
    return new Date(nextReleaseCheckMs).toISOString();
  }

  const hltbIntervalMs = Math.max(1, config.hltbPeriodicRefreshDays) * ONE_DAY_MS;
  const hltbLastMs = lastHltbRefreshAt ? Date.parse(lastHltbRefreshAt) : Number.NaN;
  const nextHltbCheckMs = Number.isFinite(hltbLastMs) ? hltbLastMs + hltbIntervalMs : nowMs;

  return new Date(Math.min(nextReleaseCheckMs, nextHltbCheckMs)).toISOString();
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

function deriveReleaseState(releaseDate: string | null, now: Date): ReleaseState {
  if (releaseDate === null) {
    return 'unknown';
  }

  const nowDate = formatDateOnly(now);
  return releaseDate > nowDate ? 'scheduled' : 'released';
}

function normalizeReleaseState(value: string | null): ReleaseState | null {
  if (value === 'unknown' || value === 'scheduled' || value === 'released') {
    return value;
  }

  return null;
}

function isWithinPastYears(releaseDate: string | null, now: Date, years: number): boolean {
  if (!releaseDate) {
    return false;
  }

  const releaseMs = Date.parse(`${releaseDate}T00:00:00.000Z`);
  if (!Number.isFinite(releaseMs)) {
    return false;
  }

  const thresholdMs = now.getTime() - Math.max(1, years) * 365 * ONE_DAY_MS;
  return releaseMs >= thresholdMs;
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeDateString(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  return normalized;
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
