import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type {
  ClientSyncOperation,
  SyncEntityType,
  SyncOperationType,
  SyncPushResult,
} from './types.js';
import { applyRouteRateLimit, ensureRateLimitRegistered } from './rate-limit.js';

interface SyncEventRow {
  event_id: number;
  entity_type: SyncEntityType;
  operation: SyncOperationType;
  payload: unknown;
  server_timestamp: string;
}

interface IdempotencyRow {
  result: SyncPushResult;
}

interface UpsertedGamePayloadRow {
  payload: Record<string, unknown>;
}

interface PushBody {
  operations?: unknown;
}

interface PullBody {
  cursor?: unknown;
}

interface LatestCursorRow {
  event_id: unknown;
}

export async function registerSyncRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  let latestKnownSyncEventId = 0;

  await ensureRateLimitRegistered(app);
  app.route({
    method: 'POST',
    url: '/v1/sync/push',
    config: applyRouteRateLimit('sync_push'),
    handler: async (request, reply) => {
      const body = (request.body ?? {}) as PushBody;
      const operations = normalizeOperations(body.operations);

      if (!operations) {
        reply.code(400).send({ error: 'Invalid sync push payload.' });
        return;
      }

      const client = await pool.connect();

      try {
        const results: SyncPushResult[] = [];

        await client.query('BEGIN');

        for (const operation of operations) {
          const existing = await client.query<IdempotencyRow>(
            'SELECT result FROM idempotency_keys WHERE op_id = $1 LIMIT 1',
            [operation.opId]
          );

          if (existing.rows[0]) {
            results.push({
              ...existing.rows[0].result,
              status: 'duplicate',
            });
            continue;
          }

          try {
            const result = await applyOperation(client, operation);
            results.push(result);

            await client.query(
              'INSERT INTO idempotency_keys (op_id, result, created_at) VALUES ($1, $2::jsonb, NOW())',
              [operation.opId, JSON.stringify(result)]
            );
          } catch (error) {
            const failed: SyncPushResult = {
              opId: operation.opId,
              status: 'failed',
              message: error instanceof Error ? error.message : 'Failed to apply operation.',
            };
            results.push(failed);

            await client.query(
              'INSERT INTO idempotency_keys (op_id, result, created_at) VALUES ($1, $2::jsonb, NOW())',
              [operation.opId, JSON.stringify(failed)]
            );
          }
        }

        await client.query('COMMIT');
        const cursor = await readLatestCursor(client);
        latestKnownSyncEventId = Math.max(latestKnownSyncEventId, normalizeCursor(cursor));
        reply.send({ results, cursor });
      } catch (error) {
        await client.query('ROLLBACK');
        reply.code(500).send({ error: 'Unable to process sync push.' });
        console.error('[sync] push_failed', error);
      } finally {
        client.release();
      }
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/sync/pull',
    config: applyRouteRateLimit('sync_pull'),
    handler: async (request, reply) => {
      const body = (request.body ?? {}) as PullBody;
      const cursor = normalizeCursor(body.cursor);
      const result = await pool.query<SyncEventRow>(
        `
      SELECT event_id, entity_type, operation, payload, server_timestamp
      FROM sync_events
      WHERE event_id > $1
      ORDER BY event_id ASC
      LIMIT 1000
      `,
        [cursor]
      );

      const changes = result.rows.map((row) => ({
        eventId: String(row.event_id),
        entityType: row.entity_type,
        operation: row.operation,
        payload: row.payload,
        serverTimestamp: row.server_timestamp,
      }));

      if (changes.length > 0) {
        const nextCursor = changes[changes.length - 1].eventId;
        latestKnownSyncEventId = Math.max(latestKnownSyncEventId, normalizeCursor(nextCursor));
        reply.send({
          cursor: nextCursor,
          changes,
        });
        return;
      }

      if (cursor === 0 || cursor <= latestKnownSyncEventId) {
        reply.send({
          cursor: String(cursor),
          changes,
        });
        return;
      }

      const latestCursorResult = await pool.query<LatestCursorRow>(
        'SELECT COALESCE(MAX(event_id), 0) AS event_id FROM sync_events'
      );
      const normalizedLatestCursor =
        parseNonNegativeInteger(latestCursorResult.rows[0]?.event_id) ?? 0;
      latestKnownSyncEventId = Math.max(latestKnownSyncEventId, normalizedLatestCursor);
      const effectiveCursor = Math.min(cursor, normalizedLatestCursor);

      reply.send({
        cursor: String(effectiveCursor),
        changes: [],
      });
    },
  });
}

