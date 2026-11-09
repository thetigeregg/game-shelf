import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __backgroundWorkerTestables,
  isRecommendationTarget,
  readBackgroundWorkerMode,
  readDiscoveryEnrichmentApiBaseUrl,
  readDiscoveryEnrichmentGameKeys,
  readPositiveIntegerEnv,
  shouldRunPricingRefreshPhase,
  stringOrEmpty,
} from './background-worker.js';

void test('background worker reads discovery enrich API base URL with trim + fallback', () => {
  const previous = process.env.RECOMMENDATIONS_ENRICH_API_BASE_URL;
  try {
    process.env.RECOMMENDATIONS_ENRICH_API_BASE_URL = '  http://api:3000  ';
    assert.equal(readDiscoveryEnrichmentApiBaseUrl(), 'http://api:3000');

    process.env.RECOMMENDATIONS_ENRICH_API_BASE_URL = '   ';
    assert.equal(readDiscoveryEnrichmentApiBaseUrl(), 'http://api:3000');
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, 'RECOMMENDATIONS_ENRICH_API_BASE_URL');
    } else {
      process.env.RECOMMENDATIONS_ENRICH_API_BASE_URL = previous;
    }
  }
});

void test('background worker positive integer env parser keeps sane fallback', () => {
  const key = 'BACKGROUND_WORKER_TEST_INTEGER';
  const previous = process.env[key];
  try {
    process.env[key] = '7';
    assert.equal(readPositiveIntegerEnv(key, 3), 7);

    process.env[key] = '0';
    assert.equal(readPositiveIntegerEnv(key, 3), 3);

    process.env[key] = '-2';
    assert.equal(readPositiveIntegerEnv(key, 3), 3);

    process.env[key] = 'not-a-number';
    assert.equal(readPositiveIntegerEnv(key, 3), 3);
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = previous;
    }
  }
});

void test('background worker helper guards recommendation target + string payloads', () => {
  assert.equal(isRecommendationTarget('BACKLOG'), true);
  assert.equal(isRecommendationTarget('WISHLIST'), true);
  assert.equal(isRecommendationTarget('DISCOVERY'), true);
  assert.equal(isRecommendationTarget('INVALID'), false);
  assert.equal(isRecommendationTarget(null), false);

  assert.equal(stringOrEmpty('value'), 'value');
  assert.equal(stringOrEmpty(123), '');
  assert.equal(stringOrEmpty(undefined), '');

  assert.deepEqual(readDiscoveryEnrichmentGameKeys({ gameKeys: ['100::48', ' 100::48 ', '', 3] }), [
    '100::48',
  ]);
  assert.equal(readDiscoveryEnrichmentGameKeys({ gameKeys: ['   ', null] }), null);
  assert.equal(readDiscoveryEnrichmentGameKeys({ providers: ['hltb'] }), null);
  assert.deepEqual(
    __backgroundWorkerTestables.readDiscoveryEnrichmentProviders({
      providers: ['review', 'review', 'steam'],
    }),
    ['review', 'steam']
  );
  assert.equal(
    __backgroundWorkerTestables.readDiscoveryEnrichmentProviders({
      providers: ['pricing', 'invalid'],
    }),
    null
  );
  assert.equal(
    __backgroundWorkerTestables.readDiscoveryEnrichmentProviders({ gameKeys: ['100::48'] }),
    null
  );
});

