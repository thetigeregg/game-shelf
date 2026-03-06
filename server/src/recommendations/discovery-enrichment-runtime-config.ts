export interface DiscoveryEnrichmentRuntimeConfig {
  rearmAfterDays: number;
  rearmRecentReleaseYears: number;
}

function readPositiveIntegerEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  const parsed = Number.parseInt(typeof raw === 'string' ? raw.trim() : '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveDiscoveryEnrichmentRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): DiscoveryEnrichmentRuntimeConfig {
  return {
    rearmAfterDays: readPositiveIntegerEnv(
      env,
      'RECOMMENDATIONS_DISCOVERY_ENRICH_REARM_AFTER_DAYS',
      30
    ),
    rearmRecentReleaseYears: readPositiveIntegerEnv(
      env,
      'RECOMMENDATIONS_DISCOVERY_ENRICH_REARM_RECENT_RELEASE_YEARS',
      1
    )
  };
}
