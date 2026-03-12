import type { Pool } from 'pg';
import { sendFcmMulticast, type FcmSendResult } from './fcm.js';
import {
  MAX_ACTIVE_TOKENS_PER_RUN,
  RELEASE_NOTIFICATION_EVENTS_KEY,
  RELEASE_NOTIFICATIONS_ENABLED_KEY
} from './notification-constants.js';
import { coercePreferenceBoolean } from './preference-bool.js';

interface NotificationPreferences {
  enabled: boolean;
  events: {
    sale: boolean;
  };
}

interface SaleSnapshot {
  amount: number | null;
  regularAmount: number | null;
  discountPercent: number | null;
  isFree: boolean | null;
  currency: string | null;
  onSale: boolean;
}

interface SaleNotificationReservationEvent {
  type: 'price_on_sale';
  title: string;
  body: string;
  eventKey: string;
  payload: {
    priceAmount: number | null;
    priceRegularAmount: number | null;
    priceDiscountPercent: number | null;
    priceCurrency: string | null;
  };
}

interface MaybeSendSaleNotificationParams {
  igdbGameId: string;
  platformIgdbId: number;
  previousPayload: Record<string, unknown>;
  nextPayload: Record<string, unknown>;
}

interface MaybeSendSaleNotificationOptions {
  activeTokens?: Iterable<string>;
  sendMulticast?: (
    tokens: string[],
    payload: { title: string; body: string; data: Record<string, string> }
  ) => Promise<FcmSendResult>;
}

