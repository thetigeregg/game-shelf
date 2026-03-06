import { RecommendationRepository } from './repository.js';
import type { QueryResult, QueryResultRow } from 'pg';

const ENRICHMENT_LOCK_NAMESPACE = 77321;
const ENRICHMENT_LOCK_KEY = 1;

interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
}

export interface DiscoveryEnrichmentServiceOptions {
  enabled: boolean;
  startupDelayMs: number;
  intervalMinutes: number;
  maxGamesPerRun: number;
  requestTimeoutMs: number;
  apiBaseUrl: string;
  maxAttempts: number;
  backoffBaseMinutes: number;
  backoffMaxHours: number;
}

export interface DiscoveryEnrichmentSummary {
  scanned: number;
  updated: number;
  skipped: number;
}

interface HltbResponse {
  item?: {
    hltbMainHours?: number | null;
    hltbMainExtraHours?: number | null;
    hltbCompletionistHours?: number | null;
  } | null;
}

interface MetacriticResponse {
  item?: {
    metacriticScore?: number | null;
    metacriticUrl?: string | null;
  } | null;
}

interface FetchJsonResult<T> {
  ok: boolean;
  value: T | null;
}

interface ProviderRetryState {
  attempts: number;
  lastTriedAt: string | null;
  nextTryAt: string | null;
  permanentMiss: boolean;
}

interface DiscoveryEnrichmentRetryState {
  hltb: ProviderRetryState;
  metacritic: ProviderRetryState;
}

