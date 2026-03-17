import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDiscoveryEnrichmentSelectionParams } from './discovery-enrichment-query.js';

void test('buildDiscoveryEnrichmentSelectionParams applies sane defaults', () => {
  const params = buildDiscoveryEnrichmentSelectionParams(0, {
    nowIso: '2026-03-10T00:00:00.000Z',
  });

  assert.deepEqual(params, {
    normalizedLimit: 1,
    maxAttempts: 1,
    nowIso: '2026-03-10T00:00:00.000Z',
    rearmAfterDays: 30,
    rearmMinReleaseYear: 2026,
  });
});

void test('buildDiscoveryEnrichmentSelectionParams normalizes custom values', () => {
  const params = buildDiscoveryEnrichmentSelectionParams(50, {
    nowIso: '2026-03-10T00:00:00.000Z',
    maxAttempts: 6,
    rearmAfterDays: 45,
    rearmRecentReleaseYears: 2,
  });

  assert.deepEqual(params, {
    normalizedLimit: 50,
    maxAttempts: 6,
    nowIso: '2026-03-10T00:00:00.000Z',
    rearmAfterDays: 45,
    rearmMinReleaseYear: 2025,
  });
});

void test('buildDiscoveryEnrichmentSelectionParams falls back when nowIso is invalid', () => {
  const realNow = Date.now;
  Date.now = () => Date.parse('2026-03-10T00:00:00.000Z');
  try {
    const params = buildDiscoveryEnrichmentSelectionParams(10, {
      nowIso: 'not-a-date',
      rearmRecentReleaseYears: 2,
    });

    assert.deepEqual(params, {
      normalizedLimit: 10,
      maxAttempts: 1,
      nowIso: '2026-03-10T00:00:00.000Z',
      rearmAfterDays: 30,
      rearmMinReleaseYear: 2025,
    });
  } finally {
    Date.now = realNow;
  }
});