async function applyOperation(
  client: PoolClient,
  operation: ClientSyncOperation
): Promise<SyncPushResult> {
  if (operation.entityType === 'game') {
    return applyGameOperation(client, operation);
  }

  if (operation.entityType === 'tag') {
    return applyTagOperation(client, operation);
  }

  if (operation.entityType === 'view') {
    return applyViewOperation(client, operation);
  }

  return applySettingOperation(client, operation);
}

async function applyGameOperation(
  client: PoolClient,
  operation: ClientSyncOperation
): Promise<SyncPushResult> {
  if (operation.operation === 'delete') {
    const payload = normalizeGameIdentityPayload(operation.payload);

    await client.query('DELETE FROM games WHERE igdb_game_id = $1 AND platform_igdb_id = $2', [
      payload.igdbGameId,
      payload.platformIgdbId,
    ]);
    await appendSyncEvent(
      client,
      'game',
      `${payload.igdbGameId}::${String(payload.platformIgdbId)}`,
      'delete',
      payload
    );

    return {
      opId: operation.opId,
      status: 'applied',
      normalizedPayload: payload,
    };
  }

  const payload = normalizeGamePayload(operation.payload);
  const gameKey = `${payload.igdbGameId}::${String(payload.platformIgdbId)}`;

  const upsertResult = await client.query<UpsertedGamePayloadRow>(
    `
    INSERT INTO games (igdb_game_id, platform_igdb_id, payload, updated_at)
    VALUES ($1, $2, $3::jsonb, NOW())
    ON CONFLICT (igdb_game_id, platform_igdb_id)
    DO UPDATE SET payload = (
      EXCLUDED.payload || jsonb_build_object(
        'themes', COALESCE(EXCLUDED.payload -> 'themes', games.payload -> 'themes'),
        'themeIds', COALESCE(EXCLUDED.payload -> 'themeIds', games.payload -> 'themeIds'),
        'keywords', COALESCE(EXCLUDED.payload -> 'keywords', games.payload -> 'keywords'),
        'keywordIds', COALESCE(EXCLUDED.payload -> 'keywordIds', games.payload -> 'keywordIds'),
        'psPricesMatchLocked', COALESCE(EXCLUDED.payload -> 'psPricesMatchLocked', games.payload -> 'psPricesMatchLocked'),
        'hltbMatchLocked', COALESCE(EXCLUDED.payload -> 'hltbMatchLocked', games.payload -> 'hltbMatchLocked'),
        'hltbMatchGameId', COALESCE(EXCLUDED.payload -> 'hltbMatchGameId', games.payload -> 'hltbMatchGameId'),
        'hltbMatchUrl', COALESCE(EXCLUDED.payload -> 'hltbMatchUrl', games.payload -> 'hltbMatchUrl'),
        'hltbMatchQueryTitle', COALESCE(EXCLUDED.payload -> 'hltbMatchQueryTitle', games.payload -> 'hltbMatchQueryTitle'),
        'hltbMatchQueryReleaseYear', COALESCE(EXCLUDED.payload -> 'hltbMatchQueryReleaseYear', games.payload -> 'hltbMatchQueryReleaseYear'),
        'hltbMatchQueryPlatform', COALESCE(EXCLUDED.payload -> 'hltbMatchQueryPlatform', games.payload -> 'hltbMatchQueryPlatform'),
        'reviewMatchLocked', COALESCE(EXCLUDED.payload -> 'reviewMatchLocked', games.payload -> 'reviewMatchLocked'),
        'reviewMatchQueryTitle', COALESCE(EXCLUDED.payload -> 'reviewMatchQueryTitle', games.payload -> 'reviewMatchQueryTitle'),
        'reviewMatchQueryReleaseYear', COALESCE(EXCLUDED.payload -> 'reviewMatchQueryReleaseYear', games.payload -> 'reviewMatchQueryReleaseYear'),
        'reviewMatchQueryPlatform', COALESCE(EXCLUDED.payload -> 'reviewMatchQueryPlatform', games.payload -> 'reviewMatchQueryPlatform'),
        'reviewMatchPlatformIgdbId', COALESCE(EXCLUDED.payload -> 'reviewMatchPlatformIgdbId', games.payload -> 'reviewMatchPlatformIgdbId'),
        'reviewMatchMobygamesGameId', COALESCE(EXCLUDED.payload -> 'reviewMatchMobygamesGameId', games.payload -> 'reviewMatchMobygamesGameId'),
        'websites', COALESCE(EXCLUDED.payload -> 'websites', games.payload -> 'websites'),
        'steamAppId', COALESCE(EXCLUDED.payload -> 'steamAppId', games.payload -> 'steamAppId'),
        'priceSource', COALESCE(EXCLUDED.payload -> 'priceSource', games.payload -> 'priceSource'),
        'priceFetchedAt', COALESCE(EXCLUDED.payload -> 'priceFetchedAt', games.payload -> 'priceFetchedAt'),
        'priceAmount', COALESCE(EXCLUDED.payload -> 'priceAmount', games.payload -> 'priceAmount'),
        'priceCurrency', COALESCE(EXCLUDED.payload -> 'priceCurrency', games.payload -> 'priceCurrency'),
        'priceRegularAmount', COALESCE(EXCLUDED.payload -> 'priceRegularAmount', games.payload -> 'priceRegularAmount'),
        'priceDiscountPercent', COALESCE(EXCLUDED.payload -> 'priceDiscountPercent', games.payload -> 'priceDiscountPercent'),
        'priceIsFree', COALESCE(EXCLUDED.payload -> 'priceIsFree', games.payload -> 'priceIsFree'),
        'priceUrl', COALESCE(EXCLUDED.payload -> 'priceUrl', games.payload -> 'priceUrl')
      ) || jsonb_build_object(
        'psPricesFetchedAt', COALESCE(EXCLUDED.payload -> 'psPricesFetchedAt', games.payload -> 'psPricesFetchedAt'),
        'psPricesRegionPath', COALESCE(EXCLUDED.payload -> 'psPricesRegionPath', games.payload -> 'psPricesRegionPath'),
        'psPricesShow', COALESCE(EXCLUDED.payload -> 'psPricesShow', games.payload -> 'psPricesShow'),
        'psPricesPlatform', COALESCE(EXCLUDED.payload -> 'psPricesPlatform', games.payload -> 'psPricesPlatform'),
        'psPricesMatchQueryTitle', COALESCE(EXCLUDED.payload -> 'psPricesMatchQueryTitle', games.payload -> 'psPricesMatchQueryTitle'),
        'psPricesMatchTitle', COALESCE(EXCLUDED.payload -> 'psPricesMatchTitle', games.payload -> 'psPricesMatchTitle'),
        'psPricesMatchScore', COALESCE(EXCLUDED.payload -> 'psPricesMatchScore', games.payload -> 'psPricesMatchScore'),
        'psPricesMatchConfidence', COALESCE(EXCLUDED.payload -> 'psPricesMatchConfidence', games.payload -> 'psPricesMatchConfidence'),
        'psPricesCandidates', COALESCE(EXCLUDED.payload -> 'psPricesCandidates', games.payload -> 'psPricesCandidates'),
        'psPricesPriceAmount', COALESCE(EXCLUDED.payload -> 'psPricesPriceAmount', games.payload -> 'psPricesPriceAmount'),
        'psPricesPriceCurrency', COALESCE(EXCLUDED.payload -> 'psPricesPriceCurrency', games.payload -> 'psPricesPriceCurrency'),
        'psPricesRegularPriceAmount', COALESCE(EXCLUDED.payload -> 'psPricesRegularPriceAmount', games.payload -> 'psPricesRegularPriceAmount'),
        'psPricesDiscountPercent', COALESCE(EXCLUDED.payload -> 'psPricesDiscountPercent', games.payload -> 'psPricesDiscountPercent'),
        'psPricesIsFree', COALESCE(EXCLUDED.payload -> 'psPricesIsFree', games.payload -> 'psPricesIsFree'),
        'psPricesUrl', COALESCE(EXCLUDED.payload -> 'psPricesUrl', games.payload -> 'psPricesUrl'),
        'psPricesTitle', COALESCE(EXCLUDED.payload -> 'psPricesTitle', games.payload -> 'psPricesTitle'),
        'psPricesSource', COALESCE(EXCLUDED.payload -> 'psPricesSource', games.payload -> 'psPricesSource'),
        'screenshots', COALESCE(EXCLUDED.payload -> 'screenshots', games.payload -> 'screenshots'),
        'videos', COALESCE(EXCLUDED.payload -> 'videos', games.payload -> 'videos'),
        'taxonomyEnrichedAt', COALESCE(EXCLUDED.payload -> 'taxonomyEnrichedAt', games.payload -> 'taxonomyEnrichedAt'),
        'taxonomyEnrichmentStatus', COALESCE(EXCLUDED.payload -> 'taxonomyEnrichmentStatus', games.payload -> 'taxonomyEnrichmentStatus'),
        'mediaEnrichedAt', COALESCE(EXCLUDED.payload -> 'mediaEnrichedAt', games.payload -> 'mediaEnrichedAt'),
        'mediaEnrichmentStatus', COALESCE(EXCLUDED.payload -> 'mediaEnrichmentStatus', games.payload -> 'mediaEnrichmentStatus'),
        'steamEnrichedAt', COALESCE(EXCLUDED.payload -> 'steamEnrichedAt', games.payload -> 'steamEnrichedAt'),
        'steamEnrichmentStatus', COALESCE(EXCLUDED.payload -> 'steamEnrichmentStatus', games.payload -> 'steamEnrichmentStatus'),
        'metadataSyncEnqueuedAt', COALESCE(EXCLUDED.payload -> 'metadataSyncEnqueuedAt', games.payload -> 'metadataSyncEnqueuedAt')
      )
    ), updated_at = NOW()
    RETURNING payload
    `,
    [payload.igdbGameId, payload.platformIgdbId, JSON.stringify(payload)]
  );
  const normalizedPayload = upsertResult.rows[0]?.payload ?? payload;
  await appendSyncEvent(client, 'game', gameKey, 'upsert', normalizedPayload);

  return {
    opId: operation.opId,
    status: 'applied',
    normalizedPayload,
  };
}

