import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { config } from '../config.js';
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
  private readonly inactiveTokens = new Set<string>();
  private readonly queryCalls: string[] = [];

  seedToken(row: TokenRow): void {
    this.tokens.set(row.token, { ...row });
  }

  getToken(token: string): TokenRow | null {
    return this.tokens.get(token) ?? null;
  }

  getQueryCalls(): string[] {
    return [...this.queryCalls];
  }

  connect(): Promise<MockClient> {
    return Promise.resolve(new MockClient(this));
  }

  query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    this.queryCalls.push(normalizedSql);

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
        user_agent: userAgent ?? previous?.user_agent ?? null,
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
          is_active: false,
        });
      }
      return Promise.resolve({ rows: [] });
    }

    if (
      normalizedSql.startsWith(
        'select count(*) filter (where is_active = true)::text as active_tokens'
      )
    ) {
      return Promise.resolve({
        rows: [
          {
            active_tokens: String(this.tokens.size),
            inactive_tokens: String(this.inactiveTokens.size),
          },
        ],
      });
    }

    if (normalizedSql.startsWith('select count(*)::text as invalidated_last_24h from fcm_tokens')) {
      return Promise.resolve({ rows: [{ invalidated_last_24h: '1' }] });
    }

    if (normalizedSql.startsWith('select event_type, count(*)::text as event_count')) {
      return Promise.resolve({
        rows: [{ event_type: 'release_date_set', event_count: '2', sent_total: '3' }],
      });
    }

    if (normalizedSql.startsWith('select token from fcm_tokens where is_active = true')) {
      return Promise.resolve({
        rows: [...this.tokens.keys()].map((token) => ({ token })),
      });
    }

    if (
      normalizedSql.startsWith(
        'update fcm_tokens set is_active = false, updated_at = now() where token = any'
      )
    ) {
      const invalidTokens = Array.isArray(params[0]) ? (params[0] as string[]) : [];
      invalidTokens.forEach((token) => {
        const existing = this.tokens.get(token);
        if (existing) {
          this.tokens.set(token, { ...existing, is_active: false });
        }
      });
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

function parseObservabilityBody(raw: string): {
  windowHours: number;
  tokens: { active: number; inactive: number; invalidatedLast24h: number };
  events: Array<{ eventType: string; eventCount: number; sentTotal: number }>;
} {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('invalid observability response');
  }
  const candidate = parsed as {
    windowHours?: unknown;
    tokens?: { active?: unknown; inactive?: unknown; invalidatedLast24h?: unknown };
    events?: Array<{ eventType?: unknown; eventCount?: unknown; sentTotal?: unknown }>;
  };

  return {
    windowHours: typeof candidate.windowHours === 'number' ? candidate.windowHours : 0,
    tokens: {
      active: typeof candidate.tokens?.active === 'number' ? candidate.tokens.active : 0,
      inactive: typeof candidate.tokens?.inactive === 'number' ? candidate.tokens.inactive : 0,
      invalidatedLast24h:
        typeof candidate.tokens?.invalidatedLast24h === 'number'
          ? candidate.tokens.invalidatedLast24h
          : 0,
    },
    events: Array.isArray(candidate.events)
      ? candidate.events.map((entry) => ({
          eventType: typeof entry.eventType === 'string' ? entry.eventType : '',
          eventCount: typeof entry.eventCount === 'number' ? entry.eventCount : 0,
          sentTotal: typeof entry.sentTotal === 'number' ? entry.sentTotal : 0,
        }))
      : [],
  };
}

function parseTestBody(raw: string): { ok: boolean; successCount: number; failureCount: number } {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('invalid test response');
  }
  const candidate = parsed as { ok?: unknown; successCount?: unknown; failureCount?: unknown };
  return {
    ok: candidate.ok === true,
    successCount: typeof candidate.successCount === 'number' ? candidate.successCount : 0,
    failureCount: typeof candidate.failureCount === 'number' ? candidate.failureCount : 0,
  };
}

