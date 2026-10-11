import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { config } from '../config.js';
import {
  describeErrorCause,
  enqueueForcedCompatRefreshJobs,
  isCompatRefreshDue,
  isCompatRetryBackoffActive,
  refreshCompatSource,
} from './refresh.js';

void test('isCompatRefreshDue is true when never refreshed', () => {
  assert.equal(isCompatRefreshDue(null, 7, new Date('2026-08-17T00:00:00Z')), true);
});

void test('isCompatRefreshDue is true when the stored timestamp is unparsable', () => {
  assert.equal(isCompatRefreshDue('not-a-date', 7, new Date('2026-08-17T00:00:00Z')), true);
});

void test('isCompatRefreshDue respects the configured refresh cadence', () => {
  const now = new Date('2026-08-17T00:00:00Z');
  const sixDaysAgo = new Date('2026-08-11T01:00:00Z').toISOString();
  const eightDaysAgo = new Date('2026-08-09T00:00:00Z').toISOString();

  assert.equal(isCompatRefreshDue(sixDaysAgo, 7, now), false);
  assert.equal(isCompatRefreshDue(eightDaysAgo, 7, now), true);
});

void test('isCompatRefreshDue treats a non-positive refreshDays as at least one day', () => {
  const now = new Date('2026-08-17T00:00:00Z');
  const twelveHoursAgo = new Date('2026-08-16T12:00:00Z').toISOString();
  assert.equal(isCompatRefreshDue(twelveHoursAgo, 0, now), false);
});

void test('isCompatRetryBackoffActive is false when no retry is scheduled or it is unparsable', () => {
  const now = new Date('2026-08-17T00:00:00Z');
  assert.equal(isCompatRetryBackoffActive(null, now), false);
  assert.equal(isCompatRetryBackoffActive('not-a-date', now), false);
});

void test('isCompatRetryBackoffActive is true only until the scheduled retry time', () => {
  const now = new Date('2026-08-17T00:00:00Z');
  assert.equal(isCompatRetryBackoffActive('2026-08-17T00:30:00Z', now), true);
  assert.equal(isCompatRetryBackoffActive('2026-08-17T00:00:00Z', now), false);
  assert.equal(isCompatRetryBackoffActive('2026-08-16T23:00:00Z', now), false);
});

void test('describeErrorCause surfaces the code and message of an Error cause', () => {
  const cause = Object.assign(new Error('getaddrinfo ENOTFOUND example.test'), {
    code: 'ENOTFOUND',
  });
  assert.deepEqual(describeErrorCause(new TypeError('fetch failed', { cause })), {
    cause: 'getaddrinfo ENOTFOUND example.test',
    causeCode: 'ENOTFOUND',
  });
});

void test('describeErrorCause falls back to the cause name, stringifies non-Error causes, and omits missing ones', () => {
  assert.deepEqual(
    describeErrorCause(new Error('fetch failed', { cause: new AggregateError([], '') })),
    { cause: 'AggregateError' }
  );
  assert.deepEqual(describeErrorCause(new Error('boom', { cause: 'socket closed' })), {
    cause: 'socket closed',
  });
  assert.deepEqual(describeErrorCause(new Error('boom')), {});
  assert.deepEqual(describeErrorCause('boom'), {});
});

interface StoredStatusRow {
  igdb_game_id: string;
  normalized_status: string;
  match_locked: boolean;
  raw_source_id?: string | null;
  match_query_title?: string | null;
}

class FakeCompatPool {
  ownedGames: Array<{ igdb_game_id: string; title: string }> = [];
  statuses = new Map<string, StoredStatusRow>();
  sourceState: { sql: string; params: unknown[] } | null = null;
  sourceStateRows: Array<{
    platform_igdb_id: number;
    last_refreshed_at: string | null;
    next_retry_at: string | null;
  }> = [];
  gamePayloads = new Map<string, Record<string, unknown>>();
  syncEventCount = 0;
  notificationsEnabled = false;
  notificationTokens: string[] = [];
  notificationReserveAttempts = 0;
  lastReservedNotificationBody: string | null = null;
  private readonly notificationLogs = new Set<string>();

