import { readFileSync } from 'node:fs';

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
  const nowIso = options?.nowIso ?? new Date().toISOString();
  const maxAttempts =
    typeof options?.maxAttempts === 'number' && Number.isFinite(options.maxAttempts)
      ? Math.max(1, Math.trunc(options.maxAttempts))
      : 1;
  const rearmAfterDays =
    typeof options?.rearmAfterDays === 'number' && Number.isFinite(options.rearmAfterDays)
      ? Math.max(1, Math.trunc(options.rearmAfterDays))
      : 30;
  const rearmRecentReleaseYears =
    typeof options?.rearmRecentReleaseYears === 'number' &&
    Number.isFinite(options.rearmRecentReleaseYears)
      ? Math.max(1, Math.trunc(options.rearmRecentReleaseYears))
      : 1;
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
