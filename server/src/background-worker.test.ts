import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isRecommendationTarget,
  readBackgroundWorkerMode,
  readDiscoveryEnrichmentApiBaseUrl,
  readPositiveIntegerEnv,
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
