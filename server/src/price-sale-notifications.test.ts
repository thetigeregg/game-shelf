import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { maybeSendWishlistSaleNotification } from './price-sale-notifications.js';

interface NotificationLogRow {
  eventKey: string;
  sentCount: number;
}

class SaleNotificationPoolMock {
  private readonly settingRows: Array<{ setting_key: string; setting_value: string }> = [];
  private readonly tokenRows: Array<{ token: string }> = [];
  private readonly logs = new Map<string, NotificationLogRow>();
  invalidationBatches: string[][] = [];
  tokenSelectCount = 0;
  throwOnFinalizeUpdate = false;
  throwOnTokenInvalidation = false;

  setPreferences(enabled: boolean, saleEnabled: boolean): void {
    this.settingRows.length = 0;
    this.settingRows.push({
      setting_key: 'game-shelf:notifications:release:enabled',
      setting_value: enabled ? 'true' : 'false'
    });
    this.settingRows.push({
      setting_key: 'game-shelf:notifications:release:events',
      setting_value: JSON.stringify({ sale: saleEnabled })
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

  getSentCountForEvent(eventKey: string): number | null {
    return this.logs.get(eventKey)?.sentCount ?? null;
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
      this.tokenSelectCount += 1;
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
      if (this.throwOnFinalizeUpdate) {
        throw new Error('finalize_failed');
      }
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
      if (this.throwOnTokenInvalidation) {
        throw new Error('token_invalidation_failed');
      }
      const tokens = Array.isArray(params[0])
        ? params[0].filter((token): token is string => typeof token === 'string')
        : [];
      this.invalidationBatches.push(tokens);
      return Promise.resolve({ rows: [], rowCount: tokens.length });
    }

    throw new Error(`Unsupported SQL in SaleNotificationPoolMock: ${sql}`);
  }
}

void test('sends notification for wishlist transition from not-on-sale to on-sale', async () => {
  const pool = new SaleNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(['token-a']);
  const sends: Array<{ title: string; body: string; data: Record<string, string> }> = [];

  await maybeSendWishlistSaleNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '100',
      platformIgdbId: 6,
      previousPayload: {
        listType: 'wishlist',
        title: 'Elden Ring',
        priceAmount: 59.99,
        priceRegularAmount: 59.99,
        priceDiscountPercent: 0,
        priceIsFree: false
      },
      nextPayload: {
        listType: 'wishlist',
        title: 'Elden Ring',
        priceAmount: 39.99,
        priceRegularAmount: 59.99,
        priceDiscountPercent: 33,
        priceIsFree: false,
        priceCurrency: 'USD',
        priceFetchedAt: '2026-03-12T10:00:00.000Z'
      }
    },
    {
      sendMulticast: (_tokens, payload) => {
        sends.push(payload);
        return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
      }
    }
  );

  assert.equal(sends.length, 1);
  assert.equal(sends[0]?.title, 'Elden Ring is on sale');
  assert.equal(sends[0]?.data['eventType'], 'price_on_sale');
  assert.equal(sends[0]?.data['route'], '/tabs/wishlist');
  assert.equal(pool.getLogCount(), 1);
});

void test('skips notification when game is already on sale', async () => {
  const pool = new SaleNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(['token-a']);
  let sendCount = 0;

  await maybeSendWishlistSaleNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '100',
      platformIgdbId: 6,
      previousPayload: {
        listType: 'wishlist',
        title: 'Elden Ring',
        priceAmount: 49.99,
        priceRegularAmount: 59.99,
        priceDiscountPercent: 16,
        priceIsFree: false
      },
      nextPayload: {
        listType: 'wishlist',
        title: 'Elden Ring',
        priceAmount: 39.99,
        priceRegularAmount: 59.99,
        priceDiscountPercent: 33,
        priceIsFree: false
      }
    },
    {
      sendMulticast: () => {
        sendCount += 1;
        return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
      }
    }
  );

  assert.equal(sendCount, 0);
  assert.equal(pool.getLogCount(), 0);
});

void test('skips notification for non-wishlist or free games', async () => {
  const pool = new SaleNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(['token-a']);
  let sendCount = 0;

  await maybeSendWishlistSaleNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '200',
      platformIgdbId: 167,
      previousPayload: {
        listType: 'collection',
        priceAmount: 59.99,
        priceRegularAmount: 59.99,
        priceDiscountPercent: 0,
        priceIsFree: false
      },
      nextPayload: {
        listType: 'collection',
        priceAmount: 49.99,
        priceRegularAmount: 59.99,
        priceDiscountPercent: 16,
        priceIsFree: false
      }
    },
    {
      sendMulticast: () => {
        sendCount += 1;
        return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
      }
    }
  );

  await maybeSendWishlistSaleNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '201',
      platformIgdbId: 167,
      previousPayload: {
        listType: 'wishlist',
        priceAmount: null,
        priceRegularAmount: null,
        priceDiscountPercent: 0,
        priceIsFree: false
      },
      nextPayload: {
        listType: 'wishlist',
        priceAmount: 0,
        priceRegularAmount: 19.99,
        priceDiscountPercent: 100,
        priceIsFree: true
      }
    },
    {
      sendMulticast: () => {
        sendCount += 1;
        return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
      }
    }
  );

  assert.equal(sendCount, 0);
  assert.equal(pool.getLogCount(), 0);
});