async function applyTagOperation(
  client: PoolClient,
  operation: ClientSyncOperation
): Promise<SyncPushResult> {
  if (operation.operation === 'delete') {
    const payload = normalizeIdPayload(operation.payload, 'tag');
    await client.query('DELETE FROM tags WHERE id = $1', [payload.id]);
    await appendSyncEvent(client, 'tag', String(payload.id), 'delete', payload);
    return {
      opId: operation.opId,
      status: 'applied',
      normalizedPayload: payload,
    };
  }

  const payload = normalizeObjectPayload(operation.payload);
  const explicitId =
    typeof payload.id === 'number' && Number.isInteger(payload.id) && payload.id > 0
      ? payload.id
      : null;
  let normalizedPayload: Record<string, unknown>;
  let id: number;

  if (explicitId !== null) {
    const row = await client.query<{ id: number }>(
      `
      INSERT INTO tags (id, payload, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      RETURNING id
      `,
      [explicitId, JSON.stringify(payload)]
    );
    id = row.rows[0].id;
    normalizedPayload = { ...payload, id };
  } else {
    const row = await client.query<{ id: number }>(
      'INSERT INTO tags (payload, updated_at) VALUES ($1::jsonb, NOW()) RETURNING id',
      [JSON.stringify(payload)]
    );
    id = row.rows[0].id;
    normalizedPayload = { ...payload, id };

    await client.query('UPDATE tags SET payload = $1::jsonb WHERE id = $2', [
      JSON.stringify(normalizedPayload),
      id,
    ]);
  }

  await appendSyncEvent(client, 'tag', String(id), 'upsert', normalizedPayload);

  return {
    opId: operation.opId,
    status: 'applied',
    normalizedPayload,
  };
}

