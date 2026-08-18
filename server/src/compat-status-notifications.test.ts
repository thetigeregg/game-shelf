import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { MAX_NOTIFICATION_BODY, MAX_NOTIFICATION_TITLE } from './notification-copy-policy.js';
import { maybeSendCompatibilityStatusNotification } from './compat-status-notifications.js';

interface NotificationLogRow {
  eventKey: string;
  sentCount: number;
}

class CompatNotificationPoolMock {
  private readonly settingRows: Array<{ setting_key: string; setting_value: string }> = [];
  private readonly tokenRows: Array<{ token: string }> = [];
  private readonly logs = new Map<string, NotificationLogRow>();
  invalidationBatches: string[][] = [];

  setPreferences(enabled: boolean | string, compatibilityChangedEnabled: boolean | string): void {
    this.settingRows.length = 0;
    this.settingRows.push({
      setting_key: 'game-shelf:notifications:release:enabled',
      setting_value: String(enabled),
    });
    this.settingRows.push({
      setting_key: 'game-shelf:notifications:release:events',
      setting_value: JSON.stringify({ compatibilityChanged: compatibilityChangedEnabled }),
    });
  }

  setTokens(tokens: string[]): void {
    this.tokenRows.length = 0;
    tokens.forEach((token) => {
      this.tokenRows.push({ token });
    });
  }

  getLogCount(): number {
    return this.logs.size;
  }

  hasPendingZeroSentLog(): boolean {
    return [...this.logs.values()].some((entry) => entry.sentCount === 0);
  }

  query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalizedSql.startsWith('select setting_key, setting_value from settings')) {
      return Promise.resolve({ rows: [...this.settingRows], rowCount: this.settingRows.length });
    }

    if (
      normalizedSql.startsWith(
        'select token from fcm_tokens where is_active = true order by token asc limit $1'
      )
    ) {
      return Promise.resolve({ rows: [...this.tokenRows], rowCount: this.tokenRows.length });
    }

    if (normalizedSql.startsWith('insert into release_notification_log')) {
      const eventKey = typeof params[3] === 'string' ? params[3] : '';
      if (!eventKey || this.logs.has(eventKey)) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      this.logs.set(eventKey, { eventKey, sentCount: 0 });
      return Promise.resolve({ rows: [{ inserted: 1 }], rowCount: 1 });
    }

    if (normalizedSql.startsWith('update release_notification_log set payload = $1::jsonb')) {
      const eventKey = typeof params[2] === 'string' ? params[2] : '';
      const sentCount = typeof params[1] === 'number' ? params[1] : 0;
      const existing = this.logs.get(eventKey);
      if (!existing) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      this.logs.set(eventKey, { eventKey, sentCount });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (
      normalizedSql.startsWith(
        'delete from release_notification_log where event_key = $1 and sent_count = 0'
      )
    ) {
      const eventKey = typeof params[0] === 'string' ? params[0] : '';
      const existing = this.logs.get(eventKey);
      if (existing && existing.sentCount === 0) {
        this.logs.delete(eventKey);
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (normalizedSql.startsWith('update fcm_tokens set is_active = false, updated_at = now()')) {
      const tokens = Array.isArray(params[0])
        ? params[0].filter((token): token is string => typeof token === 'string')
        : [];
      this.invalidationBatches.push(tokens);
      return Promise.resolve({ rows: [], rowCount: tokens.length });
    }

    throw new Error(`Unsupported SQL in CompatNotificationPoolMock: ${sql}`);
  }
}

void test('sends notification with from/to detail when status changes', async () => {
  const pool = new CompatNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(['token-a']);
  const sends: Array<{ title: string; body: string; data: Record<string, string> }> = [];

  await maybeSendCompatibilityStatusNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '100',
      platformIgdbId: 8,
      title: 'Elden Ring',
      platformDisplayName: 'PlayStation 2',
      previousStatus: 'incomplete',
      nextStatus: 'playable',
    },
    {
      sendMulticast: (_tokens, payload) => {
        sends.push(payload);
        return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
      },
    }
  );

  assert.equal(sends.length, 1);
  assert.equal(sends[0]?.title, 'Compatibility updated');
  assert.equal(sends[0]?.body, 'Elden Ring: PlayStation 2: Incomplete -> Playable.');
  assert.ok((sends[0]?.title.length ?? 0) <= MAX_NOTIFICATION_TITLE);
  assert.ok((sends[0]?.body.length ?? 0) <= MAX_NOTIFICATION_BODY);
  assert.equal(sends[0]?.data['eventType'], 'compat_status_changed');
  assert.equal(sends[0]?.data['route'], '/tabs/collection');
  assert.equal(sends[0]?.data['previousStatus'], 'incomplete');
  assert.equal(sends[0]?.data['nextStatus'], 'playable');
  assert.equal(pool.getLogCount(), 1);
});

