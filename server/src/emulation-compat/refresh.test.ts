import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { config } from '../config.js';
import {
  enqueueForcedCompatRefreshJobs,
  isCompatRefreshDue,
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

interface StoredStatusRow {
  igdb_game_id: string;
  normalized_status: string;
  match_locked: boolean;
}

class FakeCompatPool {
  ownedGames: Array<{ igdb_game_id: string; title: string }> = [];
  statuses = new Map<string, StoredStatusRow>();
  sourceState: Record<string, unknown> | null = null;

  query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('select g.igdb_game_id, btrim')) {
      const rows = this.ownedGames.map((game) => {
        const stored = this.statuses.get(game.igdb_game_id);
        return {
          igdb_game_id: game.igdb_game_id,
          title: game.title,
          match_locked: stored?.match_locked ?? false,
          normalized_status: stored?.normalized_status ?? null,
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

    if (normalized.startsWith('insert into emulation_compat_source_state')) {
      this.sourceState = { params };
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (normalized.startsWith('select platform_igdb_id, last_refreshed_at')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    throw new Error(`Unexpected query in FakeCompatPool: ${sql}`);
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
});

void test('refreshCompatSource skips games already at the emulator best status', async () => {
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
          ],
          rowCount: 3,
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

  assert.deepEqual(result, { enqueued: 0, deduped: 3, errors: 0 });
});