async function applyViewOperation(
  client: PoolClient,
  operation: ClientSyncOperation
): Promise<SyncPushResult> {
  if (operation.operation === 'delete') {
    const payload = normalizeIdPayload(operation.payload, 'view');
    await client.query('DELETE FROM views WHERE id = $1', [payload.id]);
    await appendSyncEvent(client, 'view', String(payload.id), 'delete', payload);
    return {
      opId: operation.opId,
      status: 'applied',
      normalizedPayload: payload,
    };
  }

  const payload = normalizeObjectPayload(operation.payload);
  const explicitId =
    typeof payload.id === 'number' && Number.isInteger(payload.id) && payload.id > 0
      ? payload.id
      : null;
  let normalizedPayload: Record<string, unknown>;
  let id: number;

  if (explicitId !== null) {
    const row = await client.query<{ id: number }>(
      `
      INSERT INTO views (id, payload, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      RETURNING id
      `,
      [explicitId, JSON.stringify(payload)]
    );
    id = row.rows[0].id;
    normalizedPayload = { ...payload, id };
  } else {
    const row = await client.query<{ id: number }>(
      'INSERT INTO views (payload, updated_at) VALUES ($1::jsonb, NOW()) RETURNING id',
      [JSON.stringify(payload)]
    );
    id = row.rows[0].id;
    normalizedPayload = { ...payload, id };

    await client.query('UPDATE views SET payload = $1::jsonb WHERE id = $2', [
      JSON.stringify(normalizedPayload),
      id,
    ]);
  }

  await appendSyncEvent(client, 'view', String(id), 'upsert', normalizedPayload);

  return {
    opId: operation.opId,
    status: 'applied',
    normalizedPayload,
  };
}

