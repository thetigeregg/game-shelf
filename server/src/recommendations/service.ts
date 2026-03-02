import { createHash } from 'node:crypto';
import { selectCandidates } from './candidates.js';
import { buildExplanation } from './explanations.js';
import { normalizeTokenKey } from './normalize.js';
import { buildPreferenceProfile } from './profile.js';
import { RecommendationRepository } from './repository.js';
import { buildRankedScores } from './score.js';
import { buildSimilarityGraph } from './similarity.js';
import {
  NormalizedGameRecord,
  RankedRecommendationItem,
  RebuildResult,
  RecommendationRunSummary,
  RecommendationTarget,
  SimilarityReasons
} from './types.js';

export interface RecommendationServiceOptions {
  topLimit: number;
  similarityK: number;
  staleHours: number;
}

export type RebuildAttemptResult =
  | RebuildResult
  | { target: RecommendationTarget; status: 'LOCKED' };

export interface RecommendationServiceApi {
  rebuild(params: {
    target: RecommendationTarget;
    force?: boolean;
    triggeredBy?: 'manual' | 'scheduler' | 'stale-read';
  }): Promise<RebuildAttemptResult>;
  rebuildIfStale(
    target: RecommendationTarget,
    triggeredBy: 'scheduler' | 'stale-read'
  ): Promise<RebuildAttemptResult | null>;
  getTopRecommendations(
    target: RecommendationTarget,
    limit: number
  ): Promise<{ run: RecommendationRunSummary; items: RankedRecommendationItem[] } | null>;
  getSimilarGames(params: { igdbGameId: string; platformIgdbId: number; limit: number }): Promise<
    Array<{
      igdbGameId: string;
      platformIgdbId: number;
      similarity: number;
      reasons: SimilarityReasons;
    }>
  >;
}

export class RecommendationService implements RecommendationServiceApi {
  constructor(
    private readonly repository: RecommendationRepository,
    private readonly options: RecommendationServiceOptions
  ) {}

