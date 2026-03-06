import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDiscoveryEnrichmentRuntimeConfig } from './discovery-enrichment-runtime-config.js';

void test('resolveDiscoveryEnrichmentRuntimeConfig returns defaults for missing or invalid env values', () => {
  const config = resolveDiscoveryEnrichmentRuntimeConfig({
    RECOMMENDATIONS_DISCOVERY_ENRICH_REARM_AFTER_DAYS: '0',
    RECOMMENDATIONS_DISCOVERY_ENRICH_REARM_RECENT_RELEASE_YEARS: 'NaN'
  });

  assert.deepEqual(config, {
    rearmAfterDays: 30,
    rearmRecentReleaseYears: 1
  });
});

void test('resolveDiscoveryEnrichmentRuntimeConfig returns parsed positive integer env values', () => {
  const config = resolveDiscoveryEnrichmentRuntimeConfig({
    RECOMMENDATIONS_DISCOVERY_ENRICH_REARM_AFTER_DAYS: '45',
    RECOMMENDATIONS_DISCOVERY_ENRICH_REARM_RECENT_RELEASE_YEARS: '2'
  });

  assert.deepEqual(config, {
    rearmAfterDays: 45,
    rearmRecentReleaseYears: 2
  });
});
