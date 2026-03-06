import { readFileSync } from 'node:fs';

export const DISCOVERY_ENRICHMENT_REARM_AFTER_DAYS_DEFAULT = 30;
export const DISCOVERY_ENRICHMENT_REARM_RECENT_RELEASE_YEARS_DEFAULT = 1;

export interface DiscoveryEnrichmentSelectionOptions {
  nowIso?: string;
  maxAttempts?: number;
  rearmAfterDays?: number;
  rearmRecentReleaseYears?: number;
}

export interface DiscoveryEnrichmentSelectionParams {
  normalizedLimit: number;
  maxAttempts: number;
  nowIso: string;
  rearmAfterDays: number;
  rearmMinReleaseYear: number;
}

export const LIST_DISCOVERY_ROWS_MISSING_ENRICHMENT_SQL = readFileSync(
  new URL('./sql/list-discovery-rows-missing-enrichment.sql', import.meta.url),
  'utf8'
);

export function buildDiscoveryEnrichmentSelectionParams(
  limit: number,
  options?: DiscoveryEnrichmentSelectionOptions
): DiscoveryEnrichmentSelectionParams {
  const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 1;
  const nowCandidate = options?.nowIso;
  const parsedNowMs = typeof nowCandidate === 'string' ? Date.parse(nowCandidate) : Number.NaN;
  const nowMs = Number.isFinite(parsedNowMs) ? parsedNowMs : Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const maxAttempts =
    typeof options?.maxAttempts === 'number' && Number.isFinite(options.maxAttempts)
      ? Math.max(1, Math.trunc(options.maxAttempts))
      : 1;
  const rearmAfterDays =
    typeof options?.rearmAfterDays === 'number' && Number.isFinite(options.rearmAfterDays)
      ? Math.max(1, Math.trunc(options.rearmAfterDays))
      : DISCOVERY_ENRICHMENT_REARM_AFTER_DAYS_DEFAULT;
  const rearmRecentReleaseYears =
    typeof options?.rearmRecentReleaseYears === 'number' &&
    Number.isFinite(options.rearmRecentReleaseYears)
      ? Math.max(1, Math.trunc(options.rearmRecentReleaseYears))
      : DISCOVERY_ENRICHMENT_REARM_RECENT_RELEASE_YEARS_DEFAULT;
  const currentYear = new Date(nowIso).getUTCFullYear();
  const rearmMinReleaseYear = currentYear - rearmRecentReleaseYears + 1;

  return {
    normalizedLimit,
    maxAttempts,
    nowIso,
    rearmAfterDays,
    rearmMinReleaseYear
  };
}