  query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('select setting_key, setting_value from settings')) {
      if (!this.notificationsEnabled) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({
        rows: [
          { setting_key: 'game-shelf:notifications:release:enabled', setting_value: 'true' },
          {
            setting_key: 'game-shelf:notifications:release:events',
            setting_value: JSON.stringify({ compatibilityChanged: true }),
          },
        ],
        rowCount: 2,
      });
    }

    if (
      normalized.startsWith(
        'select token from fcm_tokens where is_active = true order by token asc limit $1'
      )
    ) {
      const rows = this.notificationTokens.map((token) => ({ token }));
      return Promise.resolve({ rows, rowCount: rows.length });
    }

    if (normalized.startsWith('insert into release_notification_log')) {
      const eventKey = typeof params[3] === 'string' ? params[3] : '';
      this.notificationReserveAttempts += 1;
      const payloadJson = typeof params[4] === 'string' ? params[4] : null;
      if (payloadJson) {
        this.lastReservedNotificationBody =
          (JSON.parse(payloadJson) as { body?: string }).body ?? null;
      }
      if (!eventKey || this.notificationLogs.has(eventKey)) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      this.notificationLogs.add(eventKey);
      return Promise.resolve({ rows: [{ inserted: 1 }], rowCount: 1 });
    }

    if (normalized.startsWith('update release_notification_log set payload = $1::jsonb')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (
      normalized.startsWith(
        'delete from release_notification_log where event_key = $1 and sent_count = 0'
      )
    ) {
      const eventKey = typeof params[0] === 'string' ? params[0] : '';
      this.notificationLogs.delete(eventKey);
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (normalized.startsWith('update fcm_tokens set is_active = false, updated_at = now()')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (normalized.startsWith('select g.igdb_game_id, btrim')) {
      const [platformIgdbId] = params as [number];
      const rows = this.ownedGames.map((game) => {
        const stored = this.statuses.get(game.igdb_game_id);
        const payloadKey = `${game.igdb_game_id}::${String(platformIgdbId)}`;
        return {
          igdb_game_id: game.igdb_game_id,
          title: game.title,
          match_locked: stored?.match_locked ?? false,
          normalized_status: stored?.normalized_status ?? null,
          raw_source_id: stored?.raw_source_id ?? null,
          match_query_title: stored?.match_query_title ?? null,
          payload_compat_status: this.gamePayloads.get(payloadKey)?.compatStatus ?? null,
        };
      });
      return Promise.resolve({ rows, rowCount: rows.length });
    }

    if (normalized.startsWith('insert into emulation_compat_status')) {
      const [igdbGameId, , , normalizedStatus] = params as [string, number, string, string];
      const existing = this.statuses.get(igdbGameId);
      if (!existing?.match_locked) {
        this.statuses.set(igdbGameId, {
          igdb_game_id: igdbGameId,
          normalized_status: normalizedStatus,
          match_locked: false,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (normalized.startsWith('update emulation_compat_status set')) {
      const [igdbGameId, , , normalizedStatus] = params as [string, number, string, string];
      const existing = this.statuses.get(igdbGameId);
      this.statuses.set(igdbGameId, {
        igdb_game_id: igdbGameId,
        normalized_status: normalizedStatus,
        match_locked: true,
        raw_source_id: existing?.raw_source_id ?? null,
        match_query_title: existing?.match_query_title ?? null,
      });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (normalized.startsWith('insert into emulation_compat_source_state')) {
      this.sourceState = { sql: normalized, params };
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (normalized.startsWith('select platform_igdb_id, last_refreshed_at')) {
      return Promise.resolve({
        rows: this.sourceStateRows,
        rowCount: this.sourceStateRows.length,
      });
    }

    throw new Error(`Unexpected query in FakeCompatPool: ${sql}`);
  }

  // Mimics the subset of pg's Pool#connect() used by applyGamePayloadPatch:
  // a client with query()/release(), backing the games.payload merge + sync_events insert.
  connect(): Promise<{
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
    release: () => void;
  }> {
    return Promise.resolve({
      query: (sql: string, params: unknown[] = []) => {
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

        if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }

        if (normalized.startsWith('update games set payload')) {
          const [igdbGameId, platformIgdbId, patchJson] = params as [string, number, string];
          const key = `${igdbGameId}::${String(platformIgdbId)}`;
          const merged = {
            ...this.gamePayloads.get(key),
            ...(JSON.parse(patchJson) as object),
          };
          this.gamePayloads.set(key, merged);
          return Promise.resolve({ rows: [{ payload: merged }], rowCount: 1 });
        }

        if (normalized.startsWith('insert into sync_events')) {
          this.syncEventCount += 1;
          return Promise.resolve({ rows: [], rowCount: 1 });
        }

        throw new Error(`Unexpected query in FakeCompatPool client: ${sql}`);
      },
      release: () => {
        // no-op
      },
    });
  }
}

function withMockFetch(response: () => Response, run: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(response());
  return run().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

void test('refreshCompatSource matches owned games against the scraper response and records source state', async () => {
  const originalBaseUrl = config.compatScraperBaseUrl;
  config.compatScraperBaseUrl = 'http://compat-scraper.test';

  const pool = new FakeCompatPool();
  pool.ownedGames = [{ igdb_game_id: 'g1', title: 'Metroid Prime' }];

  await withMockFetch(
    () =>
      new Response(
        JSON.stringify({
          emulator: 'dolphin',
          sourceUrl: 'https://www.dolphin-emu.org/compat/',
          entries: [
            {
              rawTitle: 'Metroid Prime',
              rawLabel: 'Perfect',
              normalizedStatus: 'perfect',
              sourceId: '/index.php?title=Metroid_Prime',
              sourceUrl: 'https://wiki.dolphin-emu.org/index.php?title=Metroid_Prime',
            },
          ],
        }),
        { status: 200 }
      ),
    async () => {
      await refreshCompatSource(pool as unknown as Pool, 21);
    }
  );

  config.compatScraperBaseUrl = originalBaseUrl;

  const stored = pool.statuses.get('g1');
  assert.ok(stored);
  assert.equal(stored.normalized_status, 'perfect');
  assert.ok(pool.sourceState);
  assert.match(pool.sourceState.sql, /consecutive_failures = 0, next_retry_at = null/);
  assert.equal(pool.gamePayloads.get('g1::21')?.compatStatus, 'perfect');
  assert.equal(pool.syncEventCount, 1);
});

void test('refreshCompatSource skips re-matching games already at the emulator best status, but backfills payload', async () => {
  const originalBaseUrl = config.compatScraperBaseUrl;
  config.compatScraperBaseUrl = 'http://compat-scraper.test';

  const pool = new FakeCompatPool();
  pool.ownedGames = [{ igdb_game_id: 'g1', title: 'Metroid Prime' }];
  pool.statuses.set('g1', {
    igdb_game_id: 'g1',
    normalized_status: 'perfect',
    match_locked: false,
  });

  await withMockFetch(
    () =>
      new Response(
        JSON.stringify({
          emulator: 'dolphin',
          sourceUrl: null,
          entries: [
            {
              rawTitle: 'Metroid Prime',
              rawLabel: 'Broken',
              normalizedStatus: 'incomplete',
              sourceId: null,
              sourceUrl: null,
            },
          ],
        }),
        { status: 200 }
      ),
    async () => {
      await refreshCompatSource(pool as unknown as Pool, 21);
    }
  );

  config.compatScraperBaseUrl = originalBaseUrl;

  const stored = pool.statuses.get('g1');
  assert.ok(stored);
  assert.equal(stored.normalized_status, 'perfect');
  assert.equal(pool.gamePayloads.get('g1::21')?.compatStatus, 'perfect');
  assert.equal(pool.syncEventCount, 1);
});

void test('refreshCompatSource does not repatch payload once it already matches the stored status', async () => {
  const originalBaseUrl = config.compatScraperBaseUrl;
  config.compatScraperBaseUrl = 'http://compat-scraper.test';

  const pool = new FakeCompatPool();
  pool.ownedGames = [{ igdb_game_id: 'g1', title: 'Metroid Prime' }];
  pool.statuses.set('g1', {
    igdb_game_id: 'g1',
    normalized_status: 'perfect',
    match_locked: false,
  });
  pool.gamePayloads.set('g1::21', { compatStatus: 'perfect' });

  await withMockFetch(
    () =>
      new Response(JSON.stringify({ emulator: 'dolphin', sourceUrl: null, entries: [] }), {
        status: 200,
      }),
    async () => {
      await refreshCompatSource(pool as unknown as Pool, 21);
    }
  );

  config.compatScraperBaseUrl = originalBaseUrl;

  assert.equal(pool.syncEventCount, 0);
});

void test('refreshCompatSource re-resolves a bound game by raw_source_id and updates its status', async () => {
  const originalBaseUrl = config.compatScraperBaseUrl;
  config.compatScraperBaseUrl = 'http://compat-scraper.test';

  const pool = new FakeCompatPool();
  pool.ownedGames = [{ igdb_game_id: 'g1', title: 'Metroid Prime Trilogy' }];
  pool.statuses.set('g1', {
    igdb_game_id: 'g1',
    normalized_status: 'incomplete',
    match_locked: true,
    raw_source_id: '/index.php?title=Metroid_Prime',
    match_query_title: 'Metroid Prime',
  });

  await withMockFetch(
    () =>
      new Response(
        JSON.stringify({
          emulator: 'dolphin',
          sourceUrl: 'https://www.dolphin-emu.org/compat/',
          entries: [
            {
              rawTitle: 'Metroid Prime',
              rawLabel: 'Perfect',
              normalizedStatus: 'perfect',
              sourceId: '/index.php?title=Metroid_Prime',
              sourceUrl: 'https://wiki.dolphin-emu.org/index.php?title=Metroid_Prime',
            },
          ],
        }),
        { status: 200 }
      ),
    async () => {
      await refreshCompatSource(pool as unknown as Pool, 21);
    }
  );

  config.compatScraperBaseUrl = originalBaseUrl;

  const stored = pool.statuses.get('g1');
  assert.ok(stored);
  assert.equal(stored.normalized_status, 'perfect');
  assert.equal(stored.match_locked, true);
  assert.equal(pool.gamePayloads.get('g1::21')?.compatStatus, 'perfect');
});

void test('refreshCompatSource leaves a bound game untouched when its upstream entry disappears', async () => {
  const originalBaseUrl = config.compatScraperBaseUrl;
  config.compatScraperBaseUrl = 'http://compat-scraper.test';

  const pool = new FakeCompatPool();
  pool.ownedGames = [{ igdb_game_id: 'g1', title: 'Metroid Prime Trilogy' }];
  pool.statuses.set('g1', {
    igdb_game_id: 'g1',
    normalized_status: 'perfect',
    match_locked: true,
    raw_source_id: '/index.php?title=Metroid_Prime',
    match_query_title: 'Metroid Prime',
  });
  pool.gamePayloads.set('g1::21', { compatStatus: 'perfect' });

  await withMockFetch(
    () =>
      new Response(JSON.stringify({ emulator: 'dolphin', sourceUrl: null, entries: [] }), {
        status: 200,
      }),
    async () => {
      await refreshCompatSource(pool as unknown as Pool, 21);
    }
  );

  config.compatScraperBaseUrl = originalBaseUrl;

  const stored = pool.statuses.get('g1');
  assert.ok(stored);
  assert.equal(stored.normalized_status, 'perfect');
  assert.equal(pool.syncEventCount, 0);
});

void test('refreshCompatSource attempts a compat status notification on a real transition', async () => {
  const originalBaseUrl = config.compatScraperBaseUrl;
  const originalFirebaseServiceAccountJson = config.firebaseServiceAccountJson;
  config.compatScraperBaseUrl = 'http://compat-scraper.test';
  config.firebaseServiceAccountJson = '';

  const pool = new FakeCompatPool();
  pool.ownedGames = [{ igdb_game_id: 'g1', title: 'Metroid Prime' }];
  pool.notificationsEnabled = true;
  pool.notificationTokens = ['token-a'];

  await withMockFetch(
    () =>
      new Response(
        JSON.stringify({
          emulator: 'dolphin',
          sourceUrl: 'https://www.dolphin-emu.org/compat/',
          entries: [
            {
              rawTitle: 'Metroid Prime',
              rawLabel: 'Perfect',
              normalizedStatus: 'perfect',
              sourceId: '/index.php?title=Metroid_Prime',
              sourceUrl: 'https://wiki.dolphin-emu.org/index.php?title=Metroid_Prime',
            },
          ],
        }),
        { status: 200 }
      ),
    async () => {
      await refreshCompatSource(pool as unknown as Pool, 21);
    }
  );

  config.compatScraperBaseUrl = originalBaseUrl;
  config.firebaseServiceAccountJson = originalFirebaseServiceAccountJson;

  assert.equal(pool.notificationReserveAttempts, 1);
});

void test('refreshCompatSource uses the shortened notification platform name (PS2) when configured', async () => {
  const originalBaseUrl = config.compatScraperBaseUrl;
  const originalFirebaseServiceAccountJson = config.firebaseServiceAccountJson;
  config.compatScraperBaseUrl = 'http://compat-scraper.test';
  config.firebaseServiceAccountJson = '';

  const pool = new FakeCompatPool();
  pool.ownedGames = [{ igdb_game_id: 'g1', title: 'Metal Gear Solid 2' }];
  pool.notificationsEnabled = true;
  pool.notificationTokens = ['token-a'];

  await withMockFetch(
    () =>
      new Response(
        JSON.stringify({
          emulator: 'pcsx2',
          sourceUrl: 'https://pcsx2.net/compat/',
          entries: [
            {
              rawTitle: 'Metal Gear Solid 2',
              rawLabel: 'Perfect',
              normalizedStatus: 'perfect',
              sourceId: null,
              sourceUrl: null,
            },
          ],
        }),
        { status: 200 }
      ),
    async () => {
      await refreshCompatSource(pool as unknown as Pool, 8);
    }
  );

  config.compatScraperBaseUrl = originalBaseUrl;
  config.firebaseServiceAccountJson = originalFirebaseServiceAccountJson;

  assert.equal(pool.notificationReserveAttempts, 1);
  assert.ok(pool.lastReservedNotificationBody?.includes('(PS2)'));
  assert.ok(!pool.lastReservedNotificationBody?.includes('PlayStation 2'));
});

void test('refreshCompatSource does not attempt a notification when the backfill pass syncs stale payload', async () => {
  const originalBaseUrl = config.compatScraperBaseUrl;
  const originalFirebaseServiceAccountJson = config.firebaseServiceAccountJson;
  config.compatScraperBaseUrl = 'http://compat-scraper.test';
  config.firebaseServiceAccountJson = '';

  const pool = new FakeCompatPool();
  pool.ownedGames = [{ igdb_game_id: 'g1', title: 'Metroid Prime' }];
  pool.statuses.set('g1', {
    igdb_game_id: 'g1',
    normalized_status: 'perfect',
    match_locked: false,
  });
  pool.notificationsEnabled = true;
  pool.notificationTokens = ['token-a'];

  await withMockFetch(
    () =>
      new Response(
        JSON.stringify({
          emulator: 'dolphin',
          sourceUrl: null,
          entries: [
            {
              rawTitle: 'Metroid Prime',
              rawLabel: 'Broken',
              normalizedStatus: 'incomplete',
              sourceId: null,
              sourceUrl: null,
            },
          ],
        }),
        { status: 200 }
      ),
    async () => {
      await refreshCompatSource(pool as unknown as Pool, 21);
    }
  );

  config.compatScraperBaseUrl = originalBaseUrl;
  config.firebaseServiceAccountJson = originalFirebaseServiceAccountJson;

  assert.equal(pool.notificationReserveAttempts, 0);
});

void test('refreshCompatSource rejects a non compat-eligible platform', async () => {
  const pool = new FakeCompatPool();
  await assert.rejects(refreshCompatSource(pool as unknown as Pool, 999));
});

void test('refreshCompatSource records an error source state and rethrows on a failed scraper request', async () => {
  const originalBaseUrl = config.compatScraperBaseUrl;
  config.compatScraperBaseUrl = 'http://compat-scraper.test';

  const pool = new FakeCompatPool();

  await withMockFetch(
    () => new Response('upstream error', { status: 502 }),
    async () => {
      await assert.rejects(refreshCompatSource(pool as unknown as Pool, 21));
    }
  );

  config.compatScraperBaseUrl = originalBaseUrl;
  assert.ok(pool.sourceState);
});

void test('refreshCompatSource schedules an exponential retry backoff from config on failure', async () => {
  const originalBaseUrl = config.compatScraperBaseUrl;
  const originalBaseMinutes = config.compatFailureBackoffBaseMinutes;
  const originalMaxHours = config.compatFailureBackoffMaxHours;
  config.compatScraperBaseUrl = 'http://compat-scraper.test';
  config.compatFailureBackoffBaseMinutes = 30;
  config.compatFailureBackoffMaxHours = 12;

  const pool = new FakeCompatPool();

  try {
    await withMockFetch(
      () => new Response('upstream error', { status: 502 }),
      async () => {
        await assert.rejects(refreshCompatSource(pool as unknown as Pool, 46));
      }
    );
  } finally {
    config.compatScraperBaseUrl = originalBaseUrl;
    config.compatFailureBackoffBaseMinutes = originalBaseMinutes;
    config.compatFailureBackoffMaxHours = originalMaxHours;
  }

  assert.ok(pool.sourceState);
  assert.match(
    pool.sourceState.sql,
    /consecutive_failures = emulation_compat_source_state\.consecutive_failures \+ 1/
  );
  assert.match(pool.sourceState.sql, /next_retry_at = now\(\) \+ make_interval/);
  assert.deepEqual(pool.sourceState.params.slice(3), [
    'compat-scraper request failed with status 502',
    30,
    12 * 60,
  ]);
});

void test('enqueueForcedCompatRefreshJobs honours failure backoff only when respecting staleness', async () => {
  const originalBaseUrl = config.compatScraperBaseUrl;
  config.compatScraperBaseUrl = 'http://compat-scraper.test';

  const now = Date.now();
  const makePool = (): FakeCompatPool => {
    const pool = new FakeCompatPool();
    // Every platform is due (never refreshed) but still inside its retry backoff window.
    pool.sourceStateRows = [5, 21, 8, 11, 12, 9, 41, 46, 37].map((platformIgdbId) => ({
      platform_igdb_id: platformIgdbId,
      last_refreshed_at: null,
      next_retry_at: new Date(now + 60 * 60 * 1000).toISOString(),
    }));
    return pool;
  };

  let fetchCount = 0;
  const respected = { enqueued: 0, deduped: 0, errors: 0 };
  const forced = { enqueued: 0, deduped: 0, errors: 0 };

  try {
    await withMockFetch(
      () => {
        fetchCount += 1;
        return new Response('upstream error', { status: 502 });
      },
      async () => {
        Object.assign(
          respected,
          await enqueueForcedCompatRefreshJobs(makePool() as unknown as Pool, {
            respectStaleness: true,
          })
        );
        assert.equal(fetchCount, 0);

        Object.assign(
          forced,
          await enqueueForcedCompatRefreshJobs(makePool() as unknown as Pool, {
            respectStaleness: false,
          })
        );
      }
    );
  } finally {
    config.compatScraperBaseUrl = originalBaseUrl;
  }

  assert.deepEqual(respected, { enqueued: 0, deduped: 9, errors: 0 });
  assert.deepEqual(forced, { enqueued: 0, deduped: 0, errors: 9 });
  assert.equal(fetchCount, 9);
});

void test('enqueueForcedCompatRefreshJobs dedupes platforms that are not due when respecting staleness', async () => {
  const originalBaseUrl = config.compatScraperBaseUrl;
  config.compatScraperBaseUrl = 'http://compat-scraper.test';

  class NeverDuePool extends FakeCompatPool {
    override query(
      sql: string,
      params: unknown[] = []
    ): Promise<{ rows: unknown[]; rowCount: number }> {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.startsWith('select platform_igdb_id, last_refreshed_at')) {
        return Promise.resolve({
          rows: [
            { platform_igdb_id: 5, last_refreshed_at: new Date().toISOString() },
            { platform_igdb_id: 21, last_refreshed_at: new Date().toISOString() },
            { platform_igdb_id: 8, last_refreshed_at: new Date().toISOString() },
            { platform_igdb_id: 11, last_refreshed_at: new Date().toISOString() },
            { platform_igdb_id: 12, last_refreshed_at: new Date().toISOString() },
            { platform_igdb_id: 9, last_refreshed_at: new Date().toISOString() },
            { platform_igdb_id: 41, last_refreshed_at: new Date().toISOString() },
            { platform_igdb_id: 46, last_refreshed_at: new Date().toISOString() },
            { platform_igdb_id: 37, last_refreshed_at: new Date().toISOString() },
          ],
          rowCount: 9,
        });
      }
      return super.query(sql, params);
    }
  }

  const pool = new NeverDuePool();
  const result = await enqueueForcedCompatRefreshJobs(pool as unknown as Pool, {
    respectStaleness: true,
  });

  config.compatScraperBaseUrl = originalBaseUrl;

  assert.deepEqual(result, { enqueued: 0, deduped: 9, errors: 0 });
});
