import type { Pool } from 'pg';
import { sendFcmMulticast, type FcmSendResult } from './fcm.js';
import { buildReleaseEventBody } from './release-monitor.js';
import {
  MAX_ACTIVE_TOKENS_PER_RUN,
  RELEASE_NOTIFICATION_EVENTS_KEY,
  RELEASE_NOTIFICATIONS_ENABLED_KEY,
} from './notification-constants.js';
import { coercePreferenceBoolean } from './preference-bool.js';

const COMPAT_STATUS_LABELS: Record<string, string> = {
  perfect: 'Perfect',
  playable: 'Playable',
  incomplete: 'Incomplete',
};

interface NotificationPreferences {
  enabled: boolean;
  events: {
    compatibilityChanged: boolean;
  };
}

interface CompatStatusNotificationEvent {
  type: 'compat_status_changed';
  title: string;
  body: string;
  eventKey: string;
  payload: {
    previousStatus: string | null;
    nextStatus: string;
  };
}

interface MaybeSendCompatStatusNotificationParams {
  igdbGameId: string;
  platformIgdbId: number;
  title: string;
  platformDisplayName: string;
  previousStatus: string | null;
  nextStatus: string;
}

interface MaybeSendCompatStatusNotificationOptions {
  activeTokens?: Iterable<string>;
  sendMulticast?: (
    tokens: string[],
    payload: { title: string; body: string; data: Record<string, string> }
  ) => Promise<FcmSendResult>;
}

