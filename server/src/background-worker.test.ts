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

void test('PSPrices revalidation title prefers saved match query title over game title', () => {
  const withOverride = {
    title: 'Pokemon Violet',
    psPricesMatchQueryTitle: 'Pokemon Scarlet',
  } satisfies Record<string, unknown>;
  const withoutOverride = {
    title: 'Pokemon Violet',
  } satisfies Record<string, unknown>;
  const blankValues = {
    title: '   ',
    psPricesMatchQueryTitle: '',
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

void test('PSPrices revalidation URL prefers psPricesUrl and falls back to psprices priceUrl', () => {
  const explicitUrl = {
    psPricesUrl: 'https://psprices.com/region-ch/game/1234/monster-train-2',
    priceSource: 'psprices',
    priceUrl: 'https://psprices.com/region-ch/game/9999/ignored',
  } satisfies Record<string, unknown>;
  const sourceFallback = {
    priceSource: 'psprices',
    priceUrl: 'https://psprices.com/region-ch/game/1234/monster-train-2',
  } satisfies Record<string, unknown>;
  const nonPsprices = {
    priceSource: 'steam_store',
    priceUrl: 'https://store.steampowered.com/app/730',
  } satisfies Record<string, unknown>;

  assert.equal(
    __backgroundWorkerTestables.resolvePspricesRevalidationUrl(explicitUrl),
    'https://psprices.com/region-ch/game/1234/monster-train-2'
  );
  assert.equal(
    __backgroundWorkerTestables.resolvePspricesRevalidationUrl(sourceFallback),
    'https://psprices.com/region-ch/game/1234/monster-train-2'
  );
  assert.equal(__backgroundWorkerTestables.resolvePspricesRevalidationUrl(nonPsprices), null);
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

void test('PSPrices scheduler helper respects retry backoff and rearms recent releases', () => {
  const payloadWithFutureBackoff = {
    listType: 'discovery',
    releaseYear: 2026,
    enrichmentRetry: {
      psprices: {
        attempts: 2,
        lastTriedAt: '2026-03-18T07:00:00.000Z',
        nextTryAt: '2026-03-18T15:00:00.000Z',
        permanentMiss: false,
      },
    },
  } satisfies Record<string, unknown>;

  assert.equal(
    __backgroundWorkerTestables.shouldSchedulePspricesRefresh({
      payload: payloadWithFutureBackoff,
      platformIgdbId: 167,
      nowMs: Date.parse('2026-03-18T12:00:00.000Z'),
      maxAttempts: 6,
      rearmAfterDays: 30,
      rearmRecentReleaseYears: 1,
    }),
    false
  );

  const payloadEligibleAfterRearm = {
    listType: 'discovery',
    releaseYear: 2026,
    enrichmentRetry: {
      psprices: {
        attempts: 6,
        lastTriedAt: '2026-01-01T00:00:00.000Z',
        nextTryAt: null,
        permanentMiss: true,
      },
    },
  } satisfies Record<string, unknown>;

  assert.equal(
    __backgroundWorkerTestables.shouldSchedulePspricesRefresh({
      payload: payloadEligibleAfterRearm,
      platformIgdbId: 167,
      nowMs: Date.parse('2026-03-18T12:00:00.000Z'),
      maxAttempts: 6,
      rearmAfterDays: 30,
      rearmRecentReleaseYears: 1,
    }),
    true
  );
});

void test('PSPrices scheduler helper ignores discovery retry backoff for wishlist rows', () => {
  const wishlistPayload = {
    listType: 'wishlist',
    releaseYear: 2026,
    enrichmentRetry: {
      psprices: {
        attempts: 6,
        lastTriedAt: '2026-03-18T07:00:00.000Z',
        nextTryAt: '2026-03-20T07:00:00.000Z',
        permanentMiss: true,
      },
    },
  } satisfies Record<string, unknown>;

  assert.equal(
    __backgroundWorkerTestables.shouldSchedulePspricesRefresh({
      payload: wishlistPayload,
      platformIgdbId: 167,
      nowMs: Date.parse('2026-03-19T12:00:00.000Z'),
      maxAttempts: 6,
      rearmAfterDays: 30,
      rearmRecentReleaseYears: 1,
    }),
    true
  );
});