export class DiscoveryEnrichmentService {
  private intervalHandle: NodeJS.Timeout | null = null;
  private startupTimeoutHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly repository: RecommendationRepository,
    private readonly options: DiscoveryEnrichmentServiceOptions,
    private readonly now: () => number = () => Date.now()
  ) {}

  start(): void {
    if (!this.options.enabled || this.intervalHandle) {
      return;
    }

    this.startupTimeoutHandle = setTimeout(
      () => {
        this.startupTimeoutHandle = null;
        void this.runOnce().catch((error: unknown) => {
          console.warn('[recommendations.discovery_enrichment] startup_run_failed', {
            message: error instanceof Error ? error.message : String(error)
          });
        });
      },
      Math.max(0, this.options.startupDelayMs)
    );

    this.intervalHandle = setInterval(
      () => {
        void this.runOnce().catch((error: unknown) => {
          console.warn('[recommendations.discovery_enrichment] interval_run_failed', {
            message: error instanceof Error ? error.message : String(error)
          });
        });
      },
      Math.max(1, this.options.intervalMinutes) * 60 * 1000
    );
  }

  stop(): void {
    if (this.startupTimeoutHandle) {
      clearTimeout(this.startupTimeoutHandle);
      this.startupTimeoutHandle = null;
    }

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async runOnce(): Promise<DiscoveryEnrichmentSummary | null> {
    if (!this.options.enabled) {
      return null;
    }

    const lock = await this.repository.withAdvisoryLock({
      namespace: ENRICHMENT_LOCK_NAMESPACE,
      key: ENRICHMENT_LOCK_KEY,
      callback: (client) =>
        this.enrichNow({
          limit: this.options.maxGamesPerRun,
          queryable: client
        })
    });

    if (!lock.acquired) {
      return null;
    }

    console.info('[recommendations.discovery_enrichment] completed', {
      ...lock.value,
      completedAt: new Date(this.now()).toISOString()
    });
    return lock.value;
  }

  async enrichNow(params?: {
    limit?: number;
    queryable?: Queryable;
  }): Promise<DiscoveryEnrichmentSummary> {
    if (!this.options.enabled) {
      return {
        scanned: 0,
        updated: 0,
        skipped: 0
      };
    }

    const queryable = params?.queryable;
    const rows = await this.repository.listDiscoveryRowsMissingEnrichment(
      params?.limit ?? this.options.maxGamesPerRun,
      queryable,
      {
        nowIso: new Date(this.now()).toISOString(),
        maxAttempts: this.options.maxAttempts,
        rearmAfterDays: this.getRearmAfterDays(),
        rearmRecentReleaseYears: this.getRearmRecentReleaseYears()
      }
    );

    let updated = 0;
    let skipped = 0;
    for (const row of rows) {
      const next = await this.enrichPayload(row.payload, row.platformIgdbId);
      if (!next || JSON.stringify(next) === JSON.stringify(row.payload)) {
        skipped += 1;
        continue;
      }

      await this.repository.updateGamePayload({
        client: queryable,
        igdbGameId: row.igdbGameId,
        platformIgdbId: row.platformIgdbId,
        payload: next
      });
      updated += 1;
    }

    return { scanned: rows.length, updated, skipped };
  }

  private async enrichPayload(
    payload: Record<string, unknown>,
    platformIgdbId: number
  ): Promise<Record<string, unknown> | null> {
    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    if (title.length < 2) {
      return null;
    }

    const releaseYear =
      typeof payload.releaseYear === 'number' && Number.isInteger(payload.releaseYear)
        ? payload.releaseYear
        : null;
    const platform =
      typeof payload.platform === 'string' && payload.platform.trim().length > 0
        ? payload.platform.trim()
        : null;
    const hasHltb =
      hasPositiveNumber(payload.hltbMainHours) ||
      hasPositiveNumber(payload.hltbMainExtraHours) ||
      hasPositiveNumber(payload.hltbCompletionistHours);
    const hasCritic =
      hasPositiveNumber(payload.reviewScore) || hasPositiveNumber(payload.metacriticScore);
    const nowMs = this.now();
    const nowIso = new Date(nowMs).toISOString();
    const rearmAfterDays = this.getRearmAfterDays();
    const rearmRecentReleaseYears = this.getRearmRecentReleaseYears();

    const retryState = parseRetryState(payload.enrichmentRetry);
    const nextRetryStateBase: DiscoveryEnrichmentRetryState = {
      hltb: maybeRearmProviderRetryState({
        state: retryState.hltb,
        nowMs,
        releaseYear,
        rearmAfterDays,
        rearmRecentReleaseYears,
        maxAttempts: this.options.maxAttempts
      }),
      metacritic: maybeRearmProviderRetryState({
        state: retryState.metacritic,
        nowMs,
        releaseYear,
        rearmAfterDays,
        rearmRecentReleaseYears,
        maxAttempts: this.options.maxAttempts
      })
    };
    const shouldTryHltb =
      !hasHltb &&
      shouldAttemptProvider({
        state: nextRetryStateBase.hltb,
        nowMs,
        maxAttempts: this.options.maxAttempts
      });
    const shouldTryMetacritic =
      !hasCritic &&
      shouldAttemptProvider({
        state: nextRetryStateBase.metacritic,
        nowMs,
        maxAttempts: this.options.maxAttempts
      });

    if (!shouldTryHltb && !shouldTryMetacritic) {
      const next = { ...payload };
      const nextRetryState = buildNextRetryState({
        current: nextRetryStateBase,
        needsHltb: !hasHltb,
        needsMetacritic: !hasCritic
      });
      applyRetryState(next, nextRetryState);
      return next;
    }

    const [hltbResponse, metacriticResponse] = await Promise.all([
      shouldTryHltb
        ? this.fetchJson<HltbResponse>(
            this.buildLocalUrl('/v1/hltb/search', {
              q: title,
              ...(releaseYear ? { releaseYear: String(releaseYear) } : {}),
              ...(platform ? { platform } : {})
            })
          )
        : Promise.resolve(null),
      shouldTryMetacritic
        ? this.fetchJson<MetacriticResponse>(
            this.buildLocalUrl('/v1/metacritic/search', {
              q: title,
              ...(releaseYear ? { releaseYear: String(releaseYear) } : {}),
              ...(platform ? { platform } : {}),
              platformIgdbId: String(platformIgdbId)
            })
          )
        : Promise.resolve(null)
    ]);

    const next: Record<string, unknown> = { ...payload };
    const nextRetryState: DiscoveryEnrichmentRetryState = {
      hltb: nextRetryStateBase.hltb,
      metacritic: nextRetryStateBase.metacritic
    };

    const hltbItem = hltbResponse?.ok ? (hltbResponse.value?.item ?? null) : null;
    let foundHltb = hasHltb;
    if (hltbItem) {
      if (typeof hltbItem.hltbMainHours === 'number' && hltbItem.hltbMainHours > 0) {
        next.hltbMainHours = round2(hltbItem.hltbMainHours);
        foundHltb = true;
      }
      if (typeof hltbItem.hltbMainExtraHours === 'number' && hltbItem.hltbMainExtraHours > 0) {
        next.hltbMainExtraHours = round2(hltbItem.hltbMainExtraHours);
        foundHltb = true;
      }
      if (
        typeof hltbItem.hltbCompletionistHours === 'number' &&
        hltbItem.hltbCompletionistHours > 0
      ) {
        next.hltbCompletionistHours = round2(hltbItem.hltbCompletionistHours);
        foundHltb = true;
      }
    }
    if (shouldTryHltb && hltbResponse?.ok) {
      nextRetryState.hltb = nextProviderRetryState({
        current: nextRetryStateBase.hltb,
        nowIso,
        success: foundHltb,
        maxAttempts: this.options.maxAttempts,
        backoffBaseMinutes: this.options.backoffBaseMinutes,
        backoffMaxHours: this.options.backoffMaxHours
      });
    }

    const critic = metacriticResponse?.ok ? (metacriticResponse.value?.item ?? null) : null;
    let foundCritic = hasCritic;
    if (critic && typeof critic.metacriticScore === 'number' && critic.metacriticScore > 0) {
      next.reviewSource = 'metacritic';
      next.reviewScore = round2(critic.metacriticScore);
      next.metacriticScore = round2(critic.metacriticScore);
      foundCritic = true;
      if (typeof critic.metacriticUrl === 'string' && critic.metacriticUrl.trim().length > 0) {
        next.metacriticUrl = critic.metacriticUrl.trim();
        next.reviewUrl = critic.metacriticUrl.trim();
      }
    }
    if (shouldTryMetacritic && metacriticResponse?.ok) {
      nextRetryState.metacritic = nextProviderRetryState({
        current: nextRetryStateBase.metacritic,
        nowIso,
        success: foundCritic,
        maxAttempts: this.options.maxAttempts,
        backoffBaseMinutes: this.options.backoffBaseMinutes,
        backoffMaxHours: this.options.backoffMaxHours
      });
    }

    applyRetryState(
      next,
      buildNextRetryState({
        current: nextRetryState,
        needsHltb: !foundHltb,
        needsMetacritic: !foundCritic
      })
    );

    return next;
  }

  private buildLocalUrl(path: string, query: Record<string, string>): string {
    const url = new URL(path, this.options.apiBaseUrl);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private getRearmAfterDays(): number {
    const raw = (this.options as { rearmAfterDays?: unknown }).rearmAfterDays;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Math.max(1, Math.trunc(raw));
    }
    return 30;
  }

  private getRearmRecentReleaseYears(): number {
    const raw = (this.options as { rearmRecentReleaseYears?: unknown }).rearmRecentReleaseYears;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Math.max(1, Math.trunc(raw));
    }
    return 1;
  }

  private async fetchJson<T>(url: string): Promise<FetchJsonResult<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.options.requestTimeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-gameshelf-discovery-enrichment': '1'
        },
        signal: controller.signal
      });
      if (!response.ok) {
        return { ok: false, value: null };
      }
      if (response.status === 204) {
        return { ok: true, value: null };
      }

      const bodyText = await response.text();
      if (bodyText.trim().length === 0) {
        return { ok: true, value: null };
      }

      return { ok: true, value: JSON.parse(bodyText) as T };
    } catch {
      return { ok: false, value: null };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function hasPositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseRetryState(value: unknown): DiscoveryEnrichmentRetryState {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    hltb: parseProviderRetryState(source.hltb),
    metacritic: parseProviderRetryState(source.metacritic)
  };
}

