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
      null,
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
      null,
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

void test('release marker parser supports day/month/quarter/year and natural quarter format', () => {
  assert.deepEqual(releaseMonitorInternals.parseReleaseMarkerFromString('2026-11-19'), {
    precision: 'day',
    marker: '2026-11-19'
  });
  assert.deepEqual(releaseMonitorInternals.parseReleaseMarkerFromString('2026-11'), {
    precision: 'month',
    marker: '2026-11'
  });
  assert.deepEqual(releaseMonitorInternals.parseReleaseMarkerFromString('2026-Q4'), {
    precision: 'quarter',
    marker: '2026-Q4'
  });
  assert.deepEqual(releaseMonitorInternals.parseReleaseMarkerFromString('Q4 2026'), {
    precision: 'quarter',
    marker: '2026-Q4'
  });
  assert.deepEqual(releaseMonitorInternals.parseReleaseMarkerFromString('2026'), {
    precision: 'year',
    marker: '2026'
  });
  assert.equal(releaseMonitorInternals.parseReleaseMarkerFromString('TBD'), null);
});

void test('deriveReleaseInfo prefers precision+marker and falls back to releaseDate/releaseYear', () => {
  const fromPrecision = releaseMonitorInternals.deriveReleaseInfo({
    marker: '2026-Q4',
    precision: 'quarter',
    releaseDate: null,
    releaseYear: null
  });
  assert.equal(fromPrecision.precision, 'quarter');
  assert.equal(fromPrecision.marker, '2026-Q4');
  assert.equal(fromPrecision.display, 'Q4 2026');

  const fromDate = releaseMonitorInternals.deriveReleaseInfo({
    marker: null,
    precision: null,
    releaseDate: '2026-11-19',
    releaseYear: null
  });
  assert.equal(fromDate.precision, 'day');
  assert.equal(fromDate.date, '2026-11-19');

  const fromYear = releaseMonitorInternals.deriveReleaseInfo({
    marker: null,
    precision: null,
    releaseDate: null,
    releaseYear: 2026
  });
  assert.equal(fromYear.precision, 'year');
  assert.equal(fromYear.marker, '2026');
});

void test('release timestamp resolution handles day/month/quarter/year', () => {
  assert.equal(
    releaseMonitorInternals.getReleaseInfoTimestamp({
      precision: 'day',
      marker: '2026-11-19',
      date: '2026-11-19',
      year: 2026,
      display: '2026-11-19'
    }),
    Date.parse('2026-11-19T00:00:00.000Z')
  );
  assert.equal(
    releaseMonitorInternals.getReleaseInfoTimestamp({
      precision: 'month',
      marker: '2026-11',
      date: null,
      year: 2026,
      display: '2026-11'
    }),
    Date.parse('2026-11-01T00:00:00.000Z')
  );
  assert.equal(
    releaseMonitorInternals.getReleaseInfoTimestamp({
      precision: 'quarter',
      marker: '2026-Q4',
      date: null,
      year: 2026,
      display: 'Q4 2026'
    }),
    Date.parse('2026-10-01T00:00:00.000Z')
  );
  assert.equal(
    releaseMonitorInternals.getReleaseInfoTimestamp({
      precision: 'year',
      marker: '2026',
      date: null,
      year: 2026,
      display: '2026'
    }),
    Date.parse('2026-01-01T00:00:00.000Z')
  );
});

void test('hltb and metacritic refresh due checks respect existing values and refresh age', () => {
  const now = new Date('2026-03-06T10:00:00.000Z');
  const payloadWithHltb = { hltbMainHours: 12 };
  const payloadWithMetacritic = { metacriticScore: 85 };

  assert.equal(releaseMonitorInternals.hasHltbValues(payloadWithHltb), true);
  assert.equal(releaseMonitorInternals.hasMetacriticValues(payloadWithMetacritic), true);
  assert.equal(releaseMonitorInternals.hasHltbValues({}), false);
  assert.equal(releaseMonitorInternals.hasMetacriticValues({}), false);

  assert.equal(releaseMonitorInternals.isHltbRefreshDue(null, payloadWithHltb, now), true);
  assert.equal(
    releaseMonitorInternals.isHltbRefreshDue('invalid-date', payloadWithHltb, now),
    true
  );
  assert.equal(
    releaseMonitorInternals.isMetacriticRefreshDue(null, payloadWithMetacritic, now),
    true
  );
  assert.equal(
    releaseMonitorInternals.isMetacriticRefreshDue('invalid-date', payloadWithMetacritic, now),
    true
  );
});