export async function maybeSendCompatibilityStatusNotification(
  pool: Pool,
  params: MaybeSendCompatStatusNotificationParams,
  options: MaybeSendCompatStatusNotificationOptions = {}
): Promise<void> {
  if (params.previousStatus === params.nextStatus) {
    return;
  }

  const preferences = await readNotificationPreferences(pool);
  if (!preferences.enabled || !preferences.events.compatibilityChanged) {
    return;
  }

  const event = buildCompatStatusNotificationEvent(params);

  const reserved = await reserveNotificationLog(
    pool,
    event,
    params.igdbGameId,
    params.platformIgdbId
  );
  if (!reserved) {
    return;
  }

  const sendMulticast = options.sendMulticast ?? sendFcmMulticast;
  let sendResult: FcmSendResult | null = null;
  try {
    const activeTokenSet =
      options.activeTokens !== undefined
        ? (() => {
            const set = new Set<string>();
            for (const rawToken of options.activeTokens) {
              const token = normalizeNonEmptyString(rawToken);
              if (token !== null) {
                set.add(token);
              }
            }
            return set;
          })()
        : await loadActiveTokenSet(pool);
    if (activeTokenSet.size === 0) {
      await releaseNotificationLogReservation(pool, event.eventKey);
      return;
    }

    sendResult = await sendMulticast([...activeTokenSet], {
      title: event.title,
      body: event.body,
      data: {
        eventType: event.type,
        eventKey: event.eventKey,
        route: '/tabs/collection',
        igdbGameId: params.igdbGameId,
        platformIgdbId: String(params.platformIgdbId),
        previousStatus: event.payload.previousStatus ?? '',
        nextStatus: event.payload.nextStatus,
      },
    });

    if (sendResult.successCount <= 0) {
      await deactivateInvalidTokensBestEffort(pool, sendResult.invalidTokens, event.eventKey);
      await releaseNotificationLogReservation(pool, event.eventKey);
      return;
    }

    await finalizeNotificationLog(pool, event, sendResult.successCount);
    await deactivateInvalidTokensBestEffort(pool, sendResult.invalidTokens, event.eventKey);
  } catch (error) {
    const sentCount = sendResult?.successCount ?? 0;
    if (sentCount <= 0) {
      await releaseNotificationLogReservation(pool, event.eventKey);
    } else {
      console.error('[compat-status-notifications] post_send_persistence_failed', {
        eventKey: event.eventKey,
        successCount: sentCount,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

async function deactivateInvalidTokensBestEffort(
  pool: Pool,
  invalidTokens: string[],
  eventKey: string
): Promise<void> {
  if (invalidTokens.length === 0) {
    return;
  }

  try {
    await pool.query(
      `
      UPDATE fcm_tokens
      SET is_active = FALSE, updated_at = NOW()
      WHERE token = ANY($1::text[])
      `,
      [invalidTokens]
    );
  } catch (error) {
    console.error('[compat-status-notifications] invalid_token_deactivation_failed', {
      eventKey,
      invalidTokenCount: invalidTokens.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildCompatStatusNotificationEvent(
  params: MaybeSendCompatStatusNotificationParams
): CompatStatusNotificationEvent {
  const nextLabel = COMPAT_STATUS_LABELS[params.nextStatus] ?? params.nextStatus;
  const detail =
    params.previousStatus !== null
      ? `${params.platformDisplayName}: ${COMPAT_STATUS_LABELS[params.previousStatus] ?? params.previousStatus} -> ${nextLabel}.`
      : `${params.platformDisplayName}: ${nextLabel}.`;

  const dayBucket = new Date().toISOString().slice(0, 10);
  const eventKey = [
    'compat_status_changed',
    params.igdbGameId,
    String(params.platformIgdbId),
    params.previousStatus ?? 'none',
    params.nextStatus,
    dayBucket,
  ].join(':');

  return {
    type: 'compat_status_changed',
    title: 'Compatibility updated',
    body: buildReleaseEventBody(params.title, detail),
    eventKey,
    payload: {
      previousStatus: params.previousStatus,
      nextStatus: params.nextStatus,
    },
  };
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
  const enabled = coercePreferenceBoolean(valueByKey.get(RELEASE_NOTIFICATIONS_ENABLED_KEY), false);
  const eventsRaw = valueByKey.get(RELEASE_NOTIFICATION_EVENTS_KEY);

  if (!eventsRaw) {
    return {
      enabled,
      events: {
        compatibilityChanged: true,
      },
    };
  }

  try {
    const parsed = JSON.parse(eventsRaw) as Record<string, unknown>;
    return {
      enabled,
      events: {
        compatibilityChanged: coercePreferenceBoolean(parsed['compatibilityChanged'], true),
      },
    };
  } catch {
    return {
      enabled,
      events: {
        compatibilityChanged: true,
      },
    };
  }
}

async function loadActiveTokenSet(pool: Pool): Promise<Set<string>> {
  const queryLimit = MAX_ACTIVE_TOKENS_PER_RUN + 1;
  const result = await pool.query<{ token: string }>(
    `
    SELECT token
    FROM fcm_tokens
    WHERE is_active = TRUE
    ORDER BY token ASC
    LIMIT $1
    `,
    [queryLimit]
  );
  const set = new Set<string>();
  result.rows.slice(0, MAX_ACTIVE_TOKENS_PER_RUN).forEach((row) => {
    const token = normalizeNonEmptyString(row.token);
    if (token) {
      set.add(token);
    }
  });

  const loadedRowCount = typeof result.rowCount === 'number' ? result.rowCount : result.rows.length;
  if (loadedRowCount > MAX_ACTIVE_TOKENS_PER_RUN) {
    console.warn('[compat-status-notifications] active_tokens_capped', {
      maxActiveTokensPerRun: MAX_ACTIVE_TOKENS_PER_RUN,
      loadedActiveTokens: set.size,
    });
  }

  return set;
}

async function reserveNotificationLog(
  pool: Pool,
  event: CompatStatusNotificationEvent,
  igdbGameId: string,
  platformIgdbId: number
): Promise<boolean> {
  const result = await pool.query(
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
        ...event.payload,
      }),
    ]
  );

  return (result.rowCount ?? 0) > 0;
}

async function finalizeNotificationLog(
  pool: Pool,
  event: CompatStatusNotificationEvent,
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
        ...event.payload,
      }),
      sentCount,
      event.eventKey,
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

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const __compatStatusNotificationTestables = {
  buildCompatStatusNotificationEvent,
};
