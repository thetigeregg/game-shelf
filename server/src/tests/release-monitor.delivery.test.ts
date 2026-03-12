import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { releaseMonitorInternals } from '../release-monitor.js';

interface NotificationLogRow {
  eventKey: string;
  sentCount: number;
  payload: string;
}

class NotificationLogPoolMock {
  private readonly logs = new Map<string, NotificationLogRow>();

  query(
    sql: string,
    params: unknown[] = []
  ): Promise<{ rows: Array<{ inserted: number }>; rowCount: number }> {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (
      normalizedSql.startsWith(
        'insert into release_notification_log (event_type, igdb_game_id, platform_igdb_id, event_key, payload, sent_count) values'
      )
    ) {
      const eventKey = toStringOrFallback(params[3], '');
      if (!eventKey || this.logs.has(eventKey)) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }

      this.logs.set(eventKey, {
        eventKey,
        payload: toStringOrFallback(params[4], '{}'),
        sentCount: 0
      });

      return Promise.resolve({ rows: [{ inserted: 1 }], rowCount: 1 });
    }

    if (
      normalizedSql.startsWith(
        'update release_notification_log set payload = $1::jsonb, sent_count = $2 where event_key = $3'
      )
    ) {
      const payload = toStringOrFallback(params[0], '{}');
      const sentCount = toIntegerOrFallback(params[1], 0);
      const eventKey = toStringOrFallback(params[2], '');
      const existing = this.logs.get(eventKey);
      if (existing) {
        this.logs.set(eventKey, { ...existing, payload, sentCount });
      }
      return Promise.resolve({ rows: [], rowCount: existing ? 1 : 0 });
    }

    if (
      normalizedSql.startsWith(
        'delete from release_notification_log where event_key = $1 and sent_count = 0'
      )
    ) {
      const eventKey = toStringOrFallback(params[0], '');
      const existing = this.logs.get(eventKey);
      if (existing && existing.sentCount === 0) {
        this.logs.delete(eventKey);
        return Promise.resolve({ rows: [], rowCount: 1 });
      }

      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    return Promise.resolve({ rows: [], rowCount: 0 });
  }

  get(eventKey: string): NotificationLogRow | null {
    return this.logs.get(eventKey) ?? null;
  }
}

class AdvisoryLockClientMock {
  private readonly lockAvailable: boolean;
  private readonly throwOnUnlock: boolean;
  unlockCount = 0;

  constructor(lockAvailable: boolean, throwOnUnlock = false) {
    this.lockAvailable = lockAvailable;
    this.throwOnUnlock = throwOnUnlock;
  }

  query(sql: string): Promise<{ rows: Array<{ locked: boolean }>; rowCount: number }> {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalizedSql.startsWith('select pg_try_advisory_lock')) {
      return Promise.resolve({
        rows: [{ locked: this.lockAvailable }],
        rowCount: 1
      });
    }

    if (normalizedSql.startsWith('select pg_advisory_unlock')) {
      this.unlockCount += 1;
      if (this.throwOnUnlock) {
        throw new Error('unlock_failed');
      }
      return Promise.resolve({
        rows: [{ locked: true }],
        rowCount: 1
      });
    }

    return Promise.resolve({ rows: [], rowCount: 0 });
  }

  release(): void {}
}

class AdvisoryLockPoolMock {
  readonly client: AdvisoryLockClientMock;

  constructor(lockAvailable: boolean, throwOnUnlock = false) {
    this.client = new AdvisoryLockClientMock(lockAvailable, throwOnUnlock);
  }

  connect(): Promise<AdvisoryLockClientMock> {
    return Promise.resolve(this.client);
  }
}

class TokenCleanupPoolMock {
  staleUpdates = 0;
  prunedDeletes = 0;

  query(sql: string): Promise<{ rows: Array<{ inserted: number }>; rowCount: number }> {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalizedSql.startsWith('update fcm_tokens set is_active = false, updated_at = now()')) {
      this.staleUpdates += 1;
      return Promise.resolve({ rows: [], rowCount: 3 });
    }

