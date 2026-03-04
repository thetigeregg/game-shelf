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
      queryable
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

    const [hltbResponse, metacriticResponse] = await Promise.all([
      this.fetchJson<HltbResponse>(
        this.buildLocalUrl('/v1/hltb/search', {
          q: title,
          ...(releaseYear ? { releaseYear: String(releaseYear) } : {}),
          ...(platform ? { platform } : {})
        })
      ),
      this.fetchJson<MetacriticResponse>(
        this.buildLocalUrl('/v1/metacritic/search', {
          q: title,
          ...(releaseYear ? { releaseYear: String(releaseYear) } : {}),
          ...(platform ? { platform } : {}),
          platformIgdbId: String(platformIgdbId)
        })
      )
    ]);

    const next: Record<string, unknown> = { ...payload };
    const hltbItem = hltbResponse?.item ?? null;
    if (hltbItem) {
      if (typeof hltbItem.hltbMainHours === 'number' && hltbItem.hltbMainHours > 0) {
        next.hltbMainHours = round2(hltbItem.hltbMainHours);
      }
      if (typeof hltbItem.hltbMainExtraHours === 'number' && hltbItem.hltbMainExtraHours > 0) {
        next.hltbMainExtraHours = round2(hltbItem.hltbMainExtraHours);
      }
      if (
        typeof hltbItem.hltbCompletionistHours === 'number' &&
        hltbItem.hltbCompletionistHours > 0
      ) {
        next.hltbCompletionistHours = round2(hltbItem.hltbCompletionistHours);
      }
    }

    const critic = metacriticResponse?.item ?? null;
    if (critic && typeof critic.metacriticScore === 'number' && critic.metacriticScore > 0) {
      next.reviewSource = 'metacritic';
      next.reviewScore = round2(critic.metacriticScore);
      next.metacriticScore = round2(critic.metacriticScore);
      if (typeof critic.metacriticUrl === 'string' && critic.metacriticUrl.trim().length > 0) {
        next.metacriticUrl = critic.metacriticUrl.trim();
        next.reviewUrl = critic.metacriticUrl.trim();
      }
    }

    return next;
  }

  private buildLocalUrl(path: string, query: Record<string, string>): string {
    const url = new URL(path, this.options.apiBaseUrl);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
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
        return null;
      }
      return (await response.json()) as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
