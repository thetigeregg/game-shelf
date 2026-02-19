import type { GameCatalogResult, GameEntry } from '../core/models/game.models';

export type MgcRowStatus = 'pending' | 'searching' | 'resolved' | 'multiple' | 'noMatch' | 'error';

export interface MgcImportRow {
  id: number;
  rowNumber: number;
  name: string;
  platformInput: string;
  platform: string;
  platformIgdbId: number | null;
  labelsRaw: string;
  labels: string[];
  status: MgcRowStatus;
  statusDetail: string;
  warning: string | null;
  error: string | null;
  duplicateError: string | null;
  candidates: GameCatalogResult[];
  selected: GameCatalogResult | null;
}

export const MGC_RESOLVE_BASE_INTERVAL_MS = 450;
export const MGC_RESOLVE_MIN_INTERVAL_MS = 350;
export const MGC_RESOLVE_MAX_INTERVAL_MS = 1600;
export const MGC_BOX_ART_MIN_INTERVAL_MS = 350;
export const MGC_HLTB_MIN_INTERVAL_MS = 350;
export const MGC_RESOLVE_MAX_ATTEMPTS = 3;
export const MGC_BOX_ART_MAX_ATTEMPTS = 3;
export const MGC_HLTB_MAX_ATTEMPTS = 3;
export const MGC_TRANSIENT_RETRY_BASE_DELAY_MS = 1500;
export const MGC_TRANSIENT_RETRY_MAX_DELAY_MS = 12000;
export const MGC_RATE_LIMIT_FALLBACK_COOLDOWN_MS = 1000;
export const MGC_RATE_LIMIT_MAX_COOLDOWN_MS = 60000;

export function isMgcAutoSelectedMultiple(row: MgcImportRow): boolean {
  return row.status === 'multiple' && row.selected !== null;
}

export function isMgcRowReady(row: MgcImportRow): boolean {
  return (
    row.error === null &&
    row.duplicateError === null &&
    (row.status === 'resolved' || (row.status === 'multiple' && row.selected !== null)) &&
    row.selected !== null
  );
}

export function isMgcRowError(row: MgcImportRow): boolean {
  return (
    row.error !== null ||
    row.duplicateError !== null ||
    row.status === 'noMatch' ||
    row.status === 'error'
  );
}

export function isMgcRowWarning(row: MgcImportRow): boolean {
  return !isMgcRowError(row) && row.status === 'multiple' && row.selected === null;
}

export function isMgcRowSuccess(row: MgcImportRow): boolean {
  return (
    !isMgcRowError(row) &&
    !isMgcRowWarning(row) &&
    (row.status === 'resolved' || isMgcAutoSelectedMultiple(row))
  );
}

export function parseMgcLabels(raw: string): string[] {
  if (raw.trim().length === 0) {
    return [];
  }

  return [
    ...new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  ];
}

export function normalizeLookupKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function normalizeMgcTitleForMatch(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function resolveRateLimitRetryDelayMs(statusDetail: string): number {
  const retryAfterMatch = statusDetail.match(/retry after\s+(\d+)\s*s/i);

  if (retryAfterMatch) {
    const seconds = Number.parseInt(retryAfterMatch[1], 10);

    if (Number.isInteger(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, MGC_RATE_LIMIT_MAX_COOLDOWN_MS);
    }
  }

  return MGC_RATE_LIMIT_FALLBACK_COOLDOWN_MS;
}

export function resolveTransientRetryDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(
    MGC_TRANSIENT_RETRY_BASE_DELAY_MS * 2 ** exponent,
    MGC_TRANSIENT_RETRY_MAX_DELAY_MS
  );
}

export function resolveGlobalCooldownWaitMs(cooldownUntilMs: number, nowMs: number): number {
  return Math.max(cooldownUntilMs - nowMs, 0);
}

export function normalizeCompletionHours(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value * 10) / 10;
}

export function hasHltbData(game: GameEntry): boolean {
  return (
    normalizeCompletionHours(game.hltbMainHours) !== null ||
    normalizeCompletionHours(game.hltbMainExtraHours) !== null ||
    normalizeCompletionHours(game.hltbCompletionistHours) !== null
  );
}

export function getGameKey(igdbGameId: string, platformIgdbId: number): string {
  return `${igdbGameId}::${platformIgdbId}`;
}

export function getMgcRowGameKey(row: MgcImportRow): string | null {
  if (!row.selected || row.status !== 'resolved') {
    return null;
  }

  const platformIgdbId = row.selected.platformIgdbId;
  const igdbGameId = String(row.selected.igdbGameId ?? '').trim();

  if (
    !/^\d+$/.test(igdbGameId) ||
    typeof platformIgdbId !== 'number' ||
    !Number.isInteger(platformIgdbId) ||
    platformIgdbId <= 0
  ) {
    return null;
  }

  return getGameKey(igdbGameId, platformIgdbId);
}

export function recomputeMgcDuplicateErrors(rows: MgcImportRow[], existingKeys: Set<string>): void {
  rows.forEach((row) => {
    row.duplicateError = null;
  });

  const groups = new Map<string, MgcImportRow[]>();

  for (const row of rows) {
    const key = getMgcRowGameKey(row);

    if (!key) {
      continue;
    }

    if (existingKeys.has(key)) {
      row.duplicateError = 'Duplicate game already exists in your library.';
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key)?.push(row);
  }

  groups.forEach((groupedRows) => {
    if (groupedRows.length < 2) {
      return;
    }

    groupedRows.forEach((row) => {
      row.duplicateError = 'Duplicate game also appears in this MGC import.';
    });
  });
}
