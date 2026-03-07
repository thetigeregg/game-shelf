import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { config } from './config.js';
import { sendFcmMulticast } from './fcm.js';
import { isAuthorizedMutatingRequest } from './request-security.js';

interface RegisterBody {
  token?: unknown;
  platform?: unknown;
  appVersion?: unknown;
  userAgent?: unknown;
  timezone?: unknown;
}

interface UnregisterBody {
  token?: unknown;
}

const REGISTER_RATE_LIMIT = {
  max: 30,
  timeWindow: '1 minute'
} as const;

const UNREGISTER_RATE_LIMIT = {
  max: 30,
  timeWindow: '1 minute'
} as const;

const TEST_RATE_LIMIT = {
  max: 5,
  timeWindow: '1 minute'
} as const;

const TEST_ENDPOINT_MAX_ACTIVE_TOKENS = 5_000;

const OBSERVABILITY_RATE_LIMIT = {
  max: 10,
  timeWindow: '1 minute'
} as const;

export function registerNotificationRoutes(app: FastifyInstance, pool: Pool): void {
  app.get(
    '/v1/notifications/observability',
    {
      config: {
        rateLimit: OBSERVABILITY_RATE_LIMIT
      }
    },
    async (_request, reply) => {
      if (!config.notificationsObservabilityEndpointEnabled) {
        reply.code(404).send({ error: 'Not found' });
        return;
      }
      if (!isNotificationAdminAuthorized(_request, reply)) {
        return;
      }

      const tokenStatsResult = await pool.query<{
        active_tokens: string;
        inactive_tokens: string;
      }>(
        `
        SELECT
          COUNT(*) FILTER (WHERE is_active = TRUE)::text AS active_tokens,
          COUNT(*) FILTER (WHERE is_active = FALSE)::text AS inactive_tokens
        FROM fcm_tokens
        `
      );
      const recentInvalidResult = await pool.query<{ invalidated_last_24h: string }>(
        `
        SELECT COUNT(*)::text AS invalidated_last_24h
        FROM fcm_tokens
        WHERE is_active = FALSE
          AND updated_at >= NOW() - INTERVAL '24 hours'
        `
      );
      const eventStatsResult = await pool.query<{
        event_type: string;
        event_count: string;
        sent_total: string;
      }>(
        `
        SELECT
          event_type,
          COUNT(*)::text AS event_count,
          COALESCE(SUM(sent_count), 0)::text AS sent_total
        FROM release_notification_log
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY event_type
        ORDER BY event_type ASC
        `
      );

      const recentEvents = eventStatsResult.rows.map((row) => ({
        eventType: row.event_type,
        eventCount: Number.parseInt(row.event_count, 10) || 0,
        sentTotal: Number.parseInt(row.sent_total, 10) || 0
      }));

      reply.send({
        windowHours: 24,
        tokens: {
          active: Number.parseInt(tokenStatsResult.rows[0]?.active_tokens ?? '0', 10) || 0,
          inactive: Number.parseInt(tokenStatsResult.rows[0]?.inactive_tokens ?? '0', 10) || 0,
          invalidatedLast24h:
            Number.parseInt(recentInvalidResult.rows[0]?.invalidated_last_24h ?? '0', 10) || 0
        },
        events: recentEvents
      });
    }
  );

  app.post(
    '/v1/notifications/fcm/register',
    {
      config: {
        rateLimit: REGISTER_RATE_LIMIT
      }
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as RegisterBody;
      const token = normalizeToken(body.token);

      if (token === null) {
        reply.code(400).send({ error: 'Invalid token.' });
        return;
      }

      const platform = normalizePlatform(body.platform);
      const appVersion = normalizeOptionalString(body.appVersion, 64);
      const userAgent = normalizeOptionalString(body.userAgent, 512);
      const timezone = normalizeOptionalString(body.timezone, 128);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `
        INSERT INTO fcm_tokens (token, platform, is_active, timezone, app_version, user_agent, last_seen_at, created_at, updated_at)
        VALUES ($1, $2, TRUE, $3, $4, $5, NOW(), NOW(), NOW())
        ON CONFLICT (token)
        DO UPDATE SET
          platform = EXCLUDED.platform,
          is_active = TRUE,
          timezone = EXCLUDED.timezone,
          app_version = EXCLUDED.app_version,
          user_agent = EXCLUDED.user_agent,
          last_seen_at = NOW(),
          updated_at = NOW()
        `,
          [token, platform, timezone, appVersion, userAgent]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      reply.send({ ok: true });
    }
  );

  app.post(
    '/v1/notifications/fcm/unregister',
    {
      config: {
        rateLimit: UNREGISTER_RATE_LIMIT
      }
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as UnregisterBody;
      const token = normalizeToken(body.token);

      if (token === null) {
        reply.code(400).send({ error: 'Invalid token.' });
        return;
      }

      await pool.query(
        `
        UPDATE fcm_tokens
        SET is_active = FALSE, updated_at = NOW()
        WHERE token = $1
        `,
        [token]
      );

      reply.send({ ok: true });
    }
  );

  app.post(
    '/v1/notifications/test',
    {
      config: {
        rateLimit: TEST_RATE_LIMIT
      }
    },
    async (_request, reply) => {
      if (!config.notificationsTestEndpointEnabled) {
        reply.code(404).send({ error: 'Not found' });
        return;
      }
      if (!isNotificationAdminAuthorized(_request, reply)) {
        return;
      }

      const result = await pool.query<{ token: string }>(
        `
        SELECT token
        FROM fcm_tokens
        WHERE is_active = TRUE
        ORDER BY token ASC
        LIMIT $1
        `,
        [TEST_ENDPOINT_MAX_ACTIVE_TOKENS]
      );
      const tokens = result.rows.map((row) => row.token);
      const sendResult = await sendFcmMulticast(tokens, {
        title: 'Game Shelf Test Notification',
        body: `Sent at ${new Date().toISOString()}`,
        data: {
          eventType: 'test',
          route: '/tabs/wishlist'
        }
      });

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

      reply.send({
        ok: true,
        ...sendResult
      });
    }
  );
}

function isNotificationAdminAuthorized(
  request: FastifyRequest,
  reply: { code: (statusCode: number) => { send: (payload: unknown) => void } }
): boolean {
  const authorized = isAuthorizedMutatingRequest({
    requireAuth: config.requireAuth,
    apiToken: config.apiToken,
    clientWriteTokens: [],
    authorizationHeader: request.headers.authorization,
    clientWriteTokenHeader: undefined
  });

  if (!authorized) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }

  return true;
}

function normalizeToken(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length >= 16 && normalized.length <= 512 ? normalized : null;
}

function normalizePlatform(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';

  if (normalized === 'web' || normalized === 'android' || normalized === 'ios') {
    return normalized;
  }

  return 'unknown';
}

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';

  if (normalized.length === 0) {
    return null;
  }

  return normalized.slice(0, maxLength);
}