void test('uses first-time-set wording when there is no previous status', async () => {
  const pool = new CompatNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(['token-a']);
  const sends: Array<{ body: string }> = [];

  await maybeSendCompatibilityStatusNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '101',
      platformIgdbId: 9,
      title: 'Bloodborne',
      platformDisplayName: 'PlayStation 3',
      previousStatus: null,
      nextStatus: 'perfect',
    },
    {
      sendMulticast: (_tokens, payload) => {
        sends.push(payload);
        return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
      },
    }
  );

  assert.equal(sends.length, 1);
  assert.equal(sends[0]?.body, 'Bloodborne: PlayStation 3: Perfect.');
});

void test('fits worst-case platform/status combination within the body budget', async () => {
  const pool = new CompatNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(['token-a']);
  const sends: Array<{ body: string }> = [];

  await maybeSendCompatibilityStatusNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '102',
      platformIgdbId: 46,
      title: 'A',
      platformDisplayName: 'PlayStation Vita',
      previousStatus: 'incomplete',
      nextStatus: 'playable',
    },
    {
      sendMulticast: (_tokens, payload) => {
        sends.push(payload);
        return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
      },
    }
  );

  assert.equal(sends.length, 1);
  assert.ok((sends[0]?.body.length ?? 0) <= MAX_NOTIFICATION_BODY);
  assert.ok(sends[0]?.body.includes('PlayStation Vita: Incomplete -> Playable.'));
});

void test('skips notification when status is unchanged', async () => {
  const pool = new CompatNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(['token-a']);
  let sendCount = 0;

  await maybeSendCompatibilityStatusNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '200',
      platformIgdbId: 8,
      title: 'No Change',
      platformDisplayName: 'PlayStation 2',
      previousStatus: 'playable',
      nextStatus: 'playable',
    },
    {
      sendMulticast: () => {
        sendCount += 1;
        return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
      },
    }
  );

  assert.equal(sendCount, 0);
  assert.equal(pool.getLogCount(), 0);
});

void test('skips notification when disabled or no active tokens', async () => {
  const pool = new CompatNotificationPoolMock();
  let sendCount = 0;
  const send = () => {
    sendCount += 1;
    return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
  };

  pool.setPreferences(false, true);
  pool.setTokens(['token-a']);
  await maybeSendCompatibilityStatusNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '300',
      platformIgdbId: 8,
      title: 'Master Off',
      platformDisplayName: 'PlayStation 2',
      previousStatus: 'incomplete',
      nextStatus: 'perfect',
    },
    { sendMulticast: send }
  );

  pool.setPreferences(true, false);
  await maybeSendCompatibilityStatusNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '301',
      platformIgdbId: 8,
      title: 'Event Off',
      platformDisplayName: 'PlayStation 2',
      previousStatus: 'incomplete',
      nextStatus: 'perfect',
    },
    { sendMulticast: send }
  );

  pool.setPreferences(true, true);
  pool.setTokens([]);
  await maybeSendCompatibilityStatusNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '302',
      platformIgdbId: 8,
      title: 'No Tokens',
      platformDisplayName: 'PlayStation 2',
      previousStatus: 'incomplete',
      nextStatus: 'perfect',
    },
    { sendMulticast: send }
  );

  assert.equal(sendCount, 0);
  assert.equal(pool.getLogCount(), 0);
});

void test('dedupes repeated calls for the same transition on the same day', async () => {
  const pool = new CompatNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(['token-a']);
  let sendCount = 0;
  const params = {
    igdbGameId: '400',
    platformIgdbId: 8,
    title: 'Duplicate Test',
    platformDisplayName: 'PlayStation 2',
    previousStatus: 'incomplete' as const,
    nextStatus: 'playable' as const,
  };

  const send = () => {
    sendCount += 1;
    return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
  };

  await maybeSendCompatibilityStatusNotification(pool as unknown as Pool, params, {
    sendMulticast: send,
  });
  await maybeSendCompatibilityStatusNotification(pool as unknown as Pool, params, {
    sendMulticast: send,
  });

  assert.equal(sendCount, 1);
  assert.equal(pool.getLogCount(), 1);
});

void test('deactivates invalid tokens when send has zero successes', async () => {
  const pool = new CompatNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(['token-a']);

  await maybeSendCompatibilityStatusNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '500',
      platformIgdbId: 8,
      title: 'Invalid Token Test',
      platformDisplayName: 'PlayStation 2',
      previousStatus: 'incomplete',
      nextStatus: 'perfect',
    },
    {
      sendMulticast: () =>
        Promise.resolve({ successCount: 0, failureCount: 1, invalidTokens: ['token-a'] }),
    }
  );

  assert.deepEqual(pool.invalidationBatches, [['token-a']]);
  assert.equal(pool.getLogCount(), 0);
});

void test('releases reservation when sendMulticast throws', async () => {
  const pool = new CompatNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(['token-a']);

  await assert.rejects(
    maybeSendCompatibilityStatusNotification(
      pool as unknown as Pool,
      {
        igdbGameId: '600',
        platformIgdbId: 8,
        title: 'Send Failure Test',
        platformDisplayName: 'PlayStation 2',
        previousStatus: 'incomplete',
        nextStatus: 'perfect',
      },
      {
        sendMulticast: () => Promise.reject(new Error('send_failed')),
      }
    ),
    /send_failed/
  );

  assert.equal(pool.getLogCount(), 0);
  assert.equal(pool.hasPendingZeroSentLog(), false);
});
