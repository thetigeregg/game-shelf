import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { releaseMonitorInternals } from '../release-monitor.js';

class NotificationSettingsPoolMock {
  constructor(private readonly rows: Array<{ setting_key: string; setting_value: string }>) {}

  query(): Promise<{ rows: Array<{ setting_key: string; setting_value: string }> }> {
    return Promise.resolve({ rows: this.rows });
  }
}

void test('release events include set/changed/removed/day transitions', () => {
  const now = new Date('2026-03-06T10:00:00.000Z');

  const setEvents = releaseMonitorInternals.buildReleaseEvents({
    igdbGameId: '52189',
    platformIgdbId: 167,
    title: 'Grand Theft Auto VI',
    releaseDateBefore: null,
    releaseDateAfter: '2026-12-01',
    now
  });
  assert.deepEqual(
    setEvents.map((entry) => entry.type),
    ['release_date_set']
  );

  const changedAndDayEvents = releaseMonitorInternals.buildReleaseEvents({
    igdbGameId: '52189',
    platformIgdbId: 167,
    title: 'Grand Theft Auto VI',
    releaseDateBefore: '2026-12-01',
    releaseDateAfter: '2026-03-06',
    now
  });
  assert.deepEqual(
    changedAndDayEvents.map((entry) => entry.type),
    ['release_date_changed', 'release_day']
  );

  const removedEvents = releaseMonitorInternals.buildReleaseEvents({
    igdbGameId: '52189',
    platformIgdbId: 167,
    title: 'Grand Theft Auto VI',
    releaseDateBefore: '2026-12-01',
    releaseDateAfter: null,
    now
  });
  assert.deepEqual(
    removedEvents.map((entry) => entry.type),
    ['release_date_removed']
  );
});

void test('unknown release date cadence is weekly for future/unknown year and yearly for past years', () => {
  const now = new Date('2026-03-06T10:00:00.000Z');
  const oneDayMs = 24 * 60 * 60 * 1000;

  const weeklyNextCheck = Date.parse(
    releaseMonitorInternals.computeNextCheckAt(null, 2026, now, false, null)
  );
  const weeklyDeltaDays = Math.round((weeklyNextCheck - now.getTime()) / oneDayMs);
  assert.equal(weeklyDeltaDays, 7);

  const yearlyNextCheck = Date.parse(
    releaseMonitorInternals.computeNextCheckAt(null, 1980, now, false, null)
  );
  const yearlyDeltaDays = Math.round((yearlyNextCheck - now.getTime()) / oneDayMs);
  assert.equal(yearlyDeltaDays, 365);
});

void test('notification preferences default to disabled when setting is missing', async () => {
  const pool = new NotificationSettingsPoolMock([]);

  const preferences = await releaseMonitorInternals.readNotificationPreferences(
    pool as unknown as Pool
  );

  assert.equal(preferences.enabled, false);
  assert.deepEqual(preferences.events, {
    set: true,
    changed: true,
    removed: true,
    day: true
  });
});