export async function maybeSendWishlistSaleNotification(
  pool: Pool,
  params: MaybeSendSaleNotificationParams,
  options: MaybeSendSaleNotificationOptions = {}
): Promise<void> {
  const listType = normalizeNonEmptyString(params.nextPayload['listType'])?.toLowerCase();
  if (listType !== 'wishlist') {
    return;
  }

  const before = deriveSaleSnapshot(params.previousPayload);
  const after = deriveSaleSnapshot(params.nextPayload);
  if (before.onSale || !after.onSale) {
    return;
  }

  const preferences = await readNotificationPreferences(pool);
  if (!preferences.enabled || !preferences.events.sale) {
    return;
  }

  const titleValue = normalizeNonEmptyString(params.nextPayload['title']) ?? 'Unknown title';
  const event = buildSaleNotificationEvent({
    igdbGameId: params.igdbGameId,
    platformIgdbId: params.platformIgdbId,
    title: titleValue,
    snapshot: after,
    fetchedAt: normalizeNonEmptyString(params.nextPayload['priceFetchedAt'])
  });

  const reserved = await reserveNotificationLog(
    pool,
    event,
    params.igdbGameId,
    params.platformIgdbId
  );
  if (!reserved) {
    return;
  }

  const activeTokenSet =
    options.activeTokens !== undefined
      ? new Set(
          [...options.activeTokens]
            .map((token) => normalizeNonEmptyString(token))
            .filter((token): token is string => token !== null)
        )
      : await loadActiveTokenSet(pool);
  if (activeTokenSet.size === 0) {
    await releaseNotificationLogReservation(pool, event.eventKey);
    return;
  }

  const sendMulticast = options.sendMulticast ?? sendFcmMulticast;
  let sendResult: FcmSendResult | null = null;
  try {
    sendResult = await sendMulticast([...activeTokenSet], {
      title: event.title,
      body: event.body,
      data: {
        eventType: event.type,
        eventKey: event.eventKey,
        route: '/tabs/wishlist',
        igdbGameId: params.igdbGameId,
        platformIgdbId: String(params.platformIgdbId),
        priceAmount: event.payload.priceAmount !== null ? String(event.payload.priceAmount) : '',
        priceRegularAmount:
          event.payload.priceRegularAmount !== null ? String(event.payload.priceRegularAmount) : '',
        priceDiscountPercent:
          event.payload.priceDiscountPercent !== null
            ? String(event.payload.priceDiscountPercent)
            : '',
        priceCurrency: event.payload.priceCurrency ?? ''
      }
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
      console.error('[price-sale-notifications] post_send_persistence_failed', {
        eventKey: event.eventKey,
        successCount: sentCount,
        error: error instanceof Error ? error.message : String(error)
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
    console.error('[price-sale-notifications] invalid_token_deactivation_failed', {
      eventKey,
      invalidTokenCount: invalidTokens.length,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function deriveSaleSnapshot(payload: Record<string, unknown>): SaleSnapshot {
  const amount = numberOrNull(payload['priceAmount']);
  const regularAmount = numberOrNull(payload['priceRegularAmount']);
  const discountPercent = numberOrNull(payload['priceDiscountPercent']);
  const isFree = booleanOrNull(payload['priceIsFree']);
  const currency = normalizeCurrency(payload['priceCurrency']);

  const onSale =
    isFree === true
      ? false
      : (amount !== null &&
          regularAmount !== null &&
          amount >= 0 &&
          regularAmount >= 0 &&
          regularAmount > amount) ||
        (discountPercent !== null && discountPercent > 0);

  return {
    amount,
    regularAmount,
    discountPercent,
    isFree,
    currency,
    onSale
  };
}

function buildSaleNotificationEvent(args: {
  igdbGameId: string;
  platformIgdbId: number;
  title: string;
  snapshot: SaleSnapshot;
  fetchedAt: string | null;
}): SaleNotificationReservationEvent {
  const displayPrice = formatDisplayPrice(args.snapshot.amount, args.snapshot.currency);
  const discountPercent = resolveDiscountPercentForNotification(args.snapshot);
  const discountSuffix = discountPercent !== null ? ` (-${String(discountPercent)}%)` : '';
  const saleDay = resolveSaleDayBucket(args.fetchedAt);

  const eventKey = [
    'price_on_sale',
    args.igdbGameId,
    String(args.platformIgdbId),
    saleDay,
    args.snapshot.currency ?? 'na',
    args.snapshot.amount !== null ? String(args.snapshot.amount) : 'na',
    args.snapshot.regularAmount !== null ? String(args.snapshot.regularAmount) : 'na',
    discountPercent !== null ? String(discountPercent) : 'na'
  ].join(':');

  return {
    type: 'price_on_sale',
    title: `${args.title} is on sale`,
    body: `Now ${displayPrice}${discountSuffix}.`,
    eventKey,
    payload: {
      priceAmount: args.snapshot.amount,
      priceRegularAmount: args.snapshot.regularAmount,
      priceDiscountPercent: discountPercent,
      priceCurrency: args.snapshot.currency
    }
  };
}

function resolveDiscountPercentForNotification(snapshot: SaleSnapshot): number | null {
  if (snapshot.discountPercent !== null && snapshot.discountPercent > 0) {
    return Math.round(snapshot.discountPercent);
  }

  const inferred = inferDiscountPercent(snapshot.amount, snapshot.regularAmount);
  return inferred > 0 ? inferred : null;
}

function inferDiscountPercent(amount: number | null, regularAmount: number | null): number {
  if (
    amount === null ||
    regularAmount === null ||
    !Number.isFinite(amount) ||
    !Number.isFinite(regularAmount) ||
    regularAmount <= 0 ||
    amount < 0 ||
    amount >= regularAmount
  ) {
    return 0;
  }

  return Math.round(((regularAmount - amount) / regularAmount) * 100);
}

function formatDisplayPrice(amount: number | null, currency: string | null): string {
  if (amount === null || amount < 0) {
    return 'at a discounted price';
  }

  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency
      }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  }

  return amount.toFixed(2);
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
        sale: true
      }
    };
  }

  try {
    const parsed = JSON.parse(eventsRaw) as Record<string, unknown>;
    return {
      enabled,
      events: {
        sale: coercePreferenceBoolean(parsed['sale'], true)
      }
    };
  } catch {
    return {
      enabled,
      events: {
        sale: true
      }
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
    console.warn('[price-sale-notifications] active_tokens_capped', {
      maxActiveTokensPerRun: MAX_ACTIVE_TOKENS_PER_RUN,
      loadedActiveTokens: set.size
    });
  }

  return set;
}

async function reserveNotificationLog(
  pool: Pool,
  event: SaleNotificationReservationEvent,
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
        ...event.payload
      })
    ]
  );

  return (result.rowCount ?? 0) > 0;
}

async function finalizeNotificationLog(
  pool: Pool,
  event: SaleNotificationReservationEvent,
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
        ...event.payload
      }),
      sentCount,
      event.eventKey
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

function resolveSaleDayBucket(fetchedAt: string | null): string {
  const normalized = normalizeNonEmptyString(fetchedAt);
  if (normalized) {
    const parsed = Date.parse(normalized);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString().slice(0, 10);
    }
  }
  return new Date().toISOString().slice(0, 10);
}

function normalizeCurrency(value: unknown): string | null {
  const normalized = normalizeNonEmptyString(value)?.toUpperCase() ?? null;
  return normalized && normalized.length <= 10 ? normalized : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export const __saleNotificationTestables = {
  deriveSaleSnapshot,
  inferDiscountPercent,
  formatDisplayPrice
};