async function applySettingOperation(
  client: PoolClient,
  operation: ClientSyncOperation
): Promise<SyncPushResult> {
  if (operation.operation === 'delete') {
    const payload = normalizeSettingIdentityPayload(operation.payload);
    await client.query('DELETE FROM settings WHERE setting_key = $1', [payload.key]);
    await appendSyncEvent(client, 'setting', payload.key, 'delete', payload);
    return {
      opId: operation.opId,
      status: 'applied',
      normalizedPayload: payload,
    };
  }

  const payload = normalizeSettingPayload(operation.payload);
  await client.query(
    `
    INSERT INTO settings (setting_key, setting_value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (setting_key)
    DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()
    `,
    [payload.key, payload.value]
  );
  await appendSyncEvent(client, 'setting', payload.key, 'upsert', payload);

  return {
    opId: operation.opId,
    status: 'applied',
    normalizedPayload: payload,
  };
}

async function appendSyncEvent(
  client: PoolClient,
  entityType: SyncEntityType,
  entityKey: string,
  operation: SyncOperationType,
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

async function readLatestCursor(client: PoolClient): Promise<string> {
  const latest = await client.query<{ event_id: number }>(
    'SELECT COALESCE(MAX(event_id), 0) AS event_id FROM sync_events'
  );
  return String(latest.rows[0]?.event_id ?? 0);
}

function normalizeOperations(value: unknown): ClientSyncOperation[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed: ClientSyncOperation[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const operation = entry as Record<string, unknown>;
    const opId = typeof operation.opId === 'string' ? operation.opId.trim() : '';
    const entityType = normalizeEntityType(operation.entityType);
    const opType = normalizeOperationType(operation.operation);
    const clientTimestamp =
      typeof operation.clientTimestamp === 'string'
        ? operation.clientTimestamp
        : new Date().toISOString();

    if (!opId || !entityType || !opType) {
      return null;
    }

    parsed.push({
      opId,
      entityType,
      operation: opType,
      payload: operation.payload,
      clientTimestamp,
    });
  }

  return parsed;
}

function normalizeCursor(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      return 0;
    }
    if (value > Number.MAX_SAFE_INTEGER) {
      return Number.MAX_SAFE_INTEGER;
    }
    return Number.isSafeInteger(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      return 0;
    }
    try {
      const parsed = BigInt(trimmed);
      if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
        return Number.MAX_SAFE_INTEGER;
      }
      return Number(parsed);
    } catch {
      return 0;
    }
  }

  if (typeof value === 'bigint') {
    if (value < 0n) {
      return 0;
    }
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number.MAX_SAFE_INTEGER;
    }
    return Number(value);
  }

  return 0;
}

