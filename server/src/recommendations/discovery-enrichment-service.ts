import { RecommendationRepository } from './repository.js';
import type { QueryResult, QueryResultRow } from 'pg';
import {
  DISCOVERY_ENRICHMENT_REARM_AFTER_DAYS_DEFAULT,
  DISCOVERY_ENRICHMENT_REARM_RECENT_RELEASE_YEARS_DEFAULT,
} from './discovery-enrichment-defaults.js';
import type { IgdbMetadataRecord } from '../metadata-enrichment/types.js';
import { isProviderMatchLocked } from '../provider-match-lock.js';
import { buildGameKey } from './semantic.js';

const ENRICHMENT_LOCK_NAMESPACE = 77321;
const ENRICHMENT_LOCK_KEY = 1;
const WINDOWS_IGDB_PLATFORM_ID = 6;

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
  rearmAfterDays?: number;
  rearmRecentReleaseYears?: number;
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

interface SteamMetadataClient {
  fetchGameMetadataByIds(gameIds: string[]): Promise<Map<string, IgdbMetadataRecord>>;
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
  steam: ProviderRetryState;
}

type DiscoveryEnrichmentProvider = 'hltb' | 'review' | 'steam';

interface HltbLookupContext {
  title: string;
  releaseYear: number | null;
  platform: string | null;
  preferredGameId: number | null;
  preferredUrl: string | null;
  canRefreshLocked: boolean;
}

interface ReviewLookupContext {
  reviewSource: 'metacritic' | 'mobygames' | null;
  title: string;
  releaseYear: number | null;
  platform: string | null;
  platformIgdbId: number;
  mobygamesGameId: number | null;
  canRefreshLocked: boolean;
}

interface MobyGamesResponse {
  games?: Array<Record<string, unknown>>;
}

interface ReviewLookupResult {
  reviewSource: 'metacritic' | 'mobygames';
  reviewScore: number | null;
  reviewUrl: string | null;
  mobygamesGameId: number | null;
  mobyScore: number | null;
}

export class DiscoveryEnrichmentService {
  private intervalHandle: NodeJS.Timeout | null = null;
  private startupTimeoutHandle: NodeJS.Timeout | null = null;
  private readonly steamMetadataClient: SteamMetadataClient | null;

  constructor(
    private readonly repository: RecommendationRepository,
    private readonly options: DiscoveryEnrichmentServiceOptions,
    private readonly now: () => number = () => Date.now(),
    steamMetadataClient: SteamMetadataClient | null = null
  ) {
    this.steamMetadataClient = steamMetadataClient;
  }