  async rebuild(params: {
    target: RecommendationTarget;
    force?: boolean;
    triggeredBy?: 'manual' | 'scheduler' | 'stale-read';
  }): Promise<RebuildAttemptResult> {
    const force = params.force === true;
    const triggeredBy = params.triggeredBy ?? 'manual';

    const locked = await this.repository.withTargetLock(params.target, async (client) => {
      const games = await this.repository.listNormalizedGames(client);
      const settingsHash = this.computeSettingsHash();
      const inputHash = this.computeInputHash(games, params.target);
      const latestSuccess = await this.repository.getLatestSuccessfulRun(params.target, client);

      if (
        latestSuccess &&
        !force &&
        latestSuccess.settingsHash === settingsHash &&
        latestSuccess.inputHash === inputHash
      ) {
        return {
          target: params.target,
          runId: latestSuccess.id,
          status: 'SKIPPED' as const,
          reusedRunId: latestSuccess.id
        };
      }

      const runId = await this.repository.createRun({
        client,
        target: params.target,
        settingsHash,
        inputHash,
        triggeredBy
      });

      try {
        const items = this.buildRecommendations(games, params.target);
        const similarityEdges = buildSimilarityGraph(games, this.options.similarityK);

        await this.repository.finalizeRunSuccess({
          client,
          runId,
          recommendations: items,
          similarityEdges
        });

        return {
          target: params.target,
          runId,
          status: 'SUCCESS' as const
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown recommendation error.';
        await this.repository.markRunFailed({
          client,
          runId,
          errorMessage
        });

        return {
          target: params.target,
          runId,
          status: 'FAILED' as const
        };
      }
    });

    if (!locked.acquired) {
      return {
        target: params.target,
        status: 'LOCKED'
      };
    }

    return locked.value;
  }

  async rebuildIfStale(
    target: RecommendationTarget,
    triggeredBy: 'scheduler' | 'stale-read'
  ): Promise<RebuildAttemptResult | null> {
    const latest = await this.repository.getLatestSuccessfulRun(target);

    if (latest && !this.isStale(latest)) {
      return null;
    }

    return this.rebuild({
      target,
      force: false,
      triggeredBy
    });
  }

  async getTopRecommendations(
    target: RecommendationTarget,
    limit: number
  ): Promise<{ run: RecommendationRunSummary; items: RankedRecommendationItem[] } | null> {
    const safeLimit = normalizeLimit(limit, this.options.topLimit);
    return this.repository.readTopRecommendations({
      target,
      limit: safeLimit
    });
  }

  async getSimilarGames(params: {
    igdbGameId: string;
    platformIgdbId: number;
    limit: number;
  }): Promise<
    Array<{
      igdbGameId: string;
      platformIgdbId: number;
      similarity: number;
      reasons: SimilarityReasons;
    }>
  > {
    const safeLimit = normalizeLimit(params.limit, 50);
    const rows = await this.repository.readSimilarGames({
      igdbGameId: params.igdbGameId,
      platformIgdbId: params.platformIgdbId,
      limit: safeLimit
    });

    return rows.map((row) => ({
      igdbGameId: row.igdbGameId,
      platformIgdbId: row.platformIgdbId,
      similarity: row.similarity,
      reasons: row.reasons
    }));
  }

  private computeSettingsHash(): string {
    return sha256({
      topLimit: this.options.topLimit,
      similarityK: this.options.similarityK,
      staleHours: this.options.staleHours,
      modelVersion: 'recommendation-v1'
    });
  }

  private computeInputHash(games: NormalizedGameRecord[], target: RecommendationTarget): string {
    const material = games
      .map((game) => ({
        igdbGameId: game.igdbGameId,
        platformIgdbId: game.platformIgdbId,
        listType: game.listType,
        status: game.status,
        rating: game.rating,
        createdAt: game.createdAt,
        updatedAt: game.updatedAt,
        releaseYear: game.releaseYear,
        reviewScore: game.reviewScore,
        reviewSource: game.reviewSource,
        metacriticScore: game.metacriticScore,
        mobyScore: game.mobyScore,
        genres: [...game.genres].sort(),
        developers: [...game.developers].sort(),
        publishers: [...game.publishers].sort(),
        franchises: [...game.franchises].sort(),
        collections: [...game.collections].sort()
      }))
      .sort((left, right) => {
        if (left.igdbGameId !== right.igdbGameId) {
          return left.igdbGameId < right.igdbGameId ? -1 : 1;
        }

        return left.platformIgdbId - right.platformIgdbId;
      });

    return sha256({
      target,
      material
    });
  }

  private buildRecommendations(
    games: NormalizedGameRecord[],
    target: RecommendationTarget
  ): RankedRecommendationItem[] {
    const profile = buildPreferenceProfile(games);
    const candidates = selectCandidates(games, target);
    const ranked = buildRankedScores({
      candidates,
      target,
      profile,
      limit: this.options.topLimit
    });

    return ranked.map((item, index) => ({
      igdbGameId: item.game.igdbGameId,
      platformIgdbId: item.game.platformIgdbId,
      rank: index + 1,
      scoreTotal: item.total,
      scoreComponents: item.components,
      explanations: buildExplanation({
        components: item.components,
        tasteMatches: item.tasteMatches
      })
    }));
  }

  private isStale(run: RecommendationRunSummary): boolean {
    const timestamp = Date.parse(run.finishedAt ?? run.startedAt);

    if (!Number.isFinite(timestamp)) {
      return true;
    }

    const staleMs = this.options.staleHours * 60 * 60 * 1000;
    return Date.now() - timestamp >= staleMs;
  }
}

function normalizeLimit(value: number, max: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    return Math.min(20, max);
  }

  return Math.min(value, max);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function parseRecommendationTarget(value: unknown): RecommendationTarget | null {
  if (value === 'BACKLOG' || value === 'WISHLIST') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = normalizeTokenKey(value).toUpperCase();
    if (normalized === 'BACKLOG' || normalized === 'WISHLIST') {
      return normalized as RecommendationTarget;
    }
  }

  return null;
}