void test('background worker mode parser supports general/recommendations/all with sane fallback', () => {
  const previous = process.env.BACKGROUND_WORKER_MODE;
  const warn = console.warn;
  const warnings: unknown[][] = [];
  try {
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    process.env.BACKGROUND_WORKER_MODE = 'general';
    assert.equal(readBackgroundWorkerMode(), 'general');

    process.env.BACKGROUND_WORKER_MODE = 'recommendations';
    assert.equal(readBackgroundWorkerMode(), 'recommendations');

    process.env.BACKGROUND_WORKER_MODE = 'all';
    assert.equal(readBackgroundWorkerMode(), 'all');

    process.env.BACKGROUND_WORKER_MODE = '  GENERAL  ';
    assert.equal(readBackgroundWorkerMode(), 'general');

    process.env.BACKGROUND_WORKER_MODE = 'invalid';
    assert.equal(readBackgroundWorkerMode(), 'all');
    assert.equal(warnings.length, 1);
    assert.equal(
      warnings[0]?.[0],
      '[background-worker] invalid BACKGROUND_WORKER_MODE; falling back to all'
    );
    assert.deepEqual(warnings[0]?.[1], { rawValue: 'invalid' });
  } finally {
    console.warn = warn;
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, 'BACKGROUND_WORKER_MODE');
    } else {
      process.env.BACKGROUND_WORKER_MODE = previous;
    }
  }
});

void test('pricing refresh phase helper handles startup, interval, and disabled states', () => {
  const nowMs = Date.parse('2026-03-10T10:00:00.000Z');
  const lastRunMs = nowMs - 30 * 60 * 1000;

  assert.equal(
    shouldRunPricingRefreshPhase({
      enabled: false,
      trigger: 'startup',
      nowMs,
      lastRunMs,
      intervalMinutes: 60,
    }),
    false
  );

  assert.equal(
    shouldRunPricingRefreshPhase({
      enabled: true,
      trigger: 'startup',
      nowMs,
      lastRunMs,
      intervalMinutes: 60,
    }),
    true
  );

  assert.equal(
    shouldRunPricingRefreshPhase({
      enabled: true,
      trigger: 'interval',
      nowMs,
      lastRunMs,
      intervalMinutes: 60,
    }),
    false
  );

  assert.equal(
    shouldRunPricingRefreshPhase({
      enabled: true,
      trigger: 'interval',
      nowMs,
      lastRunMs: nowMs - 60 * 60 * 1000,
      intervalMinutes: 60,
    }),
    true
  );
});

void test('pricing freshness ignores provider attempt timestamps without unified price value', () => {
  const payload = {
    steamPriceFetchedAt: '2026-03-12T07:00:00.000Z',
    psPricesFetchedAt: '2026-03-12T07:00:00.000Z',
  } satisfies Record<string, unknown>;

  assert.equal(__backgroundWorkerTestables.resolvePriceFetchedAtMs(payload), null);
});

void test('pricing freshness uses unified priceFetchedAt for paid/free snapshots', () => {
  const paidPayload = {
    priceAmount: 19.99,
    priceFetchedAt: '2026-03-12T07:00:00.000Z',
  } satisfies Record<string, unknown>;
  const freePayload = {
    priceIsFree: true,
    priceFetchedAt: '2026-03-12T08:00:00.000Z',
  } satisfies Record<string, unknown>;

  assert.equal(
    __backgroundWorkerTestables.resolvePriceFetchedAtMs(paidPayload),
    Date.parse('2026-03-12T07:00:00.000Z')
  );
  assert.equal(
    __backgroundWorkerTestables.resolvePriceFetchedAtMs(freePayload),
    Date.parse('2026-03-12T08:00:00.000Z')
  );
});

void test('pricing freshness returns null for invalid/blank unified priceFetchedAt', () => {
  const blankPayload = {
    priceAmount: 9.99,
    priceFetchedAt: '   ',
  } satisfies Record<string, unknown>;
  const invalidPayload = {
    priceIsFree: true,
    priceFetchedAt: 'not-a-date',
  } satisfies Record<string, unknown>;

  assert.equal(__backgroundWorkerTestables.resolvePriceFetchedAtMs(blankPayload), null);
  assert.equal(__backgroundWorkerTestables.resolvePriceFetchedAtMs(invalidPayload), null);
});

void test('queued psprices jobs for store-priced platforms are drained without writing', () => {
  for (const platformIgdbId of [48, 167, 130, 508]) {
    assert.equal(__backgroundWorkerTestables.isObsoletePspricesJob(platformIgdbId), true);
  }
  // Malformed payloads have no psprices platform either.
  assert.equal(__backgroundWorkerTestables.isObsoletePspricesJob(Number.NaN), true);
});