  start(): void {
    if (!this.options.enabled || this.intervalHandle) {
      return;
    }

    this.startupTimeoutHandle = setTimeout(
      () => {
        this.startupTimeoutHandle = null;
        void this.runOnce().catch((error: unknown) => {
          console.warn('[recommendations.discovery_enrichment] startup_run_failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        });
      },
      Math.max(0, this.options.startupDelayMs)
    );

    this.intervalHandle = setInterval(
      () => {
        void this.runOnce().catch((error: unknown) => {
          console.warn('[recommendations.discovery_enrichment] interval_run_failed', {
            message: error instanceof Error ? error.message : String(error),
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
          queryable: client,
        }),
    });

    if (!lock.acquired) {
      return null;
    }

    console.info('[recommendations.discovery_enrichment] completed', {
      ...lock.value,
      completedAt: new Date(this.now()).toISOString(),
    });
    return lock.value;
  }

  async enrichNow(params?: {
    limit?: number;
    queryable?: Queryable;
    gameKeys?: string[];
    providers?: DiscoveryEnrichmentProvider[];
    forceLockedProviders?: DiscoveryEnrichmentProvider[];
  }): Promise<DiscoveryEnrichmentSummary> {
    if (!this.options.enabled) {
      return {
        scanned: 0,
        updated: 0,
        skipped: 0,
      };
    }

    const queryable = params?.queryable;
    const normalizedGameKeys = this.normalizeGameKeys(params?.gameKeys);
    const normalizedProviders = normalizeTargetProviders(params?.providers);
    const forcedLockedProviders =
      normalizeTargetProviders(params?.forceLockedProviders) ?? new Set();
    const rows =
      normalizedGameKeys !== null
        ? await this.repository.listDiscoveryRowsByGameKeys(normalizedGameKeys, queryable)
        : await this.repository.listDiscoveryRowsMissingEnrichment(
            params?.limit ?? this.options.maxGamesPerRun,
            queryable,
            {
              nowIso: new Date(this.now()).toISOString(),
              maxAttempts: this.options.maxAttempts,
              rearmAfterDays: this.getRearmAfterDays(),
              rearmRecentReleaseYears: this.getRearmRecentReleaseYears(),
            }
          );

    let updated = 0;
    let skipped = 0;
    for (const row of rows) {
      const next = await this.enrichPayload(row.igdbGameId, row.payload, row.platformIgdbId, {
        providers: normalizedProviders,
        forceLockedProviders: forcedLockedProviders,
      });
      if (!next || JSON.stringify(next) === JSON.stringify(row.payload)) {
        skipped += 1;
        continue;
      }

      await this.repository.updateGamePayload({
        client: queryable,
        igdbGameId: row.igdbGameId,
        platformIgdbId: row.platformIgdbId,
        payload: next,
      });
      updated += 1;
    }

    return { scanned: rows.length, updated, skipped };
  }

  private normalizeGameKeys(value: string[] | undefined): string[] | null {
    if (!Array.isArray(value)) {
      return null;
    }

    const normalized = [...new Set(value.map((key) => key.trim()).filter((key) => key.length > 0))];
    if (normalized.length === 0) {
      return null;
    }

    return normalized.filter((key) => {
      const separatorIndex = key.lastIndexOf('::');
      if (separatorIndex <= 0) {
        return false;
      }
      const igdbGameId = key.slice(0, separatorIndex).trim();
      const platformRaw = key.slice(separatorIndex + 2).trim();
      if (igdbGameId.length === 0 || !/^\d+$/.test(platformRaw)) {
        return false;
      }
      return buildGameKey(igdbGameId, Number.parseInt(platformRaw, 10)) === key;
    });
  }

  private async enrichPayload(
    igdbGameId: string,
    payload: Record<string, unknown>,
    platformIgdbId: number,
    options: {
      providers: Set<DiscoveryEnrichmentProvider> | null;
      forceLockedProviders: Set<DiscoveryEnrichmentProvider>;
    }
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
    const isHltbActive = options.providers === null || options.providers.has('hltb');
    const isReviewActive = options.providers === null || options.providers.has('review');
    const isSteamActive = options.providers === null || options.providers.has('steam');
    const hltbMatchLocked = isProviderMatchLocked(payload, 'hltbMatchLocked');
    const hltbLookup = buildHltbLookupContext(
      payload,
      title,
      releaseYear,
      platform,
      hltbMatchLocked
    );
    const reviewMatchLocked = isProviderMatchLocked(payload, 'reviewMatchLocked');
    const reviewLookup = buildReviewLookupContext(
      payload,
      title,
      releaseYear,
      platform,
      platformIgdbId,
      options.forceLockedProviders.has('review')
    );
    const hasHltb =
      hasPositiveNumber(payload.hltbMainHours) ||
      hasPositiveNumber(payload.hltbMainExtraHours) ||
      hasPositiveNumber(payload.hltbCompletionistHours);
    const reviewSource = reviewLookup.reviewSource;
    const hasCritic =
      hasProviderReviewScore(payload.reviewScore, reviewSource) ||
      hasPositiveNumber(payload.metacriticScore);
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
        maxAttempts: this.options.maxAttempts,
      }),
      metacritic: maybeRearmProviderRetryState({
        state: retryState.metacritic,
        nowMs,
        releaseYear,
        rearmAfterDays,
        rearmRecentReleaseYears,
        maxAttempts: this.options.maxAttempts,
      }),
      steam: maybeRearmProviderRetryState({
        state: retryState.steam,
        nowMs,
        releaseYear,
        rearmAfterDays,
        rearmRecentReleaseYears,
        maxAttempts: this.options.maxAttempts,
      }),
    };
    const needsHltb = isHltbActive && !hasHltb && (!hltbMatchLocked || hltbLookup.canRefreshLocked);
    const needsMetacritic =
      isReviewActive && !hasCritic && (!reviewMatchLocked || reviewLookup.canRefreshLocked);
    const shouldTryHltb =
      needsHltb &&
      shouldAttemptProvider({
        state: nextRetryStateBase.hltb,
        nowMs,
        maxAttempts: this.options.maxAttempts,
      });
    const shouldTryMetacritic =
      needsMetacritic &&
      shouldAttemptProvider({
        state: nextRetryStateBase.metacritic,
        nowMs,
        maxAttempts: this.options.maxAttempts,
      });
    const steamNeedsEnrichment =
      isSteamActive &&
      platformIgdbId === WINDOWS_IGDB_PLATFORM_ID &&
      isBlankValue(payload['steamEnrichedAt']) &&
      isStrictPositiveIntegerString(igdbGameId);
    const shouldTrySteam =
      this.steamMetadataClient !== null &&
      steamNeedsEnrichment &&
      shouldAttemptProvider({
        state: nextRetryStateBase.steam,
        nowMs,
        maxAttempts: this.options.maxAttempts,
      });

    if (!shouldTryHltb && !shouldTryMetacritic && !shouldTrySteam) {
      const next = { ...payload };
      const nextRetryState = buildNextRetryState({
        current: nextRetryStateBase,
        activeHltb: isHltbActive,
        activeMetacritic: isReviewActive,
        activeSteam: isSteamActive,
        needsHltb,
        needsMetacritic,
        needsSteam: steamNeedsEnrichment,
      });
      applyRetryState(next, nextRetryState);
      return next;
    }

    const [hltbResponse, metacriticResponse] = await Promise.all([
      shouldTryHltb
        ? this.fetchJson<HltbResponse>(
            this.buildLocalUrl('/v1/hltb/search', {
              q: hltbLookup.title,
              ...(hltbLookup.releaseYear ? { releaseYear: String(hltbLookup.releaseYear) } : {}),
              ...(hltbLookup.platform ? { platform: hltbLookup.platform } : {}),
              ...(hltbLookup.preferredGameId
                ? { preferredHltbGameId: String(hltbLookup.preferredGameId) }
                : {}),
              ...(hltbLookup.preferredUrl ? { preferredHltbUrl: hltbLookup.preferredUrl } : {}),
            })
          )
        : Promise.resolve(null),
      shouldTryMetacritic ? this.fetchReviewPayload(reviewLookup) : Promise.resolve(null),
    ]);

    const next: Record<string, unknown> = { ...payload };
    const nextRetryState: DiscoveryEnrichmentRetryState = {
      hltb: nextRetryStateBase.hltb,
      metacritic: nextRetryStateBase.metacritic,
      steam: nextRetryStateBase.steam,
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
        backoffMaxHours: this.options.backoffMaxHours,
      });
    }

    const critic = metacriticResponse?.ok ? (metacriticResponse.value ?? null) : null;
    let foundCritic = hasCritic;
    if (critic?.reviewSource === 'metacritic' && typeof critic.reviewScore === 'number') {
      next.reviewSource = 'metacritic';
      next.reviewScore = round2(critic.reviewScore);
      next.metacriticScore = round2(critic.reviewScore);
      foundCritic = critic.reviewScore > 0;
      if (typeof critic.reviewUrl === 'string' && critic.reviewUrl.trim().length > 0) {
        next.metacriticUrl = critic.reviewUrl.trim();
        next.reviewUrl = critic.reviewUrl.trim();
      }
    }
    if (critic?.reviewSource === 'mobygames') {
      if (typeof critic.reviewScore === 'number' && critic.reviewScore > 0) {
        next.reviewSource = 'mobygames';
        next.reviewScore = round2(critic.reviewScore);
        foundCritic = true;
      }
      if (typeof critic.mobyScore === 'number' && critic.mobyScore > 0) {
        next.mobyScore = round2(critic.mobyScore);
      }
      if (
        typeof critic.mobygamesGameId === 'number' &&
        Number.isInteger(critic.mobygamesGameId) &&
        critic.mobygamesGameId > 0
      ) {
        next.mobygamesGameId = critic.mobygamesGameId;
      }
      if (typeof critic.reviewUrl === 'string' && critic.reviewUrl.trim().length > 0) {
        next.reviewUrl = critic.reviewUrl.trim();
      }
    }
    if (shouldTryMetacritic && metacriticResponse?.ok) {
      nextRetryState.metacritic = nextProviderRetryState({
        current: nextRetryStateBase.metacritic,
        nowIso,
        success: foundCritic,
        maxAttempts: this.options.maxAttempts,
        backoffBaseMinutes: this.options.backoffBaseMinutes,
        backoffMaxHours: this.options.backoffMaxHours,
      });
    }

    if (shouldTrySteam) {
      const steamSucceeded = await this.applySteamEnrichment({
        igdbGameId,
        next,
        nowIso,
      });
      nextRetryState.steam = nextProviderRetryState({
        current: nextRetryStateBase.steam,
        nowIso,
        success: steamSucceeded,
        maxAttempts: this.options.maxAttempts,
        backoffBaseMinutes: this.options.backoffBaseMinutes,
        backoffMaxHours: this.options.backoffMaxHours,
      });
    }

    applyRetryState(
      next,
      buildNextRetryState({
        current: nextRetryState,
        activeHltb: isHltbActive,
        activeMetacritic: isReviewActive,
        activeSteam: isSteamActive,
        needsHltb: !foundHltb && (!hltbMatchLocked || hltbLookup.canRefreshLocked),
        needsMetacritic: !foundCritic && (!reviewMatchLocked || reviewLookup.canRefreshLocked),
        needsSteam: steamNeedsEnrichment,
      })
    );

    return next;
  }