    if (normalizedSql.startsWith('delete from fcm_tokens where is_active = false')) {
      this.prunedDeletes += 1;
      return Promise.resolve({ rows: [], rowCount: 2 });
    }

    return Promise.resolve({ rows: [], rowCount: 0 });
  }
}

interface DueGameSeedRow {
  igdb_game_id: string;
  platform_igdb_id: number;
  payload: Record<string, unknown>;
  watch_exists: boolean;
  last_known_release_marker: string | null;
  last_known_release_precision: string | null;
  last_known_release_date: string | null;
  last_known_release_year: number | null;
  last_seen_state: string | null;
  last_hltb_refresh_at: string | null;
  last_metacritic_refresh_at: string | null;
  last_notified_release_day: string | null;
}

class ReleaseMonitorFlowPoolMock {
  private readonly dueRows: DueGameSeedRow[];
  queuedJobs = 0;
  private readonly queuedByDedupeKey = new Map<string, number>();
  private nextJobId = 1;
  private enqueueFailuresRemaining: number;

  constructor(dueRows: DueGameSeedRow[], options?: { enqueueFailuresRemaining?: number }) {
    this.dueRows = dueRows;
    this.enqueueFailuresRemaining = options?.enqueueFailuresRemaining ?? 0;
  }

  query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalizedSql.startsWith('select g.igdb_game_id')) {
      return Promise.resolve({ rows: this.dueRows, rowCount: this.dueRows.length });
    }

    if (normalizedSql.startsWith('select setting_key, setting_value from settings')) {
      return Promise.resolve({
        rows: [
          { setting_key: 'game-shelf:notifications:release:enabled', setting_value: 'false' },
          {
            setting_key: 'game-shelf:notifications:release:events',
            setting_value: JSON.stringify({
              set: true,
              changed: true,
              removed: true,
              day: true,
              sale: true
            })
          }
        ],
        rowCount: 2
      });
    }

    if (
      normalizedSql.startsWith(
        'select token from fcm_tokens where is_active = true order by token asc limit $1'
      )
    ) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (normalizedSql.startsWith('insert into background_jobs')) {
      if (this.enqueueFailuresRemaining > 0) {
        this.enqueueFailuresRemaining -= 1;
        return Promise.reject(new Error('enqueue_failed'));
      }
      const dedupeKey = toStringOrFallback(params[1], '');
      const existingId = this.queuedByDedupeKey.get(dedupeKey);
      if (existingId) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      const jobId = this.nextJobId;
      this.nextJobId += 1;
      if (dedupeKey) {
        this.queuedByDedupeKey.set(dedupeKey, jobId);
      }
      this.queuedJobs += 1;
      return Promise.resolve({ rows: [{ id: jobId }], rowCount: 1 });
    }

    if (normalizedSql.startsWith('select id from background_jobs where dedupe_key = $1')) {
      const dedupeKey = toStringOrFallback(params[0], '');
      const existingId = this.queuedByDedupeKey.get(dedupeKey);
      if (!existingId) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [{ id: existingId }], rowCount: 1 });
    }

    if (normalizedSql.startsWith('update fcm_tokens set is_active = false, updated_at = now()')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (normalizedSql.startsWith('delete from fcm_tokens where is_active = false')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (normalizedSql.startsWith('insert into release_notification_log')) {
      return Promise.resolve({ rows: [{ inserted: 1 }], rowCount: 1 });
    }

    if (normalizedSql.startsWith('update release_notification_log set payload = $1::jsonb')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (normalizedSql.startsWith('delete from release_notification_log where event_key = $1')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (normalizedSql.startsWith('update games set payload = $3::jsonb')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (normalizedSql.startsWith('insert into sync_events')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    void params;
    return Promise.resolve({ rows: [], rowCount: 0 });
  }
}

function toStringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function toIntegerOrFallback(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  return fallback;
}

function createRunStats() {
  return {
    startedAtIso: new Date().toISOString(),
    dueGames: 0,
    activeTokensAtStart: 0,
    processedWithLock: 0,
    lockSkipped: 0,
    gameFailures: 0,
    igdbRefreshAttempts: 0,
    igdbRefreshSuccesses: 0,
    hltbRefreshAttempts: 0,
    hltbRefreshSuccesses: 0,
    metacriticRefreshAttempts: 0,
    metacriticRefreshSuccesses: 0,
    eventsConsidered: 0,
    eventsDisabled: 0,
    eventsReleaseDayAlreadyNotified: 0,
    eventsSkippedNoTokens: 0,
    eventsSkippedDuplicate: 0,
    eventsReserved: 0,
    sendAttempts: 0,
    sendBatchSuccess: 0,
    sendBatchFailure: 0,
    sendNoSuccessReservationsReleased: 0,
    eventsSent: 0,
    invalidTokensDeactivated: 0,
    tokenCleanupRan: false,
    tokensDeactivatedByCleanup: 0,
    tokensPrunedByCleanup: 0
  };
}

void test('notification reservation inserts once per event key', async () => {
  const pool = new NotificationLogPoolMock();
  const event = {
    type: 'release_date_set',
    title: 'Game: Release date set',
    body: 'Game now has a release date.',
    eventKey: 'release_date_set:1:167:2026-11-19',
    releaseMarker: '2026-11-19'
  } as const;

  const first = await releaseMonitorInternals.reserveNotificationLog(
    pool as unknown as Pool,
    event,
    '1',
    167
  );
  const second = await releaseMonitorInternals.reserveNotificationLog(
    pool as unknown as Pool,
    event,
    '1',
    167
  );

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(pool.get(event.eventKey)?.sentCount, 0);
});

void test('notification reservation can be finalized and is no longer removable as pending', async () => {
  const pool = new NotificationLogPoolMock();
  const event = {
    type: 'release_date_changed',
    title: 'Game: Release date changed',
    body: 'Game moved dates.',
    eventKey: 'release_date_changed:1:167:2026-11-19:2026-12-01',
    releaseMarker: '2026-12-01'
  } as const;

  await releaseMonitorInternals.reserveNotificationLog(pool as unknown as Pool, event, '1', 167);
  await releaseMonitorInternals.finalizeNotificationLog(
    pool as unknown as Pool,
    event,
    event.eventKey,
    2
  );
  await releaseMonitorInternals.releaseNotificationLogReservation(
    pool as unknown as Pool,
    event.eventKey
  );

  assert.equal(pool.get(event.eventKey)?.sentCount, 2);
});

void test('withGameLock executes handler and unlocks when lock acquired', async () => {
  const pool = new AdvisoryLockPoolMock(true);
  let handlerRuns = 0;

  const locked = await releaseMonitorInternals.withGameLock(
    pool as unknown as Pool,
    '52189',
    167,
    () => {
      handlerRuns += 1;
      return Promise.resolve();
    }
  );

  assert.equal(locked, true);
  assert.equal(handlerRuns, 1);
  assert.equal(pool.client.unlockCount, 1);
});

void test('withGameLock skips handler when lock is not acquired', async () => {
  const pool = new AdvisoryLockPoolMock(false);
  let handlerRuns = 0;

  const locked = await releaseMonitorInternals.withGameLock(
    pool as unknown as Pool,
    '52189',
    167,
    () => {
      handlerRuns += 1;
      return Promise.resolve();
    }
  );

  assert.equal(locked, false);
  assert.equal(handlerRuns, 0);
  assert.equal(pool.client.unlockCount, 0);
});

void test('withGameLock preserves handler error even when unlock fails', async () => {
  const pool = new AdvisoryLockPoolMock(true, true);

  await assert.rejects(
    releaseMonitorInternals.withGameLock(pool as unknown as Pool, '52189', 167, () => {
      throw new Error('handler_failed');
    }),
    /handler_failed/
  );
});

void test('token cleanup updates stale active tokens and prunes old inactive tokens', async () => {
  const pool = new TokenCleanupPoolMock();
  const stats = createRunStats();
  const runtimeState = releaseMonitorInternals.createMonitorRuntimeState();

  await releaseMonitorInternals.runFcmTokenCleanupIfDue(
    pool as unknown as Pool,
    stats,
    runtimeState
  );

  assert.equal(pool.staleUpdates, 1);
  assert.equal(pool.prunedDeletes, 1);
  assert.equal(stats.tokenCleanupRan, true);
  assert.equal(stats.tokensDeactivatedByCleanup, 3);
  assert.equal(stats.tokensPrunedByCleanup, 2);
});

void test('token cleanup respects interval and skips immediate re-run', async () => {
  const pool = new TokenCleanupPoolMock();
  const statsFirstRun = createRunStats();
  const statsSecondRun = createRunStats();
  const runtimeState = releaseMonitorInternals.createMonitorRuntimeState();

  await releaseMonitorInternals.runFcmTokenCleanupIfDue(
    pool as unknown as Pool,
    statsFirstRun,
    runtimeState
  );
  await releaseMonitorInternals.runFcmTokenCleanupIfDue(
    pool as unknown as Pool,
    statsSecondRun,
    runtimeState
  );

  assert.equal(pool.staleUpdates, 1);
  assert.equal(pool.prunedDeletes, 1);
  assert.equal(statsSecondRun.tokenCleanupRan, false);
});

void test('evaluateRunHealth warns when send failure and invalid token ratios are high', () => {
  const warnings = releaseMonitorInternals.evaluateRunHealth({
    ...createRunStats(),
    sendBatchSuccess: 10,
    sendBatchFailure: 20,
    invalidTokensDeactivated: 4
  });

  assert.equal(
    warnings.some((entry) => entry.code === 'send_failure_ratio_high'),
    true
  );
  assert.equal(
    warnings.some((entry) => entry.code === 'invalid_token_ratio_high'),
    true
  );
});

void test('processDueGames enqueues release monitor jobs for bootstrap rows', async () => {
  const pool = new ReleaseMonitorFlowPoolMock([
    {
      igdb_game_id: '52189',
      platform_igdb_id: 167,
      payload: {
        title: 'Grand Theft Auto VI',
        platform: 'PlayStation 5',
        releaseDate: '2026-11-19',
        releaseYear: 2026,
        listType: 'wishlist'
      },
      watch_exists: false,
      last_known_release_marker: null,
      last_known_release_precision: null,
      last_known_release_date: null,
      last_known_release_year: null,
      last_seen_state: null,
      last_hltb_refresh_at: null,
      last_metacritic_refresh_at: null,
      last_notified_release_day: null
    }
  ]);

  const runtimeState = releaseMonitorInternals.createMonitorRuntimeState();
  await releaseMonitorInternals.processDueGames(pool as unknown as Pool, runtimeState);

  assert.equal(pool.queuedJobs, 1);
});

void test('processDueGames continues when enqueue fails for one game', async () => {
  const pool = new ReleaseMonitorFlowPoolMock(
    [
      {
        igdb_game_id: '52189',
        platform_igdb_id: 167,
        payload: {
          title: 'Grand Theft Auto VI',
          platform: 'PlayStation 5',
          releaseDate: '2026-11-19',
          releaseYear: 2026,
          listType: 'wishlist'
        },
        watch_exists: false,
        last_known_release_marker: null,
        last_known_release_precision: null,
        last_known_release_date: null,
        last_known_release_year: null,
        last_seen_state: null,
        last_hltb_refresh_at: null,
        last_metacritic_refresh_at: null,
        last_notified_release_day: null
      },
      {
        igdb_game_id: '92550',
        platform_igdb_id: 167,
        payload: {
          title: 'Fable',
          platform: 'PlayStation 5',
          releaseYear: 2026,
          listType: 'wishlist'
        },
        watch_exists: false,
        last_known_release_marker: null,
        last_known_release_precision: null,
        last_known_release_date: null,
        last_known_release_year: null,
        last_seen_state: null,
        last_hltb_refresh_at: null,
        last_metacritic_refresh_at: null,
        last_notified_release_day: null
      }
    ],
    { enqueueFailuresRemaining: 1 }
  );

  const runtimeState = releaseMonitorInternals.createMonitorRuntimeState();
  await assert.doesNotReject(
    releaseMonitorInternals.processDueGames(pool as unknown as Pool, runtimeState)
  );

  assert.equal(pool.queuedJobs, 1);
});

void test('enqueueReleaseMonitorGameJob dedupes per game-platform key', async () => {
  const row = {
    igdb_game_id: '52189',
    platform_igdb_id: 167,
    payload: {
      title: 'Grand Theft Auto VI',
      platform: 'PlayStation 5',
      listType: 'wishlist'
    },
    watch_exists: false,
    last_known_release_marker: null,
    last_known_release_precision: null,
    last_known_release_date: null,
    last_known_release_year: null,
    last_seen_state: null,
    last_hltb_refresh_at: null,
    last_metacritic_refresh_at: null,
    last_notified_release_day: null
  };

  const pool = new ReleaseMonitorFlowPoolMock([row]);
  const first = await releaseMonitorInternals.enqueueReleaseMonitorGameJob(
    pool as unknown as Pool,
    row
  );
  const second = await releaseMonitorInternals.enqueueReleaseMonitorGameJob(
    pool as unknown as Pool,
    row
  );

  assert.equal(first, true);
  assert.equal(second, false);
});

class QueuedGamePoolMock {
  readonly client = new AdvisoryLockClientMock(false);
  settingsReads = 0;
  tokenReads = 0;

  connect(): Promise<AdvisoryLockClientMock> {
    return Promise.resolve(this.client);
  }

  query(sql: string): Promise<{ rows: unknown[]; rowCount: number }> {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalizedSql.startsWith('select setting_key, setting_value from settings')) {
      this.settingsReads += 1;
      return Promise.resolve({
        rows: [],
        rowCount: 0
      });
    }

    if (
      normalizedSql.startsWith(
        'select token from fcm_tokens where is_active = true order by token asc limit $1'
      )
    ) {
      this.tokenReads += 1;
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    return Promise.resolve({ rows: [], rowCount: 0 });
  }
}

void test('processQueuedReleaseMonitorGame validates payload and tolerates lock miss', async () => {
  releaseMonitorInternals.clearQueuedGameContextCache();
  const pool = new QueuedGamePoolMock();

  await assert.rejects(
    releaseMonitorInternals.processQueuedReleaseMonitorGame(pool as unknown as Pool, {}),
    /Invalid release monitor game payload/
  );

  await assert.doesNotReject(
    releaseMonitorInternals.processQueuedReleaseMonitorGame(pool as unknown as Pool, {
      igdb_game_id: '52189',
      platform_igdb_id: 167,
      payload: {
        title: 'Grand Theft Auto VI',
        platform: 'PlayStation 5',
        releaseYear: 2026,
        listType: 'wishlist'
      },
      watch_exists: false
    })
  );
});

void test('processQueuedReleaseMonitorGame reuses short-lived cached settings and tokens', async () => {
  releaseMonitorInternals.clearQueuedGameContextCache();
  const pool = new QueuedGamePoolMock();
  const payload = {
    igdb_game_id: '52189',
    platform_igdb_id: 167,
    payload: {
      title: 'Grand Theft Auto VI',
      platform: 'PlayStation 5',
      releaseYear: 2026,
      listType: 'wishlist'
    },
    watch_exists: false
  };

  await releaseMonitorInternals.processQueuedReleaseMonitorGame(pool as unknown as Pool, payload);
  await releaseMonitorInternals.processQueuedReleaseMonitorGame(pool as unknown as Pool, payload);

  assert.equal(pool.settingsReads, 1);
  assert.equal(pool.tokenReads, 1);
});