void test('FCM register keeps existing active tokens on other devices', async () => {
  const pool = new MockNotificationsPool();
  pool.seedToken({
    token: 'existing-token-aaaaaaaa',
    platform: 'ios',
    is_active: true,
    timezone: 'Europe/Zurich',
    app_version: '17.4',
    user_agent: 'ua-ios',
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
      userAgent: 'ua-web',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(pool.getToken('existing-token-aaaaaaaa')?.is_active, true);
  assert.equal(pool.getToken('new-token-bbbbbbbbbbbb')?.is_active, true);

  await app.close();
});

void test('FCM register rejects oversized tokens', async () => {
  const pool = new MockNotificationsPool();
  const app = Fastify();
  registerNotificationRoutes(app, pool as unknown as Pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/notifications/fcm/register',
    payload: {
      token: `token-${'x'.repeat(600)}`,
      platform: 'web',
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(
    pool.getQueryCalls().some((sql) => sql.startsWith('insert into fcm_tokens')),
    false
  );

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
    user_agent: null,
  });
  pool.seedToken({
    token: 'token-b-bbbbbbbbbbbb',
    platform: 'ios',
    is_active: true,
    timezone: null,
    app_version: null,
    user_agent: null,
  });

  const app = Fastify();
  registerNotificationRoutes(app, pool as unknown as Pool);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/notifications/fcm/unregister',
    payload: {
      token: 'token-a-aaaaaaaaaaaa',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(pool.getToken('token-a-aaaaaaaaaaaa')?.is_active, false);
  assert.equal(pool.getToken('token-b-bbbbbbbbbbbb')?.is_active, true);

  await app.close();
});

void test('notifications observability is gated and requires auth when enabled', async () => {
  const pool = new MockNotificationsPool();
  const app = Fastify();

  const originalEnabled = config.notificationsObservabilityEndpointEnabled;
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  config.notificationsObservabilityEndpointEnabled = false;
  config.requireAuth = true;
  config.apiToken = 'admin-token';

  try {
    registerNotificationRoutes(app, pool as unknown as Pool);

    const disabledResponse = await app.inject({
      method: 'GET',
      url: '/v1/notifications/observability',
    });
    assert.equal(disabledResponse.statusCode, 404);

    config.notificationsObservabilityEndpointEnabled = true;

    const unauthorizedResponse = await app.inject({
      method: 'GET',
      url: '/v1/notifications/observability',
    });
    assert.equal(unauthorizedResponse.statusCode, 401);

    const clientTokenUnauthorizedResponse = await app.inject({
      method: 'GET',
      url: '/v1/notifications/observability',
      headers: {
        'x-game-shelf-client-token': 'client-write-token',
      },
    });
    assert.equal(clientTokenUnauthorizedResponse.statusCode, 401);

    const authorizedResponse = await app.inject({
      method: 'GET',
      url: '/v1/notifications/observability',
      headers: {
        authorization: 'Bearer admin-token',
      },
    });
    assert.equal(authorizedResponse.statusCode, 200);

    const body = parseObservabilityBody(authorizedResponse.body);
    assert.equal(body.windowHours, 24);
    assert.equal(body.tokens.invalidatedLast24h, 1);
    assert.equal(body.events[0]?.eventType, 'release_date_set');
  } finally {
    config.notificationsObservabilityEndpointEnabled = originalEnabled;
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    await app.close();
  }
});

void test('notifications test endpoint is gated and requires auth when enabled', async () => {
  const pool = new MockNotificationsPool();
  pool.seedToken({
    token: 'token-a-aaaaaaaaaaaa',
    platform: 'web',
    is_active: true,
    timezone: null,
    app_version: null,
    user_agent: null,
  });
  const app = Fastify();

  const originalEnabled = config.notificationsTestEndpointEnabled;
  const originalRequireAuth = config.requireAuth;
  const originalApiToken = config.apiToken;
  const originalClientWriteTokens = config.clientWriteTokens;
  const originalFirebaseJson = config.firebaseServiceAccountJson;
  config.notificationsTestEndpointEnabled = false;
  config.requireAuth = true;
  config.apiToken = 'admin-token';
  config.clientWriteTokens = ['client-write-token'];
  config.firebaseServiceAccountJson = '';

  try {
    registerNotificationRoutes(app, pool as unknown as Pool);

    const disabledResponse = await app.inject({
      method: 'POST',
      url: '/v1/notifications/test',
      payload: {},
    });
    assert.equal(disabledResponse.statusCode, 404);

    config.notificationsTestEndpointEnabled = true;

    const unauthorizedResponse = await app.inject({
      method: 'POST',
      url: '/v1/notifications/test',
      payload: {},
    });
    assert.equal(unauthorizedResponse.statusCode, 401);

    const clientTokenUnauthorizedResponse = await app.inject({
      method: 'POST',
      url: '/v1/notifications/test',
      payload: {},
      headers: {
        'x-game-shelf-client-token': 'client-write-token',
      },
    });
    assert.equal(clientTokenUnauthorizedResponse.statusCode, 401);

    const authorizedResponse = await app.inject({
      method: 'POST',
      url: '/v1/notifications/test',
      payload: {},
      headers: {
        authorization: 'Bearer admin-token',
      },
    });
    assert.equal(authorizedResponse.statusCode, 200);
    const body = parseTestBody(authorizedResponse.body);
    assert.equal(body.ok, true);
    assert.equal(body.failureCount, 1);
  } finally {
    config.notificationsTestEndpointEnabled = originalEnabled;
    config.requireAuth = originalRequireAuth;
    config.apiToken = originalApiToken;
    config.clientWriteTokens = originalClientWriteTokens;
    config.firebaseServiceAccountJson = originalFirebaseJson;
    await app.close();
  }
});