  private async applySteamEnrichment(params: {
    igdbGameId: string;
    next: Record<string, unknown>;
    nowIso: string;
  }): Promise<boolean> {
    if (!this.steamMetadataClient) {
      return false;
    }

    try {
      const metadata = await this.steamMetadataClient.fetchGameMetadataByIds([params.igdbGameId]);
      const record = metadata.get(params.igdbGameId);
      const hasSteamAppId = typeof record?.steamAppId === 'number' && record.steamAppId > 0;
      if (hasSteamAppId) {
        params.next.steamAppId = record.steamAppId;
      }
      params.next.steamEnrichmentStatus = hasSteamAppId ? 'success' : 'no_data';
      params.next.steamEnrichedAt = params.nowIso;
      return true;
    } catch {
      // Keep steam marker unset and rely on retry state for due-based retries.
      return false;
    }
  }

  private buildLocalUrl(path: string, query: Record<string, string>): string {
    const url = new URL(path, this.options.apiBaseUrl);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private getRearmAfterDays(): number {
    const raw = this.options.rearmAfterDays;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Math.max(1, Math.trunc(raw));
    }
    return DISCOVERY_ENRICHMENT_REARM_AFTER_DAYS_DEFAULT;
  }

  private getRearmRecentReleaseYears(): number {
    const raw = this.options.rearmRecentReleaseYears;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Math.max(1, Math.trunc(raw));
    }
    return DISCOVERY_ENRICHMENT_REARM_RECENT_RELEASE_YEARS_DEFAULT;
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
          'x-gameshelf-discovery-enrichment': '1',
        },
        signal: controller.signal,
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

  private async fetchReviewPayload(
    params: ReviewLookupContext
  ): Promise<FetchJsonResult<ReviewLookupResult>> {
    if (params.reviewSource === 'mobygames' && params.mobygamesGameId !== null) {
      const response = await this.fetchJson<MobyGamesResponse>(
        this.buildLocalUrl('/v1/mobygames/search', {
          q: params.title,
          id: String(params.mobygamesGameId),
          limit: '5',
          format: 'normal',
          include: 'game_id,moby_url,moby_score,critic_score',
        })
      );

      if (!response.ok) {
        return { ok: false, value: null };
      }

      return {
        ok: true,
        value: normalizeMobyGamesReviewResult(response.value, params.mobygamesGameId),
      };
    }

    const response = await this.fetchJson<MetacriticResponse>(
      this.buildLocalUrl('/v1/metacritic/search', {
        q: params.title,
        ...(params.releaseYear ? { releaseYear: String(params.releaseYear) } : {}),
        ...(params.platform ? { platform: params.platform } : {}),
        platformIgdbId: String(params.platformIgdbId),
      })
    );

    if (!response.ok) {
      return { ok: false, value: null };
    }

    const item = response.value?.item ?? null;
    const score =
      item && typeof item.metacriticScore === 'number' && item.metacriticScore > 0
        ? round2(item.metacriticScore)
        : null;
    const url = normalizeTrimmedString(item?.metacriticUrl);

    if (score === null && url === null) {
      return { ok: true, value: null };
    }

    return {
      ok: true,
      value: {
        reviewSource: 'metacritic',
        reviewScore: score,
        reviewUrl: url,
        mobygamesGameId: null,
        mobyScore: null,
      },
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function hasPositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeTargetProviders(
  value: DiscoveryEnrichmentProvider[] | undefined
): Set<DiscoveryEnrichmentProvider> | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const providers = [...new Set(value)];

  return providers.length > 0 ? new Set(providers) : null;
}

function buildHltbLookupContext(
  payload: Record<string, unknown>,
  fallbackTitle: string,
  fallbackReleaseYear: number | null,
  fallbackPlatform: string | null,
  hltbMatchLocked: boolean
): HltbLookupContext {
  const title = normalizeTrimmedString(payload['hltbMatchQueryTitle']) ?? fallbackTitle;
  const releaseYear =
    normalizePositiveInteger(payload['hltbMatchQueryReleaseYear']) ?? fallbackReleaseYear;
  const platform = normalizeTrimmedString(payload['hltbMatchQueryPlatform']) ?? fallbackPlatform;
  const preferredGameId = hltbMatchLocked
    ? normalizePositiveInteger(payload['hltbMatchGameId'])
    : null;
  const preferredUrl = hltbMatchLocked ? normalizeTrimmedString(payload['hltbMatchUrl']) : null;

  return {
    title,
    releaseYear,
    platform,
    preferredGameId,
    preferredUrl,
    canRefreshLocked: preferredGameId !== null || preferredUrl !== null,
  };
}

function buildReviewLookupContext(
  payload: Record<string, unknown>,
  fallbackTitle: string,
  fallbackReleaseYear: number | null,
  fallbackPlatform: string | null,
  fallbackPlatformIgdbId: number,
  forceLockedReviewRefresh: boolean
): ReviewLookupContext {
  const reviewSource = parseReviewSource(payload['reviewSource']);
  const title = normalizeTrimmedString(payload['reviewMatchQueryTitle']) ?? fallbackTitle;
  const releaseYear =
    normalizePositiveInteger(payload['reviewMatchQueryReleaseYear']) ?? fallbackReleaseYear;
  const platform = normalizeTrimmedString(payload['reviewMatchQueryPlatform']) ?? fallbackPlatform;
  const platformIgdbId =
    normalizePositiveInteger(payload['reviewMatchPlatformIgdbId']) ?? fallbackPlatformIgdbId;
  const mobygamesGameId =
    normalizePositiveInteger(payload['reviewMatchMobygamesGameId']) ??
    (reviewSource === 'mobygames' ? normalizePositiveInteger(payload['mobygamesGameId']) : null);

  return {
    reviewSource,
    title,
    releaseYear,
    platform,
    platformIgdbId,
    mobygamesGameId,
    canRefreshLocked:
      forceLockedReviewRefresh &&
      ((reviewSource !== 'mobygames' && title.length >= 2) || mobygamesGameId !== null),
  };
}

function normalizeFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeMobyGamesReviewResult(
  value: MobyGamesResponse | null,
  expectedGameId: number
): ReviewLookupResult | null {
  const games = Array.isArray(value?.games) ? value.games : [];
  const matched = games.find(
    (entry) => normalizePositiveInteger(entry['game_id']) === expectedGameId
  );

  if (!matched) {
    return null;
  }

  const mobyScore = normalizeFiniteNumber(matched['moby_score']);
  const criticScore = normalizeFiniteNumber(matched['critic_score']);
  const reviewScore = criticScore ?? (mobyScore !== null && mobyScore > 0 ? mobyScore * 10 : null);
  const reviewUrl = normalizeTrimmedString(matched['moby_url']);

  if (reviewScore === null && reviewUrl === null) {
    return null;
  }

  return {
    reviewSource: 'mobygames',
    reviewScore: reviewScore !== null ? round2(reviewScore) : null,
    reviewUrl,
    mobygamesGameId: expectedGameId,
    mobyScore: mobyScore !== null ? round2(mobyScore) : null,
  };
}

function isBlankValue(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

function parseReviewSource(value: unknown): 'metacritic' | 'mobygames' | null {
  if (value === 'metacritic' || value === 'mobygames') {
    return value;
  }
  return null;
}

function isStrictPositiveIntegerString(value: string): boolean {
  return /^[1-9]\d*$/.test(value.trim());
}

function hasProviderReviewScore(
  reviewScore: unknown,
  reviewSource: 'metacritic' | 'mobygames' | null
): boolean {
  return reviewSource !== null && hasPositiveNumber(reviewScore);
}

function parseRetryState(value: unknown): DiscoveryEnrichmentRetryState {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    hltb: parseProviderRetryState(source.hltb),
    metacritic: parseProviderRetryState(source.metacritic),
    steam: parseProviderRetryState(source.steam),
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

function buildNextRetryState(params: {
  current: DiscoveryEnrichmentRetryState;
  activeHltb: boolean;
  activeMetacritic: boolean;
  activeSteam: boolean;
  needsHltb: boolean;
  needsMetacritic: boolean;
  needsSteam: boolean;
}): DiscoveryEnrichmentRetryState {
  return {
    hltb: !params.activeHltb
      ? params.current.hltb
      : params.needsHltb
        ? params.current.hltb
        : { attempts: 0, lastTriedAt: null, nextTryAt: null, permanentMiss: false },
    metacritic: !params.activeMetacritic
      ? params.current.metacritic
      : params.needsMetacritic
        ? params.current.metacritic
        : { attempts: 0, lastTriedAt: null, nextTryAt: null, permanentMiss: false },
    steam: !params.activeSteam
      ? params.current.steam
      : params.needsSteam
        ? params.current.steam
        : { attempts: 0, lastTriedAt: null, nextTryAt: null, permanentMiss: false },
  };
}

function applyRetryState(
  payload: Record<string, unknown>,
  state: DiscoveryEnrichmentRetryState
): void {
  const shouldKeepHltb = hasMeaningfulRetryState(state.hltb);
  const shouldKeepMetacritic = hasMeaningfulRetryState(state.metacritic);
  const shouldKeepSteam = hasMeaningfulRetryState(state.steam);

  if (!shouldKeepHltb && !shouldKeepMetacritic && !shouldKeepSteam) {
    delete payload.enrichmentRetry;
    return;
  }

  payload.enrichmentRetry = {
    ...(shouldKeepHltb ? { hltb: state.hltb } : {}),
    ...(shouldKeepMetacritic ? { metacritic: state.metacritic } : {}),
    ...(shouldKeepSteam ? { steam: state.steam } : {}),
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
    permanentMiss: false,
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
