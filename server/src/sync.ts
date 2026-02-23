import type { FastifyInstance } from 'fastify';
import rateLimit from 'fastify-rate-limit';
import type { Pool, PoolClient } from 'pg';
import type {
  ClientSyncOperation,
  SyncEntityType,
  SyncOperationType,
  SyncPushResult
} from './types.js';

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

interface PushBody {
  operations?: unknown;
}

interface PullBody {
  cursor?: string | null;
}

export async function registerSyncRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  if (!app.hasDecorator('rateLimit')) {
    await app.register(rateLimit, { global: false });
  }
  app.route({
    method: 'POST',
    url: '/v1/sync/push',
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    },
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
              status: 'duplicate'
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
              message: error instanceof Error ? error.message : 'Failed to apply operation.'
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
        reply.send({ results, cursor });
      } catch (error) {
        await client.query('ROLLBACK');
        reply.code(500).send({ error: 'Unable to process sync push.' });
        console.error('[sync] push_failed', error);
      } finally {
        client.release();
      }
    }
  });

  app.route({
    method: 'POST',
    url: '/v1/sync/pull',
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    },
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
        serverTimestamp: row.server_timestamp
      }));
      const nextCursor = changes.length > 0 ? changes[changes.length - 1].eventId : String(cursor);

      reply.send({
        cursor: nextCursor,
        changes
      });
    }
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

  if (operation.entityType === 'setting') {
    return applySettingOperation(client, operation);
  }

  throw new Error(`Unsupported entity type: ${operation.entityType}`);
}

async function applyGameOperation(
  client: PoolClient,
  operation: ClientSyncOperation
): Promise<SyncPushResult> {
  if (operation.operation === 'delete') {
    const payload = normalizeGameIdentityPayload(operation.payload);

    await client.query('DELETE FROM games WHERE igdb_game_id = $1 AND platform_igdb_id = $2', [
      payload.igdbGameId,
      payload.platformIgdbId
    ]);
    await appendSyncEvent(
      client,
      'game',
      `${payload.igdbGameId}::${payload.platformIgdbId}`,
      'delete',
      payload
    );

    return {
      opId: operation.opId,
      status: 'applied',
      normalizedPayload: payload
    };
  }

  const payload = normalizeGamePayload(operation.payload);
  const gameKey = `${payload.igdbGameId}::${payload.platformIgdbId}`;

  await client.query(
    `
    INSERT INTO games (igdb_game_id, platform_igdb_id, payload, updated_at)
    VALUES ($1, $2, $3::jsonb, NOW())
    ON CONFLICT (igdb_game_id, platform_igdb_id)
    DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
    `,
    [payload.igdbGameId, payload.platformIgdbId, JSON.stringify(payload)]
  );
  await appendSyncEvent(client, 'game', gameKey, 'upsert', payload);

  return {
    opId: operation.opId,
    status: 'applied',
    normalizedPayload: payload
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
      normalizedPayload: payload
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
      id
    ]);
  }

  await appendSyncEvent(client, 'tag', String(id), 'upsert', normalizedPayload);

  return {
    opId: operation.opId,
    status: 'applied',
    normalizedPayload
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
      normalizedPayload: payload
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
      id
    ]);
  }

  await appendSyncEvent(client, 'view', String(id), 'upsert', normalizedPayload);

  return {
    opId: operation.opId,
    status: 'applied',
    normalizedPayload
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
      normalizedPayload: payload
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
    normalizedPayload: payload
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
      clientTimestamp
    });
  }

  return parsed;
}

function normalizeCursor(value: string | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
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

function normalizeGamePayload(
  value: unknown
): Record<string, unknown> & { igdbGameId: string; platformIgdbId: number } {
  const payload = normalizeObjectPayload(value);
  const igdbGameId = typeof payload.igdbGameId === 'string' ? payload.igdbGameId.trim() : '';
  const platformIgdbId = Number.parseInt(String(payload.platformIgdbId ?? ''), 10);

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
  const customPlatformIgdbIdRaw = Number.parseInt(String(payload.customPlatformIgdbId ?? ''), 10);
  const customCoverUrlRaw =
    typeof payload.customCoverUrl === 'string' ? payload.customCoverUrl.trim() : '';
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

  return {
    ...payload,
    igdbGameId,
    platformIgdbId,
    customTitle,
    customPlatform,
    customPlatformIgdbId: customPlatform !== null ? customPlatformIgdbId : null,
    customCoverUrl,
    updatedAt
  };
}

function normalizeGameIdentityPayload(value: unknown): {
  igdbGameId: string;
  platformIgdbId: number;
} {
  const payload = normalizeObjectPayload(value);
  const igdbGameId = typeof payload.igdbGameId === 'string' ? payload.igdbGameId.trim() : '';
  const platformIgdbId = Number.parseInt(String(payload.platformIgdbId ?? ''), 10);

  if (!igdbGameId || !Number.isInteger(platformIgdbId) || platformIgdbId <= 0) {
    throw new Error('Invalid game delete payload.');
  }

  return { igdbGameId, platformIgdbId };
}

function normalizeIdPayload(value: unknown, label: string): { id: number } {
  const payload = normalizeObjectPayload(value);
  const id = Number.parseInt(String(payload.id ?? ''), 10);

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
    value: settingValue
  };
}

function normalizeSettingIdentityPayload(value: unknown): { key: string } {
  const payload = normalizeObjectPayload(value);
  const key = typeof payload.key === 'string' ? payload.key.trim() : '';

  if (!key) {
    throw new Error('Invalid setting delete payload key.');
  }

  return { key };
}
