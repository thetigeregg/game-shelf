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
    releaseBefore: {
      precision: 'unknown',
      marker: null,
      date: null,
      year: null,
      display: null
    },
    releaseAfter: {
      precision: 'day',
      marker: '2026-12-01',
      date: '2026-12-01',
      year: 2026,
      display: '2026-12-01'
    },
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
    releaseBefore: {
      precision: 'day',
      marker: '2026-12-01',
      date: '2026-12-01',
      year: 2026,
      display: '2026-12-01'
    },
    releaseAfter: {
      precision: 'day',
      marker: '2026-03-06',
      date: '2026-03-06',
      year: 2026,
      display: '2026-03-06'
    },
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
    releaseBefore: {
      precision: 'day',
      marker: '2026-12-01',
      date: '2026-12-01',
      year: 2026,
      display: '2026-12-01'
    },
    releaseAfter: {
      precision: 'unknown',
      marker: null,
      date: null,
      year: null,
      display: null
    },
    now
  });
  assert.deepEqual(
    removedEvents.map((entry) => entry.type),
    ['release_date_removed']
  );

  const impreciseChangedEvents = releaseMonitorInternals.buildReleaseEvents({
    igdbGameId: '92550',
    platformIgdbId: 167,
    title: 'Fable',
    releaseBefore: {
      precision: 'year',
      marker: '2026',
      date: null,
      year: 2026,
      display: '2026'
    },
    releaseAfter: {
      precision: 'quarter',
      marker: '2026-Q4',
      date: null,
      year: 2026,
      display: 'Q4 2026'
    },
    now
  });
  assert.deepEqual(
    impreciseChangedEvents.map((entry) => entry.type),
    ['release_date_changed']
  );
});

void test('unknown release date cadence is weekly for future/unknown year and yearly for past years', () => {
  const now = new Date('2026-03-06T10:00:00.000Z');
  const oneDayMs = 24 * 60 * 60 * 1000;

  const weeklyNextCheck = Date.parse(
    releaseMonitorInternals.computeNextCheckAt(
      {
        precision: 'unknown',
        marker: null,
        date: null,
        year: 2026,
        display: null
      },
      now,
      false,
      null
    )
  );
  const weeklyDeltaDays = Math.round((weeklyNextCheck - now.getTime()) / oneDayMs);
  assert.equal(weeklyDeltaDays, 7);

  const yearlyNextCheck = Date.parse(
    releaseMonitorInternals.computeNextCheckAt(
      {
        precision: 'unknown',
        marker: null,
        date: null,
        year: 1980,
        display: null
      },
      now,
      false,
      null
    )
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