void test('provider match lock helper only treats explicit true as locked', () => {
  assert.equal(
    __backgroundWorkerTestables.isProviderMatchLocked(
      { psPricesMatchLocked: true } satisfies Record<string, unknown>,
      'psPricesMatchLocked'
    ),
    true
  );
  assert.equal(
    __backgroundWorkerTestables.isProviderMatchLocked(
      { psPricesMatchLocked: false } satisfies Record<string, unknown>,
      'psPricesMatchLocked'
    ),
    false
  );
  assert.equal(
    __backgroundWorkerTestables.isProviderMatchLocked(
      {} satisfies Record<string, unknown>,
      'psPricesMatchLocked'
    ),
    false
  );
});

void test('resolvePriceFetchedAtMs treats a price from another source as stale', () => {
  const payload = {
    priceSource: 'psprices',
    priceAmount: 29.9,
    priceFetchedAt: '2026-03-10T09:00:00.000Z',
  };
  const fetchedAtMs = Date.parse('2026-03-10T09:00:00.000Z');

  assert.equal(__backgroundWorkerTestables.resolvePriceFetchedAtMs(payload), fetchedAtMs);
  assert.equal(
    __backgroundWorkerTestables.resolvePriceFetchedAtMs(payload, 'psprices'),
    fetchedAtMs
  );
  // PS4/PS5 moved to the PlayStation Store: an old psprices price is re-fetched there now.
  assert.equal(
    __backgroundWorkerTestables.resolvePriceFetchedAtMs(payload, 'playstation_store'),
    null
  );
  // Switch/Switch 2 moved to the Nintendo eShop, likewise.
  assert.equal(
    __backgroundWorkerTestables.resolvePriceFetchedAtMs(payload, 'nintendo_eshop'),
    null
  );
});

void test('resolvePriceFetchedAtMs counts a Nintendo eShop attempt that found nothing', () => {
  const attemptedAt = '2026-03-10T09:00:00.000Z';
  assert.equal(
    __backgroundWorkerTestables.resolvePriceFetchedAtMs(
      { nintendoEshopFetchedAt: attemptedAt },
      'nintendo_eshop'
    ),
    Date.parse(attemptedAt)
  );
  assert.equal(__backgroundWorkerTestables.resolvePriceFetchedAtMs({}, 'nintendo_eshop'), null);
});

void test('resolvePriceFetchedAtMs counts a PlayStation Store attempt that found nothing', () => {
  const attemptedAt = '2026-03-10T09:00:00.000Z';
  // No store match: the old psprices price was cleared, but the store looked up the game.
  assert.equal(
    __backgroundWorkerTestables.resolvePriceFetchedAtMs(
      { playstationStoreFetchedAt: attemptedAt },
      'playstation_store'
    ),
    Date.parse(attemptedAt)
  );
  // Never tried: due now.
  assert.equal(__backgroundWorkerTestables.resolvePriceFetchedAtMs({}, 'playstation_store'), null);
  // Other sources keep tracking successful prices only.
  assert.equal(
    __backgroundWorkerTestables.resolvePriceFetchedAtMs(
      { psPricesFetchedAt: attemptedAt },
      'psprices'
    ),
    null
  );
});

void test('resolvePriceFetchedAtMs prefers a newer PlayStation Store attempt over a kept price', () => {
  const priceFetchedAt = '2026-03-01T09:00:00.000Z';
  const attemptedAt = '2026-03-10T09:00:00.000Z';
  // The store stopped matching: the last price is kept, but it looked the game up again.
  assert.equal(
    __backgroundWorkerTestables.resolvePriceFetchedAtMs(
      {
        priceSource: 'playstation_store',
        priceAmount: 29.9,
        priceFetchedAt,
        playstationStoreFetchedAt: attemptedAt,
      },
      'playstation_store'
    ),
    Date.parse(attemptedAt)
  );
});
