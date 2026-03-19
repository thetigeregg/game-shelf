export interface ProviderRetryState {
  attempts: number;
  lastTriedAt: string | null;
  nextTryAt: string | null;
  permanentMiss: boolean;
}

export function createEmptyProviderRetryState(): ProviderRetryState {
  return {
    attempts: 0,
    lastTriedAt: null,
    nextTryAt: null,
    permanentMiss: false,
  };
}

export function parseProviderRetryState(value: unknown): ProviderRetryState {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const attemptsRaw = source.attempts;
  const attempts =
    typeof attemptsRaw === 'number' && Number.isInteger(attemptsRaw) && attemptsRaw > 0
      ? attemptsRaw
      : 0;

  const lastTriedAt =
    typeof source.lastTriedAt === 'string' && Number.isFinite(Date.parse(source.lastTriedAt))
      ? source.lastTriedAt
      : null;
  const nextTryAt =
    typeof source.nextTryAt === 'string' && Number.isFinite(Date.parse(source.nextTryAt))
      ? source.nextTryAt
      : null;
  const permanentMiss = source.permanentMiss === true;

  return { attempts, lastTriedAt, nextTryAt, permanentMiss };
}

export function shouldAttemptProvider(params: {
  state: ProviderRetryState;
  nowMs: number;
  maxAttempts: number;
}): boolean {
  const maxAttempts = Math.max(1, params.maxAttempts);

  if (params.state.permanentMiss) {
    return false;
  }

  if (params.state.attempts >= maxAttempts) {
    return false;
  }

  if (params.state.nextTryAt) {
    const nextTryAtMs = Date.parse(params.state.nextTryAt);
    if (Number.isFinite(nextTryAtMs) && params.nowMs < nextTryAtMs) {
      return false;
    }
  }

  return true;
}

export function nextProviderRetryState(params: {
  current: ProviderRetryState;
  nowIso: string;
  success: boolean;
  maxAttempts: number;
  backoffBaseMinutes: number;
  backoffMaxHours: number;
}): ProviderRetryState {
  if (params.success) {
    return {
      attempts: 0,
      lastTriedAt: params.nowIso,
      nextTryAt: null,
      permanentMiss: false,
    };
  }

  const attempts = Math.max(0, params.current.attempts) + 1;
  const maxAttempts = Math.max(1, params.maxAttempts);
  const baseMinutes = Math.max(1, params.backoffBaseMinutes);
  const maxHours = Math.max(1, params.backoffMaxHours);

  if (attempts >= maxAttempts) {
    return {
      attempts,
      lastTriedAt: params.nowIso,
      nextTryAt: null,
      permanentMiss: true,
    };
  }

  const exponent = Math.max(0, attempts - 1);
  const delayMinutes = Math.min(baseMinutes * 2 ** exponent, maxHours * 60);
  const nextTryAt = new Date(Date.parse(params.nowIso) + delayMinutes * 60 * 1000).toISOString();

  return {
    attempts,
    lastTriedAt: params.nowIso,
    nextTryAt,
    permanentMiss: false,
  };
}

export function hasMeaningfulRetryState(state: ProviderRetryState): boolean {
  return state.attempts > 0 || state.permanentMiss || state.nextTryAt !== null;
}

export function maybeRearmProviderRetryState(params: {
  state: ProviderRetryState;
  nowMs: number;
  releaseYear: number | null;
  rearmAfterDays: number;
  rearmRecentReleaseYears: number;
  maxAttempts: number;
}): ProviderRetryState {
  const normalizedMaxAttempts = Math.max(1, params.maxAttempts);
  const isCapped = params.state.permanentMiss || params.state.attempts >= normalizedMaxAttempts;
  if (!isCapped) {
    return params.state;
  }

  if (
    !isRearmReleaseYearEligible(params.releaseYear, params.nowMs, params.rearmRecentReleaseYears)
  ) {
    return params.state;
  }

  const rearmAfterDays = Math.max(1, params.rearmAfterDays);
  const rearmAfterMs = rearmAfterDays * 24 * 60 * 60 * 1000;
  const lastTriedAtMs = params.state.lastTriedAt
    ? Date.parse(params.state.lastTriedAt)
    : Number.NaN;
  if (Number.isFinite(lastTriedAtMs) && params.nowMs - lastTriedAtMs < rearmAfterMs) {
    return params.state;
  }

  return createEmptyProviderRetryState();
}

function isRearmReleaseYearEligible(
  releaseYear: number | null,
  nowMs: number,
  rearmRecentReleaseYears: number
): boolean {
  if (releaseYear === null) {
    return true;
  }

  const normalizedYears = Math.max(1, Math.trunc(rearmRecentReleaseYears));
  const currentYear = new Date(nowMs).getUTCFullYear();
  const minReleaseYear = currentYear - normalizedYears + 1;
  return releaseYear >= minReleaseYear;
}
