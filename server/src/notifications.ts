import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { config } from './config.js';
import { sendFcmMulticast } from './fcm.js';

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

export function registerNotificationRoutes(app: FastifyInstance, pool: Pool): void {
  app.post('/v1/notifications/fcm/register', async (request, reply) => {
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
      await client.query('UPDATE fcm_tokens SET is_active = FALSE, updated_at = NOW() WHERE token <> $1', [token]);
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
        [token, platform, timezone, appVersion, userAgent],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    reply.send({ ok: true });
  });

  app.post('/v1/notifications/fcm/unregister', async (request, reply) => {
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
      [token],
    );

    reply.send({ ok: true });
  });

  app.post('/v1/notifications/test', async (_request, reply) => {
    if (!config.releaseMonitorDebugLogs) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }

    const result = await pool.query<{ token: string }>(
      `
      SELECT token
      FROM fcm_tokens
      WHERE is_active = TRUE
      `,
    );
    const tokens = result.rows.map(row => row.token);
    const sendResult = await sendFcmMulticast(tokens, {
      title: 'Game Shelf Test Notification',
      body: `Sent at ${new Date().toISOString()}`,
      data: {
        eventType: 'test',
        route: '/tabs/wishlist',
      },
    });

    if (sendResult.invalidTokens.length > 0) {
      await pool.query(
        `
        UPDATE fcm_tokens
        SET is_active = FALSE, updated_at = NOW()
        WHERE token = ANY($1::text[])
        `,
        [sendResult.invalidTokens],
      );
    }

    reply.send({
      ok: true,
      ...sendResult,
    });
  });
}

function normalizeToken(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length >= 16 ? normalized : null;
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
