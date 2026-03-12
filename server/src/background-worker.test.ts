import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __backgroundWorkerTestables,
  isRecommendationTarget,
  readBackgroundWorkerMode,
  readDiscoveryEnrichmentApiBaseUrl,
  readPositiveIntegerEnv,
  shouldRunPricingRefreshPhase,
  stringOrEmpty
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
      intervalMinutes: 60
    }),
    false
  );

  assert.equal(
    shouldRunPricingRefreshPhase({
      enabled: true,
      trigger: 'startup',
      nowMs,
      lastRunMs,
      intervalMinutes: 60
    }),
    true
  );

  assert.equal(
    shouldRunPricingRefreshPhase({
      enabled: true,
      trigger: 'interval',
      nowMs,
      lastRunMs,
      intervalMinutes: 60
    }),
    false
  );

  assert.equal(
    shouldRunPricingRefreshPhase({
      enabled: true,
      trigger: 'interval',
      nowMs,
      lastRunMs: nowMs - 60 * 60 * 1000,
      intervalMinutes: 60
    }),
    true
  );
});

void test('pricing freshness ignores provider attempt timestamps without unified price value', () => {
  const payload = {
    steamPriceFetchedAt: '2026-03-12T07:00:00.000Z',
    psPricesFetchedAt: '2026-03-12T07:00:00.000Z'
  } satisfies Record<string, unknown>;

  assert.equal(__backgroundWorkerTestables.resolvePriceFetchedAtMs(payload), null);
});

void test('pricing freshness uses unified priceFetchedAt for paid/free snapshots', () => {
  const paidPayload = {
    priceAmount: 19.99,
    priceFetchedAt: '2026-03-12T07:00:00.000Z'
  } satisfies Record<string, unknown>;
  const freePayload = {
    priceIsFree: true,
    priceFetchedAt: '2026-03-12T08:00:00.000Z'
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
    priceFetchedAt: '   '
  } satisfies Record<string, unknown>;
  const invalidPayload = {
    priceIsFree: true,
    priceFetchedAt: 'not-a-date'
  } satisfies Record<string, unknown>;

  assert.equal(__backgroundWorkerTestables.resolvePriceFetchedAtMs(blankPayload), null);
  assert.equal(__backgroundWorkerTestables.resolvePriceFetchedAtMs(invalidPayload), null);
});

void test('PSPrices revalidation title prefers saved match query title over game title', () => {
  const withOverride = {
    title: 'Pokemon Violet',
    psPricesMatchQueryTitle: 'Pokemon Scarlet'
  } satisfies Record<string, unknown>;
  const withoutOverride = {
    title: 'Pokemon Violet'
  } satisfies Record<string, unknown>;
  const blankValues = {
    title: '   ',
    psPricesMatchQueryTitle: ''
  } satisfies Record<string, unknown>;

  assert.equal(
    __backgroundWorkerTestables.resolvePspricesRevalidationTitle(withOverride),
    'Pokemon Scarlet'
  );
  assert.equal(
    __backgroundWorkerTestables.resolvePspricesRevalidationTitle(withoutOverride),
    'Pokemon Violet'
  );
  assert.equal(__backgroundWorkerTestables.resolvePspricesRevalidationTitle(blankValues), null);
});