function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }
    try {
      const parsed = BigInt(trimmed);
      if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
        return null;
      }
      return Number(parsed);
    } catch {
      return null;
    }
  }

  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    return Number(value);
  }

  return null;
}

function normalizeEntityType(value: unknown): SyncEntityType | null {
  if (value === 'game' || value === 'tag' || value === 'view' || value === 'setting') {
    return value;
  }

  return null;
}

function normalizeOperationType(value: unknown): SyncOperationType | null {
  if (value === 'upsert' || value === 'delete') {
    return value;
  }

  return null;
}

function normalizeObjectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid operation payload.');
  }

  return value as Record<string, unknown>;
}

function parseInteger(value: unknown): number {
  if (typeof value === 'string') {
    return Number.parseInt(value, 10);
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : Number.NaN;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return Number.NaN;
}

function parseFiniteNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Number.NaN;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return Number.NaN;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  return Number.NaN;
}

function normalizePriceSource(value: unknown): 'steam_store' | 'psprices' | null {
  return value === 'steam_store' || value === 'psprices' ? value : null;
}

function normalizePriceFetchedAt(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function normalizePriceAmount(value: unknown): number | null {
  const parsed = parseFiniteNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

function normalizePriceCurrency(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function normalizePriceDiscountPercent(value: unknown): number | null {
  const parsed = parseFiniteNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

function normalizePriceIsFree(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  return null;
}

function normalizePriceUrl(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized;
  }
  if (normalized.startsWith('//')) {
    return `https:${normalized}`;
  }
  return null;
}

function normalizeGamePayload(
  value: unknown
): Record<string, unknown> & { igdbGameId: string; platformIgdbId: number } {
  const payload = normalizeObjectPayload(value);
  const igdbGameId = typeof payload.igdbGameId === 'string' ? payload.igdbGameId.trim() : '';
  const platformIgdbId = parseInteger(payload.platformIgdbId);

  if (!igdbGameId || !Number.isInteger(platformIgdbId) || platformIgdbId <= 0) {
    throw new Error('Invalid game payload identity.');
  }

  const updatedAt =
    typeof payload.updatedAt === 'string' && payload.updatedAt.trim().length > 0
      ? payload.updatedAt
      : new Date().toISOString();
  const title =
    typeof payload.title === 'string' && payload.title.trim().length > 0
      ? payload.title.trim()
      : '';
  const platform =
    typeof payload.platform === 'string' && payload.platform.trim().length > 0
      ? payload.platform.trim()
      : '';
  const customTitleRaw = typeof payload.customTitle === 'string' ? payload.customTitle.trim() : '';
  const customPlatformRaw =
    typeof payload.customPlatform === 'string' ? payload.customPlatform.trim() : '';
  const customPlatformIgdbIdRaw = parseInteger(payload.customPlatformIgdbId);
  const customCoverUrlRaw =
    typeof payload.customCoverUrl === 'string' ? payload.customCoverUrl.trim() : '';
  const notesRaw = typeof payload.notes === 'string' ? payload.notes : '';
  const mobygamesGameIdRaw = parseInteger(payload.mobygamesGameId);
  const hasSteamAppId = Object.prototype.hasOwnProperty.call(payload, 'steamAppId');
  const hasWebsites = Object.prototype.hasOwnProperty.call(payload, 'websites');
  const steamAppIdRaw = parseInteger(payload.steamAppId);
  const mobyScoreRaw = parseFiniteNumber(payload.mobyScore);
  const hasPriceSource = Object.prototype.hasOwnProperty.call(payload, 'priceSource');
  const hasPriceFetchedAt = Object.prototype.hasOwnProperty.call(payload, 'priceFetchedAt');
  const hasPriceAmount = Object.prototype.hasOwnProperty.call(payload, 'priceAmount');
  const hasPriceCurrency = Object.prototype.hasOwnProperty.call(payload, 'priceCurrency');
  const hasPriceRegularAmount = Object.prototype.hasOwnProperty.call(payload, 'priceRegularAmount');
  const hasPriceDiscountPercent = Object.prototype.hasOwnProperty.call(
    payload,
    'priceDiscountPercent'
  );
  const hasPriceIsFree = Object.prototype.hasOwnProperty.call(payload, 'priceIsFree');
  const hasPriceUrl = Object.prototype.hasOwnProperty.call(payload, 'priceUrl');
  const priceSource = normalizePriceSource(payload.priceSource);
  const priceFetchedAt = normalizePriceFetchedAt(payload.priceFetchedAt);
  const priceAmount = normalizePriceAmount(payload.priceAmount);
  const priceCurrency = normalizePriceCurrency(payload.priceCurrency);
  const priceRegularAmount = normalizePriceAmount(payload.priceRegularAmount);
  const priceDiscountPercent = normalizePriceDiscountPercent(payload.priceDiscountPercent);
  const priceIsFree = normalizePriceIsFree(payload.priceIsFree);
  const priceUrl = normalizePriceUrl(payload.priceUrl);
  const customTitle = customTitleRaw.length > 0 && customTitleRaw !== title ? customTitleRaw : null;
  const customPlatformIgdbId =
    Number.isInteger(customPlatformIgdbIdRaw) && customPlatformIgdbIdRaw > 0
      ? customPlatformIgdbIdRaw
      : null;
  const customPlatform =
    customPlatformRaw.length > 0 && customPlatformIgdbId !== null && customPlatformRaw !== platform
      ? customPlatformRaw
      : null;
  const customCoverUrl = /^data:image\/[a-z0-9.+-]+;base64,/i.test(customCoverUrlRaw)
    ? customCoverUrlRaw
    : null;
  const normalizedNotes = notesRaw.replace(/\r\n?/g, '\n');
  const normalizedNotesTrimmed = normalizedNotes.trim();
  const emptyHtmlBlockPattern = /<(p|div)>(\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi;
  const strippedNotes = normalizedNotesTrimmed.replace(emptyHtmlBlockPattern, '').trim();
  const isEmptyHtmlPlaceholder = strippedNotes.length === 0;
  const notes =
    normalizedNotesTrimmed.length > 0 && !isEmptyHtmlPlaceholder ? normalizedNotes : null;
  const mobygamesGameId =
    Number.isInteger(mobygamesGameIdRaw) && mobygamesGameIdRaw > 0 ? mobygamesGameIdRaw : null;
  const steamAppId = Number.isInteger(steamAppIdRaw) && steamAppIdRaw > 0 ? steamAppIdRaw : null;
  const websites = normalizeWebsites(payload.websites);
  const mobyScore =
    Number.isFinite(mobyScoreRaw) && mobyScoreRaw > 0 && mobyScoreRaw <= 10
      ? Math.round(mobyScoreRaw * 10) / 10
      : null;

  return {
    ...payload,
    igdbGameId,
    platformIgdbId,
    customTitle,
    customPlatform,
    customPlatformIgdbId: customPlatform !== null ? customPlatformIgdbId : null,
    customCoverUrl,
    notes,
    mobyScore,
    mobygamesGameId,
    ...(hasWebsites ? { websites } : {}),
    ...(hasSteamAppId ? { steamAppId } : {}),
    updatedAt,
    ...(hasPriceSource ? { priceSource } : {}),
    ...(hasPriceFetchedAt ? { priceFetchedAt } : {}),
    ...(hasPriceAmount ? { priceAmount } : {}),
    ...(hasPriceCurrency ? { priceCurrency } : {}),
    ...(hasPriceRegularAmount ? { priceRegularAmount } : {}),
    ...(hasPriceDiscountPercent ? { priceDiscountPercent } : {}),
    ...(hasPriceIsFree ? { priceIsFree } : {}),
    ...(hasPriceUrl ? { priceUrl } : {}),
  };
}

function normalizeGameIdentityPayload(value: unknown): {
  igdbGameId: string;
  platformIgdbId: number;
} {
  const payload = normalizeObjectPayload(value);
  const igdbGameId = typeof payload.igdbGameId === 'string' ? payload.igdbGameId.trim() : '';
  const platformIgdbId = parseInteger(payload.platformIgdbId);

  if (!igdbGameId || !Number.isInteger(platformIgdbId) || platformIgdbId <= 0) {
    throw new Error('Invalid game delete payload.');
  }

  return { igdbGameId, platformIgdbId };
}

function normalizeIdPayload(value: unknown, label: string): { id: number } {
  const payload = normalizeObjectPayload(value);
  const id = parseInteger(payload.id);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid ${label} payload id.`);
  }

  return { id };
}

function normalizeSettingPayload(value: unknown): { key: string; value: string } {
  const payload = normalizeObjectPayload(value);
  const key = typeof payload.key === 'string' ? payload.key.trim() : '';
  const settingValue = typeof payload.value === 'string' ? payload.value : '';

  if (!key) {
    throw new Error('Invalid setting payload key.');
  }

  return {
    key,
    value: settingValue,
  };
}

function normalizeWebsites(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const provider =
      record.provider === 'steam' ||
      record.provider === 'playstation' ||
      record.provider === 'xbox' ||
      record.provider === 'nintendo' ||
      record.provider === 'epic' ||
      record.provider === 'gog' ||
      record.provider === 'itch' ||
      record.provider === 'apple' ||
      record.provider === 'android' ||
      record.provider === 'amazon' ||
      record.provider === 'oculus' ||
      record.provider === 'gamejolt' ||
      record.provider === 'kartridge' ||
      record.provider === 'utomik' ||
      record.provider === 'unknown'
        ? record.provider
        : null;
    const url = normalizeExternalUrl(record.url);
    if (url === null) {
      continue;
    }

    const dedupeKey = url;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push({
      provider,
      providerLabel:
        provider !== null
          ? (normalizeString(record.providerLabel) ?? defaultWebsiteProviderLabel(provider))
          : normalizeString(record.providerLabel),
      url,
      typeId: normalizeOptionalPositiveInteger(record.typeId),
      typeName: normalizeString(record.typeName),
      trusted: typeof record.trusted === 'boolean' ? record.trusted : null,
    });
  }

  return normalized;
}

function normalizeExternalUrl(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length === 0) {
    return null;
  }

  const candidate =
    normalized.startsWith('http://') || normalized.startsWith('https://')
      ? normalized
      : normalized.startsWith('//')
        ? `https:${normalized}`
        : null;
  if (candidate === null) {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalPositiveInteger(value: unknown): number | null {
  const parsed = parseInteger(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function defaultWebsiteProviderLabel(provider: string): string {
  switch (provider) {
    case 'steam':
      return 'Steam';
    case 'playstation':
      return 'PlayStation';
    case 'xbox':
      return 'Xbox';
    case 'nintendo':
      return 'Nintendo';
    case 'epic':
      return 'Epic Games Store';
    case 'gog':
      return 'GOG';
    case 'itch':
      return 'itch.io';
    case 'apple':
      return 'Apple App Store';
    case 'android':
      return 'Google Play';
    case 'amazon':
      return 'Amazon';
    case 'oculus':
      return 'Meta Quest';
    case 'gamejolt':
      return 'Game Jolt';
    case 'kartridge':
      return 'Kartridge';
    case 'utomik':
      return 'Utomik';
    default:
      return 'Unknown Store';
  }
}

function normalizeSettingIdentityPayload(value: unknown): { key: string } {
  const payload = normalizeObjectPayload(value);
  const key = typeof payload.key === 'string' ? payload.key.trim() : '';

  if (!key) {
    throw new Error('Invalid setting delete payload key.');
  }

  return { key };
}
