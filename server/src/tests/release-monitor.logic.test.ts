import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { config } from '../config.js';
import { releaseMonitorInternals, startReleaseMonitor } from '../release-monitor.js';

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

void test('derive release state and past-years checks handle precision edge cases', () => {
  const now = new Date('2026-03-06T10:00:00.000Z');

  assert.equal(
    releaseMonitorInternals.deriveReleaseState(
      { precision: 'unknown', marker: null, date: null, year: null, display: null },
      now
    ),
    'unknown'
  );
  assert.equal(
    releaseMonitorInternals.deriveReleaseState(
      {
        precision: 'day',
        marker: '2026-03-07',
        date: '2026-03-07',
        year: 2026,
        display: '2026-03-07'
      },
      now
    ),
    'scheduled'
  );
  assert.equal(
    releaseMonitorInternals.deriveReleaseState(
      {
        precision: 'month',
        marker: '2026-01',
        date: null,
        year: 2026,
        display: '2026-01'
      },
      now
    ),
    'released'
  );
  assert.equal(
    releaseMonitorInternals.deriveReleaseState(
      {
        precision: 'quarter',
        marker: 'bad',
        date: null,
        year: 2026,
        display: 'bad'
      },
      now
    ),
    'unknown'
  );

  assert.equal(
    releaseMonitorInternals.isWithinPastYears(
      {
        precision: 'year',
        marker: '2025',
        date: null,
        year: 2025,
        display: '2025'
      },
      now,
      3
    ),
    true
  );
  assert.equal(
    releaseMonitorInternals.isWithinPastYears(
      {
        precision: 'year',
        marker: '2010',
        date: null,
        year: 2010,
        display: '2010'
      },
      now,
      3
    ),
    false
  );
  assert.equal(
    releaseMonitorInternals.isWithinPastYears(
      {
        precision: 'quarter',
        marker: 'bad',
        date: null,
        year: 2026,
        display: 'bad'
      },
      now,
      3
    ),
    false
  );
});

void test('computeNextCheckAt covers precision windows and periodic refresh cadence', () => {
  const now = new Date('2026-03-06T10:00:00.000Z');
  const oneDayMs = 24 * 60 * 60 * 1000;

  const within30Days = Date.parse(
    releaseMonitorInternals.computeNextCheckAt(
      {
        precision: 'day',
        marker: '2026-03-10',
        date: '2026-03-10',
        year: 2026,
        display: '2026-03-10'
      },
      now,
      false,
      null,
      false,
      null
    )
  );
  assert.equal(Math.round((within30Days - now.getTime()) / (60 * 60 * 1000)), 6);

  const monthFuture = Date.parse(
    releaseMonitorInternals.computeNextCheckAt(
      {
        precision: 'month',
        marker: '2026-11',
        date: null,
        year: 2026,
        display: '2026-11'
      },
      now,
      false,
      null,
      false,
      null
    )
  );
  assert.equal(Math.round((monthFuture - now.getTime()) / oneDayMs), 7);

  const quarterPast = Date.parse(
    releaseMonitorInternals.computeNextCheckAt(
      {
        precision: 'quarter',
        marker: '2025-Q1',
        date: null,
        year: 2025,
        display: 'Q1 2025'
      },
      now,
      false,
      null,
      false,
      null
    )
  );
  assert.equal(Math.round((quarterPast - now.getTime()) / oneDayMs), 30);

  const yearFuture = Date.parse(
    releaseMonitorInternals.computeNextCheckAt(
      {
        precision: 'year',
        marker: '2027',
        date: null,
        year: 2027,
        display: '2027'
      },
      now,
      false,
      null,
      false,
      null
    )
  );
  assert.equal(Math.round((yearFuture - now.getTime()) / oneDayMs), 30);

  const refreshSoonest = Date.parse(
    releaseMonitorInternals.computeNextCheckAt(
      {
        precision: 'day',
        marker: '2026-12-01',
        date: '2026-12-01',
        year: 2026,
        display: '2026-12-01'
      },
      now,
      true,
      null,
      true,
      '2026-03-01T10:00:00.000Z'
    )
  );
  assert.equal(refreshSoonest, now.getTime());
});

void test('normalizers handle invalid marker and precision inputs', () => {
  assert.deepEqual(releaseMonitorInternals.normalizeReleaseInfoFromPrecision('month', '2026-13'), {
    precision: 'month',
    marker: '2026-13',
    date: null,
    year: 2026,
    display: '2026-13'
  });
  assert.deepEqual(
    releaseMonitorInternals.normalizeReleaseInfoFromPrecision('quarter', '2026-Q9'),
    {
      precision: 'unknown',
      marker: null,
      date: null,
      year: null,
      display: null
    }
  );
  assert.deepEqual(releaseMonitorInternals.normalizeReleaseInfoFromPrecision('day', 'not-a-day'), {
    precision: 'unknown',
    marker: null,
    date: null,
    year: null,
    display: null
  });
  assert.equal(releaseMonitorInternals.normalizeReleasePrecision('month'), 'month');
  assert.equal(releaseMonitorInternals.normalizeReleasePrecision('n/a'), null);
  assert.equal(
    releaseMonitorInternals.normalizeDateString('2026-11-19T10:00:00.000Z'),
    '2026-11-19'
  );
  assert.equal(releaseMonitorInternals.normalizeDateString('Q4 2026'), null);
});

void test('startReleaseMonitor returns inert monitor when disabled', () => {
  const original = config.releaseMonitorEnabled;
  config.releaseMonitorEnabled = false;
  try {
    const monitor = startReleaseMonitor({} as Pool);
    monitor.stop();
  } finally {
    config.releaseMonitorEnabled = original;
  }
});

void test('loadActiveTokenSet paginates active tokens with stable ordering', async () => {
  const seenParams: unknown[][] = [];
  const firstPage = Array.from({ length: 1000 }, (_, index) => ({
    token: `token-${String(index).padStart(4, '0')}`
  }));
  const pool = {
    query: (_sql: string, params: unknown[]) => {
      seenParams.push(params);
      if (params.length === 1) {
        return Promise.resolve({
          rows: firstPage
        });
      }
      if (params[0] === 'token-0999') {
        return Promise.resolve({
          rows: [{ token: 'token-1000' }]
        });
      }
      return Promise.resolve({ rows: [] });
    }
  };

  const set = await releaseMonitorInternals.loadActiveTokenSet(pool as unknown as Pool);
  assert.equal(set.has('token-0000'), true);
  assert.equal(set.has('token-0999'), true);
  assert.equal(set.has('token-1000'), true);
  assert.equal(set.size, 1001);
  assert.equal(seenParams.length >= 2, true);
});