function parseProviderRetryState(value: unknown): ProviderRetryState {
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

function shouldAttemptProvider(params: {
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

function nextProviderRetryState(params: {
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
      permanentMiss: false
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
      permanentMiss: true
    };
  }

  const exponent = Math.max(0, attempts - 1);
  const delayMinutes = Math.min(baseMinutes * 2 ** exponent, maxHours * 60);
  const nextTryAt = new Date(Date.parse(params.nowIso) + delayMinutes * 60 * 1000).toISOString();

  return {
    attempts,
    lastTriedAt: params.nowIso,
    nextTryAt,
    permanentMiss: false
  };
}

function buildNextRetryState(params: {
  current: DiscoveryEnrichmentRetryState;
  needsHltb: boolean;
  needsMetacritic: boolean;
}): DiscoveryEnrichmentRetryState {
  return {
    hltb: params.needsHltb
      ? params.current.hltb
      : { attempts: 0, lastTriedAt: null, nextTryAt: null, permanentMiss: false },
    metacritic: params.needsMetacritic
      ? params.current.metacritic
      : { attempts: 0, lastTriedAt: null, nextTryAt: null, permanentMiss: false }
  };
}

function applyRetryState(
  payload: Record<string, unknown>,
  state: DiscoveryEnrichmentRetryState
): void {
  const shouldKeepHltb = hasMeaningfulRetryState(state.hltb);
  const shouldKeepMetacritic = hasMeaningfulRetryState(state.metacritic);

  if (!shouldKeepHltb && !shouldKeepMetacritic) {
    delete payload.enrichmentRetry;
    return;
  }

  payload.enrichmentRetry = {
    ...(shouldKeepHltb ? { hltb: state.hltb } : {}),
    ...(shouldKeepMetacritic ? { metacritic: state.metacritic } : {})
  };
}

function hasMeaningfulRetryState(state: ProviderRetryState): boolean {
  return state.attempts > 0 || state.permanentMiss || state.nextTryAt !== null;
}

function maybeRearmProviderRetryState(params: {
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

  return {
    attempts: 0,
    lastTriedAt: null,
    nextTryAt: null,
    permanentMiss: false
  };
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