void test('skips notification when disabled or no active tokens', async () => {
  const pool = new SaleNotificationPoolMock();
  let sendCount = 0;

  pool.setPreferences(false, true);
  pool.setTokens(['token-a']);
  await maybeSendWishlistSaleNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '300',
      platformIgdbId: 130,
      previousPayload: {
        listType: 'wishlist',
        priceAmount: 59.99,
        priceRegularAmount: 59.99,
        priceDiscountPercent: 0,
        priceIsFree: false
      },
      nextPayload: {
        listType: 'wishlist',
        priceAmount: 39.99,
        priceRegularAmount: 59.99,
        priceDiscountPercent: 33,
        priceIsFree: false
      }
    },
    {
      sendMulticast: () => {
        sendCount += 1;
        return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
      }
    }
  );

  pool.setPreferences(true, false);
  await maybeSendWishlistSaleNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '301',
      platformIgdbId: 130,
      previousPayload: {
        listType: 'wishlist',
        priceAmount: 59.99,
        priceRegularAmount: 59.99,
        priceDiscountPercent: 0,
        priceIsFree: false
      },
      nextPayload: {
        listType: 'wishlist',
        priceAmount: 39.99,
        priceRegularAmount: 59.99,
        priceDiscountPercent: 33,
        priceIsFree: false
      }
    },
    {
      sendMulticast: () => {
        sendCount += 1;
        return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
      }
    }
  );

  pool.setPreferences(true, true);
  pool.setTokens([]);
  await maybeSendWishlistSaleNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '302',
      platformIgdbId: 130,
      previousPayload: {
        listType: 'wishlist',
        priceAmount: 59.99,
        priceRegularAmount: 59.99,
        priceDiscountPercent: 0,
        priceIsFree: false
      },
      nextPayload: {
        listType: 'wishlist',
        priceAmount: 39.99,
        priceRegularAmount: 59.99,
        priceDiscountPercent: 33,
        priceIsFree: false
      }
    },
    {
      sendMulticast: () => {
        sendCount += 1;
        return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
      }
    }
  );

  assert.equal(sendCount, 0);
  assert.equal(pool.getLogCount(), 0);
});

void test('detects sale via regular/current delta when discount percent is missing', async () => {
  const pool = new SaleNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(['token-a']);
  const bodies: string[] = [];

  await maybeSendWishlistSaleNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '400',
      platformIgdbId: 508,
      previousPayload: {
        listType: 'wishlist',
        title: 'Metroid Prime 4',
        priceAmount: 69.99,
        priceRegularAmount: 69.99,
        priceDiscountPercent: null,
        priceIsFree: false
      },
      nextPayload: {
        listType: 'wishlist',
        title: 'Metroid Prime 4',
        priceAmount: 49.99,
        priceRegularAmount: 69.99,
        priceDiscountPercent: null,
        priceIsFree: false,
        priceCurrency: 'USD',
        priceFetchedAt: '2026-03-12T12:00:00.000Z'
      }
    },
    {
      sendMulticast: (_tokens, payload) => {
        bodies.push(payload.body);
        return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
      }
    }
  );

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]?.includes('(-29%)'), true);
  assert.equal(pool.getLogCount(), 1);
});

void test('releases reservation when sendMulticast throws', async () => {
  const pool = new SaleNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(['token-a']);

  await assert.rejects(
    maybeSendWishlistSaleNotification(
      pool as unknown as Pool,
      {
        igdbGameId: '500',
        platformIgdbId: 48,
        previousPayload: {
          listType: 'wishlist',
          title: 'Wolfenstein II',
          priceAmount: 69.99,
          priceRegularAmount: 69.99,
          priceDiscountPercent: 0,
          priceIsFree: false
        },
        nextPayload: {
          listType: 'wishlist',
          title: 'Wolfenstein II',
          priceAmount: 39.99,
          priceRegularAmount: 69.99,
          priceDiscountPercent: 43,
          priceIsFree: false,
          priceCurrency: 'CHF',
          priceFetchedAt: '2026-03-12T12:30:00.000Z'
        }
      },
      {
        sendMulticast: () => Promise.reject(new Error('send_failed'))
      }
    ),
    /send_failed/
  );

  assert.equal(pool.getLogCount(), 0);
  assert.equal(pool.hasPendingZeroSentLog(), false);
});

