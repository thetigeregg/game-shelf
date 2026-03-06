import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerNotificationRoutes } from '../notifications.js';

interface TokenRow {
  token: string;
  platform: string;
  is_active: boolean;
  timezone: string | null;
  app_version: string | null;
  user_agent: string | null;
}

class MockClient {
  constructor(private readonly pool: MockNotificationsPool) {}

  query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    return this.pool.query(sql, params);
  }

  release(): void {}
}

class MockNotificationsPool {
  private readonly tokens = new Map<string, TokenRow>();

  seedToken(row: TokenRow): void {
    this.tokens.set(row.token, { ...row });
  }

  getToken(token: string): TokenRow | null {
    return this.tokens.get(token) ?? null;
  }

  connect(): Promise<MockClient> {
    return Promise.resolve(new MockClient(this));
  }

  query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (
      normalizedSql.startsWith(
        'insert into fcm_tokens (token, platform, is_active, timezone, app_version, user_agent, last_seen_at, created_at, updated_at)'
      )
    ) {
      const token = toStringOrFallback(params[0], '');
      const platform = toStringOrFallback(params[1], 'unknown');
      const timezone = normalizeNullableString(params[2]);
      const appVersion = normalizeNullableString(params[3]);
      const userAgent = normalizeNullableString(params[4]);
      const previous = this.tokens.get(token);

      this.tokens.set(token, {
        token,
        platform,
        is_active: true,
        timezone,
        app_version: appVersion,
        user_agent: userAgent ?? previous?.user_agent ?? null
      });

      return Promise.resolve({ rows: [] });
    }

    if (
      normalizedSql.startsWith(
        'update fcm_tokens set is_active = false, updated_at = now() where token = $1'
      )
    ) {
      const token = toStringOrFallback(params[0], '');
      const existing = this.tokens.get(token);
      if (existing) {
        this.tokens.set(token, {
          ...existing,
          is_active: false
        });
      }
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  }
}

function toStringOrFallback(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    return value;
  }
  return fallback;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

void test('FCM register keeps existing active tokens on other devices', async () => {
  const pool = new MockNotificationsPool();
  pool.seedToken({
    token: 'existing-token-aaaaaaaa',
    platform: 'ios',
    is_active: true,
    timezone: 'Europe/Zurich',
    app_version: '17.4',
    user_agent: 'ua-ios'
  });

  const app = Fastify();
  registerNotificationRoutes(app, pool as unknown as Pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/notifications/fcm/register',
    payload: {
      token: 'new-token-bbbbbbbbbbbb',
      platform: 'web',
      timezone: 'Europe/Zurich',
      appVersion: 'Firefox',
      userAgent: 'ua-web'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(pool.getToken('existing-token-aaaaaaaa')?.is_active, true);
  assert.equal(pool.getToken('new-token-bbbbbbbbbbbb')?.is_active, true);

  await app.close();
});

void test('FCM unregister deactivates only the requested token', async () => {
  const pool = new MockNotificationsPool();
  pool.seedToken({
    token: 'token-a-aaaaaaaaaaaa',
    platform: 'web',
    is_active: true,
    timezone: null,
    app_version: null,
    user_agent: null
  });
  pool.seedToken({
    token: 'token-b-bbbbbbbbbbbb',
    platform: 'ios',
    is_active: true,
    timezone: null,
    app_version: null,
    user_agent: null
  });

  const app = Fastify();
  registerNotificationRoutes(app, pool as unknown as Pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/notifications/fcm/unregister',
    payload: {
      token: 'token-a-aaaaaaaaaaaa'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(pool.getToken('token-a-aaaaaaaaaaaa')?.is_active, false);
  assert.equal(pool.getToken('token-b-bbbbbbbbbbbb')?.is_active, true);

  await app.close();
});