void test('deactivates invalid tokens when send has zero successes', async () => {
  const pool = new SaleNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(['token-a']);

  await maybeSendWishlistSaleNotification(
    pool as unknown as Pool,
    {
      igdbGameId: '550',
      platformIgdbId: 48,
      previousPayload: {
        listType: 'wishlist',
        title: 'Invalid Token Test',
        priceAmount: 69.99,
        priceRegularAmount: 69.99,
        priceDiscountPercent: 0,
        priceIsFree: false
      },
      nextPayload: {
        listType: 'wishlist',
        title: 'Invalid Token Test',
        priceAmount: 39.99,
        priceRegularAmount: 69.99,
        priceDiscountPercent: 43,
        priceIsFree: false,
        priceCurrency: 'CHF',
        priceFetchedAt: '2026-03-12T12:40:00.000Z'
      }
    },
    {
      sendMulticast: () =>
        Promise.resolve({ successCount: 0, failureCount: 1, invalidTokens: ['token-a'] })
    }
  );

  assert.deepEqual(pool.invalidationBatches, [['token-a']]);
  assert.equal(pool.getLogCount(), 0);
});

void test('loads active tokens only for dedupe reservation winner', async () => {
  const pool = new SaleNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(['token-a']);

  let sendCount = 0;
  const params = {
    igdbGameId: '600',
    platformIgdbId: 48,
    previousPayload: {
      listType: 'wishlist',
      title: 'Duplicate Test Game',
      priceAmount: 49.99,
      priceRegularAmount: 49.99,
      priceDiscountPercent: 0,
      priceIsFree: false
    },
    nextPayload: {
      listType: 'wishlist',
      title: 'Duplicate Test Game',
      priceAmount: 29.99,
      priceRegularAmount: 49.99,
      priceDiscountPercent: 40,
      priceIsFree: false,
      priceCurrency: 'USD',
      priceFetchedAt: '2026-03-12T13:00:00.000Z'
    }
  };

  await maybeSendWishlistSaleNotification(pool as unknown as Pool, params, {
    sendMulticast: () => {
      sendCount += 1;
      return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
    }
  });

  await maybeSendWishlistSaleNotification(pool as unknown as Pool, params, {
    sendMulticast: () => {
      sendCount += 1;
      return Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] });
    }
  });

  assert.equal(sendCount, 1);
  assert.equal(pool.tokenSelectCount, 1);
});

void test('warns when active token load reaches cap', async () => {
  const pool = new SaleNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(
    Array.from({ length: 20_000 }, (_value, index) => `token-${String(index).padStart(5, '0')}`)
  );

  const warnCalls: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnCalls.push(args);
  };

  try {
    await maybeSendWishlistSaleNotification(
      pool as unknown as Pool,
      {
        igdbGameId: '601',
        platformIgdbId: 167,
        previousPayload: {
          listType: 'wishlist',
          title: 'Cap Warning Test',
          priceAmount: 59.99,
          priceRegularAmount: 59.99,
          priceDiscountPercent: 0,
          priceIsFree: false
        },
        nextPayload: {
          listType: 'wishlist',
          title: 'Cap Warning Test',
          priceAmount: 39.99,
          priceRegularAmount: 59.99,
          priceDiscountPercent: 33,
          priceIsFree: false,
          priceCurrency: 'USD',
          priceFetchedAt: '2026-03-12T13:10:00.000Z'
        }
      },
      {
        sendMulticast: () =>
          Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] })
      }
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(
    warnCalls.some(
      (args) =>
        typeof args[0] === 'string' &&
        args[0].includes('[price-sale-notifications] active_tokens_capped')
    ),
    true
  );
});

void test('keeps reservation when persistence fails after successful send', async () => {
  const pool = new SaleNotificationPoolMock();
  pool.setPreferences(true, true);
  pool.setTokens(['token-a']);
  pool.throwOnFinalizeUpdate = true;

  await assert.rejects(
    maybeSendWishlistSaleNotification(
      pool as unknown as Pool,
      {
        igdbGameId: '602',
        platformIgdbId: 167,
        previousPayload: {
          listType: 'wishlist',
          title: 'Finalize Failure Test',
          priceAmount: 59.99,
          priceRegularAmount: 59.99,
          priceDiscountPercent: 0,
          priceIsFree: false
        },
        nextPayload: {
          listType: 'wishlist',
          title: 'Finalize Failure Test',
          priceAmount: 39.99,
          priceRegularAmount: 59.99,
          priceDiscountPercent: 33,
          priceIsFree: false,
          priceCurrency: 'USD',
          priceFetchedAt: '2026-03-12T13:20:00.000Z'
        }
      },
      {
        sendMulticast: () =>
          Promise.resolve({ successCount: 1, failureCount: 0, invalidTokens: [] })
      }
    ),
    /finalize_failed/
  );

  assert.equal(pool.getLogCount(), 1);
  assert.equal(pool.hasPendingZeroSentLog(), true);
});
