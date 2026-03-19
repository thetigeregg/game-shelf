import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { selectCandidates } from './candidates.js';
import { buildEmbeddingText } from './embedding-text.js';
import { EmbeddingClient, OpenAiEmbeddingClient } from './embedding-client.js';
import { buildExplanation } from './explanations.js';
import { buildRecommendationLanes } from './lanes.js';
import { buildKeywordSelection } from './keyword-stats.js';
import { prepareKeywords } from './keywords.js';
import { normalizeTokenKey } from './normalize.js';
import { buildPreferenceProfile } from './profile.js';
import { EmbeddingRepository } from './embedding-repository.js';
import { DiscoveryCandidateRecord, DiscoveryIgdbClient } from './discovery-igdb-client.js';
import { DiscoveryEnrichmentService } from './discovery-enrichment-service.js';
import { RecommendationRepository } from './repository.js';
import { parseRecommendationRuntimeMode, RECOMMENDATION_RUNTIME_MODES } from './runtime.js';
import { buildRankedScores } from './score.js';
import {
  buildGameKey,
  buildTasteProfileEmbedding,
  clampSemanticScore,
  cosineSimilarity,
} from './semantic.js';
import { buildSimilarityGraph } from './similarity.js';
import { tuneRecommendationWeights } from './tuning.js';
import {
  GameEmbeddingUpsertInput,
  NormalizedGameRecord,
  RankedRecommendationItem,
  RebuildResult,
  RecommendationRebuildQueueReason,
  RecommendationLaneCollection,
  RecommendationLaneKey,
  RecommendationPageInfo,
  RecommendationRunSummary,
  RecommendationRuntimeMode,
  RecommendationTarget,
  SimilarityReasons,
  StoredGameEmbedding,
  TunedRecommendationWeights,
} from './types.js';

const RANKING_DEDUPE_BUFFER = 25;
const MAX_RECOMMENDATION_PAGE_LIMIT = 50;
const MAX_RECOMMENDATION_PAGE_OFFSET = 1000;

export interface RecommendationServiceOptions {
  topLimit: number;
  laneLimit: number;
  similarityK: number;
  staleHours: number;
  failureBackoffMinutes: number;
  semanticWeight: number;
  similarityStructuredWeight: number;
  similaritySemanticWeight: number;
  embeddingModel: string;
  embeddingDimensions: number;
  embeddingBatchSize: number;
  runtimeModeDefault: RecommendationRuntimeMode;
  explorationWeight: number;
  diversityPenaltyWeight: number;
  repeatPenaltyStep: number;
  tuningMinRated: number;
  keywordsStructuredMax: number;
  keywordsEmbeddingMax: number;
  keywordsGlobalMaxRatio: number;
  keywordsStructuredMaxRatio: number;
  keywordsMinLibraryCount: number;
  keywordsWeight: number;
  themesWeight: number;
  similarityThemeWeight: number;
  similarityGenreWeight: number;
  similaritySeriesWeight: number;
  similarityDeveloperWeight: number;
  similarityPublisherWeight: number;
  similarityKeywordWeight: number;
  discoveryEnabled: boolean;
  discoveryPoolSize: number;
  discoveryRefreshHours: number;
  discoveryPopularRefreshHours: number;
  discoveryRecentRefreshHours: number;
  discoveryIgdbRequestTimeoutMs: number;
  discoveryIgdbMaxRequestsPerSecond: number;
}

export interface RecommendationServiceDependencies {
  embeddingRepository?: EmbeddingRepository;
  embeddingClient?: EmbeddingClient;
  nowProvider?: () => number;
  discoveryClient?: DiscoveryIgdbClient;
  discoveryEnrichmentService?: DiscoveryEnrichmentService;
}

export type RebuildAttemptResult =
  | RebuildResult
  | { target: RecommendationTarget; status: 'LOCKED' }
  | { target: RecommendationTarget; status: 'BACKOFF_SKIPPED' };

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
  ensureRebuildQueuedIfStale(
    target: RecommendationTarget,
    triggeredBy: 'scheduler' | 'stale-read'
  ): Promise<{
    queued: boolean;
    reason: RecommendationRebuildQueueReason | 'fresh';
    jobId: number | null;
  }>;
  enqueueRebuild(params: {
    target: RecommendationTarget;
    force: boolean;
    triggeredBy: 'manual' | 'scheduler' | 'stale-read';
  }): Promise<{ jobId: number; deduped: boolean }>;
  resolveRuntimeMode(
    runtimeMode?: RecommendationRuntimeMode | null
  ): Promise<RecommendationRuntimeMode>;
  getTopRecommendations(
    target: RecommendationTarget,
    limit: number,
    runtimeMode?: RecommendationRuntimeMode | null
  ): Promise<{
    run: RecommendationRunSummary;
    runtimeMode: RecommendationRuntimeMode;
    items: RankedRecommendationItem[];
  } | null>;
  getRecommendationLanes(
    target: RecommendationTarget,
    lane: RecommendationLaneKey,
    offset: number,
    limit: number,
    runtimeMode?: RecommendationRuntimeMode | null
  ): Promise<{
    run: RecommendationRunSummary;
    runtimeMode: RecommendationRuntimeMode;
    lane: RecommendationLaneKey;
    items: RankedRecommendationItem[];
    page: RecommendationPageInfo;
  } | null>;
  getSimilarGames(params: {
    igdbGameId: string;
    platformIgdbId: number;
    target: RecommendationTarget;
    runtimeMode?: RecommendationRuntimeMode | null;
    limit: number;
  }): Promise<{
    runtimeMode: RecommendationRuntimeMode;
    items: Array<{
      igdbGameId: string;
      platformIgdbId: number;
      similarity: number;
      reasons: SimilarityReasons;
    }>;
  }>;
}

export class RecommendationService implements RecommendationServiceApi {
  private readonly embeddingRepository: EmbeddingRepository;
  private readonly embeddingClient: EmbeddingClient;
  private readonly discoveryClient: DiscoveryIgdbClient;
  private readonly discoveryEnrichmentService: DiscoveryEnrichmentService | null;
  private readonly nowProvider: () => number;

  constructor(
    private readonly repository: RecommendationRepository,
    private readonly options: RecommendationServiceOptions,
    dependencies: RecommendationServiceDependencies = {}
  ) {
    this.embeddingRepository =
      dependencies.embeddingRepository ?? new EmbeddingRepository(repository);
    this.embeddingClient =
      dependencies.embeddingClient ??
      new OpenAiEmbeddingClient({
        apiKey: '',
        model: this.options.embeddingModel,
        dimensions: this.options.embeddingDimensions,
      });
    this.nowProvider = dependencies.nowProvider ?? (() => Date.now());
    this.discoveryClient =
      dependencies.discoveryClient ??
      new DiscoveryIgdbClient({
        twitchClientId: '',
        twitchClientSecret: '',
        requestTimeoutMs: this.options.discoveryIgdbRequestTimeoutMs,
        maxRequestsPerSecond: this.options.discoveryIgdbMaxRequestsPerSecond,
      });
    this.discoveryEnrichmentService = dependencies.discoveryEnrichmentService ?? null;
  }

  async rebuild(params: {
    target: RecommendationTarget;
    force?: boolean;
    triggeredBy?: 'manual' | 'scheduler' | 'stale-read';
  }): Promise<RebuildAttemptResult> {
    const force = params.force === true;
    const triggeredBy = params.triggeredBy ?? 'manual';

    const locked = await this.repository.withTargetLock(params.target, async (client) => {
      const latestRun = await this.repository.getLatestRun(params.target, client);

      if (!force && triggeredBy !== 'manual' && this.isFailureBackoffActive(latestRun)) {
        return {
          target: params.target,
          status: 'BACKOFF_SKIPPED' as const,
        };
      }

      let games = await this.repository.listNormalizedGames(client);
      if (params.target === 'DISCOVERY' && this.options.discoveryEnabled) {
        await this.refreshDiscoveryPool({
          client,
          force,
          games,
        });
        games = await this.repository.listNormalizedGames(client);
      }
      const keywordArtifacts = this.buildKeywordArtifacts(games);
      const settingsHash = this.computeSettingsHash();
      const inputHash = this.computeInputHash(games, params.target, keywordArtifacts);
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
          reusedRunId: latestSuccess.id,
        };
      }

      const histories = await this.loadHistoryByMode(params.target, client);

      const runId = await this.repository.createRun({
        client,
        target: params.target,
        settingsHash,
        inputHash,
        triggeredBy,
      });

      try {
        const embeddingsByGame = await this.ensureEmbeddings({
          client,
          games,
          embeddingKeywordsByGame: keywordArtifacts.embeddingKeywordsByGame,
        });
        const semanticSimilarityByGame = this.buildSemanticSimilarityMap({
          games,
          embeddingsByGame,
        });
        const tunedWeights = this.buildTunedWeights(games, semanticSimilarityByGame);
        const recommendationsByMode = this.buildRecommendationsByMode({
          games,
          target: params.target,
          semanticSimilarityByGame,
          tunedWeights,
          histories,
          structuredKeywordsByGame: keywordArtifacts.structuredKeywordsByGame,
        });
        const lanesByMode = this.buildLanesByMode({
          target: params.target,
          games,
          recommendationsByMode,
        });
        const historyUpdates = this.buildHistoryUpdates(params.target, recommendationsByMode);
        const similarityTargets = selectCandidates(games, params.target);
        const similarityEdges = buildSimilarityGraph({
          games,
          sourceGames: games,
          targetGames: similarityTargets,
          topK: this.options.similarityK,
          embeddingsByGame,
          structuredWeight: this.options.similarityStructuredWeight,
          semanticWeight: this.options.similaritySemanticWeight,
          structuredKeywordsByGame: keywordArtifacts.structuredKeywordsByGame,
          structuredFamilyWeight: {
            themes: this.options.similarityThemeWeight,
            genres: this.options.similarityGenreWeight,
            series: this.options.similaritySeriesWeight,
            developers: this.options.similarityDeveloperWeight,
            publishers: this.options.similarityPublisherWeight,
            keywords: this.options.similarityKeywordWeight,
          },
        });
        await this.repository.finalizeRunSuccess({
          client,
          runId,
          target: params.target,
          recommendationsByMode,
          lanesByMode,
          historyUpdates,
          similarityEdges,
        });

        return {
          target: params.target,
          runId,
          status: 'SUCCESS' as const,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown recommendation error.';
        await this.repository.markRunFailed({
          client,
          runId,
          errorMessage,
        });

        return {
          target: params.target,
          runId,
          status: 'FAILED' as const,
        };
      }
    });

    if (!locked.acquired) {
      return {
        target: params.target,
        status: 'LOCKED',
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
      triggeredBy,
    });
  }

  async ensureRebuildQueuedIfStale(
    target: RecommendationTarget,
    triggeredBy: 'scheduler' | 'stale-read'
  ): Promise<{
    queued: boolean;
    reason: RecommendationRebuildQueueReason | 'fresh';
    jobId: number | null;
  }> {
    const latest = await this.repository.getLatestSuccessfulRun(target);

    if (latest && !this.isStale(latest)) {
      return { queued: false, reason: 'fresh', jobId: null };
    }

    const reason: RecommendationRebuildQueueReason = latest ? 'stale' : 'missing';
    const queued = await this.repository.enqueueRecommendationRebuildJob({
      target,
      force: false,
      triggeredBy,
      reason,
    });
    return {
      queued: true,
      reason,
      jobId: queued.jobId,
    };
  }

  async enqueueRebuild(params: {
    target: RecommendationTarget;
    force: boolean;
    triggeredBy: 'manual' | 'scheduler' | 'stale-read';
  }): Promise<{ jobId: number; deduped: boolean }> {
    return this.repository.enqueueRecommendationRebuildJob({
      target: params.target,
      force: params.force,
      triggeredBy: params.triggeredBy,
      reason: params.force ? 'forced' : 'stale',
    });
  }

  async resolveRuntimeMode(
    runtimeMode?: RecommendationRuntimeMode | null
  ): Promise<RecommendationRuntimeMode> {
    if (runtimeMode) {
      return runtimeMode;
    }

    const fromSettings = await this.repository.getRuntimeModeDefault();
    if (fromSettings) {
      return fromSettings;
    }

    return this.options.runtimeModeDefault;
  }

  async getTopRecommendations(
    target: RecommendationTarget,
    limit: number,
    runtimeMode?: RecommendationRuntimeMode | null
  ): Promise<{
    run: RecommendationRunSummary;
    runtimeMode: RecommendationRuntimeMode;
    items: RankedRecommendationItem[];
  } | null> {
    const resolvedRuntimeMode = await this.resolveRuntimeMode(runtimeMode);
    const safeLimit = normalizeLimit(limit, this.options.topLimit);
    const result = await this.repository.readTopRecommendations({
      target,
      runtimeMode: resolvedRuntimeMode,
      limit: safeLimit,
    });

    if (!result) {
      return null;
    }

    return {
      ...result,
      runtimeMode: resolvedRuntimeMode,
    };
  }

  async getRecommendationLanes(
    target: RecommendationTarget,
    lane: RecommendationLaneKey,
    offset: number,
    limit: number,
    runtimeMode?: RecommendationRuntimeMode | null
  ): Promise<{
    run: RecommendationRunSummary;
    runtimeMode: RecommendationRuntimeMode;
    lane: RecommendationLaneKey;
    items: RankedRecommendationItem[];
    page: RecommendationPageInfo;
  } | null> {
    const resolvedRuntimeMode = await this.resolveRuntimeMode(runtimeMode);
    const safeLimit = normalizePageLimit(limit, this.options.laneLimit);
    const safeOffset = normalizeOffset(offset);
    const result = await this.repository.readRecommendationLanes({
      target,
      lane,
      runtimeMode: resolvedRuntimeMode,
      offset: safeOffset,
      limit: safeLimit,
    });

    if (!result) {
      return null;
    }

    return {
      ...result,
      runtimeMode: resolvedRuntimeMode,
    };
  }

  async getSimilarGames(params: {
    igdbGameId: string;
    platformIgdbId: number;
    target: RecommendationTarget;
    runtimeMode?: RecommendationRuntimeMode | null;
    limit: number;
  }): Promise<{
    runtimeMode: RecommendationRuntimeMode;
    items: Array<{
      igdbGameId: string;
      platformIgdbId: number;
      similarity: number;
      reasons: SimilarityReasons;
    }>;
  }> {
    const resolvedRuntimeMode = await this.resolveRuntimeMode(params.runtimeMode);
    const safeLimit = normalizeLimit(params.limit, 50);
    const rows = await this.repository.readSimilarGames({
      igdbGameId: params.igdbGameId,
      platformIgdbId: params.platformIgdbId,
      target: params.target,
      runtimeMode: resolvedRuntimeMode,
      limit: safeLimit,
    });
    const dedupedRows = dedupeSimilarRows(rows, safeLimit);

    return {
      runtimeMode: resolvedRuntimeMode,
      items: dedupedRows.map((row) => ({
        igdbGameId: row.igdbGameId,
        platformIgdbId: row.platformIgdbId,
        similarity: row.similarity,
        reasons: row.reasons,
      })),
    };
  }

  private async ensureEmbeddings(params: {
    client: PoolClient;
    games: NormalizedGameRecord[];
    embeddingKeywordsByGame: Map<string, string[]>;
  }): Promise<Map<string, number[]>> {
    const { client, games, embeddingKeywordsByGame } = params;
    const existingRows = await this.embeddingRepository.listGameEmbeddings(client);
    const existingByKey = new Map<string, StoredGameEmbedding>();

    for (const row of existingRows) {
      existingByKey.set(buildGameKey(row.igdbGameId, row.platformIgdbId), row);
    }

    const missingOrChanged: Array<{
      game: NormalizedGameRecord;
      key: string;
      sourceHash: string;
      text: string;
    }> = [];

    for (const game of games) {
      const key = buildGameKey(game.igdbGameId, game.platformIgdbId);
      const text = buildEmbeddingText(game, {
        keywords: embeddingKeywordsByGame.get(key) ?? [],
      });
      const sourceHash = sha256({ text });
      const existing = existingByKey.get(key);

      if (
        !existing ||
        existing.sourceHash !== sourceHash ||
        existing.embeddingModel !== this.options.embeddingModel
      ) {
        missingOrChanged.push({ game, key, sourceHash, text });
      }
    }

    const generatedRows: GameEmbeddingUpsertInput[] = [];

    for (const batch of chunk(missingOrChanged, Math.max(1, this.options.embeddingBatchSize))) {
      const vectors = await this.embeddingClient.generateEmbeddings(
        batch.map((entry) => entry.text)
      );

      if (vectors.length !== batch.length) {
        throw new Error('Embedding provider returned an unexpected number of vectors.');
      }

      for (let index = 0; index < batch.length; index += 1) {
        const vector = vectors[index];

        if (vector.length !== this.options.embeddingDimensions) {
          throw new Error(
            `Embedding dimension mismatch. Expected ${String(this.options.embeddingDimensions)}, received ${String(vector.length)}.`
          );
        }

        const entry = batch[index];
        generatedRows.push({
          igdbGameId: entry.game.igdbGameId,
          platformIgdbId: entry.game.platformIgdbId,
          embedding: vector,
          embeddingModel: this.options.embeddingModel,
          sourceHash: entry.sourceHash,
        });

        existingByKey.set(entry.key, {
          igdbGameId: entry.game.igdbGameId,
          platformIgdbId: entry.game.platformIgdbId,
          embedding: vector,
          embeddingModel: this.options.embeddingModel,
          sourceHash: entry.sourceHash,
          createdAt: new Date(this.nowProvider()).toISOString(),
          updatedAt: new Date(this.nowProvider()).toISOString(),
        });
      }
    }

    if (generatedRows.length > 0) {
      await this.embeddingRepository.upsertGameEmbeddings({
        client,
        rows: generatedRows,
      });
    }

    const vectorsByGame = new Map<string, number[]>();

    for (const [key, row] of existingByKey.entries()) {
      vectorsByGame.set(key, row.embedding);
    }

    if (vectorsByGame.size < games.length) {
      throw new Error('Embedding generation did not cover all known games.');
    }

    return vectorsByGame;
  }

  private async loadHistoryByMode(
    target: RecommendationTarget,
    client: PoolClient
  ): Promise<Record<RecommendationRuntimeMode, Map<string, { recommendationCount: number }>>> {
    const record = createModeRecord<Map<string, { recommendationCount: number }>>(() => new Map());

    for (const mode of RECOMMENDATION_RUNTIME_MODES) {
      const map = await this.repository.listRecommendationHistory({
        target,
        runtimeMode: mode,
        queryable: client,
      });

      const normalized = new Map<string, { recommendationCount: number }>();
      for (const [key, entry] of map.entries()) {
        normalized.set(key, { recommendationCount: entry.recommendationCount });
      }
      record[mode] = normalized;
    }

    return record;
  }

  private buildSemanticSimilarityMap(params: {
    games: NormalizedGameRecord[];
    embeddingsByGame: Map<string, number[]>;
  }): Map<string, number> {
    const { games, embeddingsByGame } = params;
    const profileEmbedding = buildTasteProfileEmbedding({ games, embeddingsByGame });
    const map = new Map<string, number>();

    if (!profileEmbedding) {
      return map;
    }

    for (const game of games) {
      const key = buildGameKey(game.igdbGameId, game.platformIgdbId);
      const embedding = embeddingsByGame.get(key);

      if (!embedding) {
        continue;
      }

      map.set(key, clampSemanticScore(cosineSimilarity(embedding, profileEmbedding)));
    }

    return map;
  }

  private buildTunedWeights(
    games: NormalizedGameRecord[],
    semanticSimilarityByGame: Map<string, number>
  ): TunedRecommendationWeights {
    return tuneRecommendationWeights({
      games,
      semanticSimilarityByGame,
      minimumRated: this.options.tuningMinRated,
      defaults: {
        tasteWeight: 1,
        semanticWeight: this.options.semanticWeight,
        criticWeight: 1,
        runtimeWeight: 1,
      },
    });
  }

  private buildRecommendationsByMode(params: {
    games: NormalizedGameRecord[];
    target: RecommendationTarget;
    semanticSimilarityByGame: Map<string, number>;
    tunedWeights: TunedRecommendationWeights;
    histories: Record<RecommendationRuntimeMode, Map<string, { recommendationCount: number }>>;
    structuredKeywordsByGame: Map<string, string[]>;
  }): Record<RecommendationRuntimeMode, RankedRecommendationItem[]> {
    const {
      games,
      target,
      semanticSimilarityByGame,
      tunedWeights,
      histories,
      structuredKeywordsByGame,
    } = params;
    const profile = buildPreferenceProfile(games);
    const candidates = selectCandidates(games, target);
    const rankedLimit = Math.min(candidates.length, this.options.topLimit + RANKING_DEDUPE_BUFFER);

    return createModeRecord((runtimeMode) => {
      const ranked = buildRankedScores({
        candidates,
        target,
        profile,
        limit: rankedLimit,
        runtimeMode,
        semanticSimilarityByGame,
        tunedWeights,
        explorationWeight: this.options.explorationWeight,
        diversityPenaltyWeight: this.options.diversityPenaltyWeight,
        similarityStructuredWeight: this.options.similarityStructuredWeight,
        similaritySemanticWeight: this.options.similaritySemanticWeight,
        repeatPenaltyStep: this.options.repeatPenaltyStep,
        historyByGame: histories[runtimeMode],
        structuredKeywordsByGame,
        tokenFamilyWeight: {
          collections: 1.4,
          franchises: 1.3,
          themes: this.options.themesWeight,
          developers: 1.1,
          genres: 1,
          publishers: 0.7,
          keywords: this.options.keywordsWeight,
        },
      });

      const materialized = ranked.map((item, index) => ({
        igdbGameId: item.game.igdbGameId,
        platformIgdbId: item.game.platformIgdbId,
        rank: index + 1,
        scoreTotal: item.total,
        scoreComponents: item.components,
        explanations: buildExplanation({
          components: item.components,
          tasteMatches: item.tasteMatches,
        }),
      }));

      return dedupeByGameId(materialized, this.options.topLimit);
    });
  }

  private buildLanesByMode(params: {
    target: RecommendationTarget;
    games: NormalizedGameRecord[];
    recommendationsByMode: Record<RecommendationRuntimeMode, RankedRecommendationItem[]>;
  }): Record<RecommendationRuntimeMode, RecommendationLaneCollection> {
    const { target, games, recommendationsByMode } = params;

    if (target !== 'DISCOVERY') {
      return createModeRecord((runtimeMode) =>
        buildRecommendationLanes({
          items: recommendationsByMode[runtimeMode],
          laneLimit: this.options.laneLimit,
        })
      );
    }

    const discoverySourceByGame = new Map<string, 'popular' | 'recent'>();
    for (const game of games) {
      if (game.listType !== 'discovery' || !game.discoverySource) {
        continue;
      }

      discoverySourceByGame.set(
        buildGameKey(game.igdbGameId, game.platformIgdbId),
        game.discoverySource
      );
    }

    return createModeRecord((runtimeMode) =>
      buildDiscoveryRecommendationLanes({
        items: recommendationsByMode[runtimeMode],
        laneLimit: this.options.laneLimit,
        discoverySourceByGame,
      })
    );
  }

  private buildHistoryUpdates(
    target: RecommendationTarget,
    recommendationsByMode: Record<RecommendationRuntimeMode, RankedRecommendationItem[]>
  ): Array<{
    target: RecommendationTarget;
    runtimeMode: RecommendationRuntimeMode;
    igdbGameId: string;
    platformIgdbId: number;
  }> {
    const updates: Array<{
      target: RecommendationTarget;
      runtimeMode: RecommendationRuntimeMode;
      igdbGameId: string;
      platformIgdbId: number;
    }> = [];

    for (const mode of RECOMMENDATION_RUNTIME_MODES) {
      for (const item of recommendationsByMode[mode]) {
        updates.push({
          target,
          runtimeMode: mode,
          igdbGameId: item.igdbGameId,
          platformIgdbId: item.platformIgdbId,
        });
      }
    }

    return updates;
  }

  private computeSettingsHash(): string {
    return sha256({
      topLimit: this.options.topLimit,
      laneLimit: this.options.laneLimit,
      similarityK: this.options.similarityK,
      staleHours: this.options.staleHours,
      failureBackoffMinutes: this.options.failureBackoffMinutes,
      semanticWeight: this.options.semanticWeight,
      similarityStructuredWeight: this.options.similarityStructuredWeight,
      similaritySemanticWeight: this.options.similaritySemanticWeight,
      embeddingModel: this.options.embeddingModel,
      embeddingDimensions: this.options.embeddingDimensions,
      embeddingBatchSize: this.options.embeddingBatchSize,
      runtimeModeDefault: this.options.runtimeModeDefault,
      explorationWeight: this.options.explorationWeight,
      diversityPenaltyWeight: this.options.diversityPenaltyWeight,
      repeatPenaltyStep: this.options.repeatPenaltyStep,
      tuningMinRated: this.options.tuningMinRated,
      keywordsStructuredMax: this.options.keywordsStructuredMax,
      keywordsEmbeddingMax: this.options.keywordsEmbeddingMax,
      keywordsGlobalMaxRatio: this.options.keywordsGlobalMaxRatio,
      keywordsStructuredMaxRatio: this.options.keywordsStructuredMaxRatio,
      keywordsMinLibraryCount: this.options.keywordsMinLibraryCount,
      keywordsWeight: this.options.keywordsWeight,
      themesWeight: this.options.themesWeight,
      similarityThemeWeight: this.options.similarityThemeWeight,
      similarityGenreWeight: this.options.similarityGenreWeight,
      similaritySeriesWeight: this.options.similaritySeriesWeight,
      similarityDeveloperWeight: this.options.similarityDeveloperWeight,
      similarityPublisherWeight: this.options.similarityPublisherWeight,
      similarityKeywordWeight: this.options.similarityKeywordWeight,
      discoveryEnabled: this.options.discoveryEnabled,
      discoveryPoolSize: this.options.discoveryPoolSize,
      discoveryRefreshHours: this.options.discoveryRefreshHours,
      discoveryPopularRefreshHours: this.options.discoveryPopularRefreshHours,
      discoveryRecentRefreshHours: this.options.discoveryRecentRefreshHours,
      discoveryIgdbRequestTimeoutMs: this.options.discoveryIgdbRequestTimeoutMs,
      discoveryIgdbMaxRequestsPerSecond: this.options.discoveryIgdbMaxRequestsPerSecond,
      modelVersion: 'recommendation-v3-discovery-source-lanes',
    });
  }

  private computeInputHash(
    games: NormalizedGameRecord[],
    target: RecommendationTarget,
    keywordArtifacts: {
      embeddingKeywordsByGame: Map<string, string[]>;
      structuredKeywordsByGame: Map<string, string[]>;
    }
  ): string {
    const material = games
      .map((game) => ({
        igdbGameId: game.igdbGameId,
        platformIgdbId: game.platformIgdbId,
        listType: game.listType,
        discoverySource: game.discoverySource ?? null,
        status: game.status,
        rating: game.rating,
        createdAt: game.createdAt,
        updatedAt: game.updatedAt,
        releaseYear: game.releaseYear,
        runtimeHours: game.runtimeHours,
        summary: game.summary,
        storyline: game.storyline,
        reviewScore: game.reviewScore,
        reviewSource: game.reviewSource,
        metacriticScore: game.metacriticScore,
        mobyScore: game.mobyScore,
        genres: [...game.genres].sort(),
        themes: [...game.themes].sort(),
        keywords: [...game.keywords].sort(),
        developers: [...game.developers].sort(),
        publishers: [...game.publishers].sort(),
        franchises: [...game.franchises].sort(),
        collections: [...game.collections].sort(),
      }))
      .sort((left, right) => {
        if (left.igdbGameId !== right.igdbGameId) {
          return left.igdbGameId < right.igdbGameId ? -1 : 1;
        }

        return left.platformIgdbId - right.platformIgdbId;
      });

    return sha256({
      target,
      material,
      keywordArtifacts: {
        embedding: [...keywordArtifacts.embeddingKeywordsByGame.entries()]
          .map(([key, keywords]) => ({ key, keywords: [...keywords].sort() }))
          .sort((left, right) => left.key.localeCompare(right.key, 'en')),
        structured: [...keywordArtifacts.structuredKeywordsByGame.entries()]
          .map(([key, keywords]) => ({ key, keywords: [...keywords].sort() }))
          .sort((left, right) => left.key.localeCompare(right.key, 'en')),
      },
    });
  }

  private buildKeywordArtifacts(games: NormalizedGameRecord[]): {
    embeddingKeywordsByGame: Map<string, string[]>;
    structuredKeywordsByGame: Map<string, string[]>;
  } {
    const preparedKeywordsByGame = new Map<string, string[]>();

    for (const game of games) {
      const gameKey = buildGameKey(game.igdbGameId, game.platformIgdbId);
      preparedKeywordsByGame.set(gameKey, prepareKeywords(game.keywords));
    }

    const selection = buildKeywordSelection({
      games,
      preparedKeywordsByGame,
      options: {
        globalMaxRatio: this.options.keywordsGlobalMaxRatio,
        structuredMaxRatio: this.options.keywordsStructuredMaxRatio,
        minLibraryCount: this.options.keywordsMinLibraryCount,
        structuredMax: this.options.keywordsStructuredMax,
        embeddingMax: this.options.keywordsEmbeddingMax,
      },
    });

    return {
      embeddingKeywordsByGame: selection.embeddingKeywordsByGame,
      structuredKeywordsByGame: selection.structuredKeywordsByGame,
    };
  }

  private async refreshDiscoveryPool(params: {
    client: PoolClient;
    force: boolean;
    games: NormalizedGameRecord[];
  }): Promise<void> {
    const { client, force, games } = params;
    const preferredPlatformIds = [
      ...new Set(
        games
          .filter((game) => game.listType === 'collection' || game.listType === 'wishlist')
          .map((game) => game.platformIgdbId)
          .filter((id) => Number.isInteger(id) && id > 0)
      ),
    ];
    const strictExcludedGameIds = new Set(
      games
        .filter(
          (game) =>
            game.listType === 'collection' ||
            game.listType === 'wishlist' ||
            game.status === 'completed' ||
            game.status === 'dropped'
        )
        .map((game) => game.igdbGameId.trim())
    );
    const nowIso = new Date(this.nowProvider()).toISOString();

    for (const source of ['popular', 'recent'] as const) {
      const refreshMarkerKey = `recommendations.discovery.source_last_refreshed.${source}`;
      const refreshMarker = await this.repository.getSetting(refreshMarkerKey, client);
      const latestUpdatedAt = await this.repository.getDiscoveryPoolLatestUpdatedAt({
        queryable: client,
        source,
      });

      const referenceTimestamp = Date.parse(refreshMarker ?? latestUpdatedAt ?? '');
      const refreshHours =
        source === 'popular'
          ? this.options.discoveryPopularRefreshHours
          : this.options.discoveryRecentRefreshHours;
      const stale =
        !Number.isFinite(referenceTimestamp) ||
        this.nowProvider() - referenceTimestamp >= refreshHours * 60 * 60 * 1000;

      if (!force && !stale) {
        continue;
      }

      const fetched = await this.discoveryClient.fetchDiscoveryCandidatesBySource({
        source,
        poolSize: this.options.discoveryPoolSize,
        preferredPlatformIds,
      });

      const upsertRows = fetched
        .filter((row) => !strictExcludedGameIds.has(row.igdbGameId.trim()))
        .map((row) => ({
          igdbGameId: row.igdbGameId,
          platformIgdbId: row.platformIgdbId,
          payload: buildDiscoveryPayload(row),
        }));

      const sourceHash = sha256(
        upsertRows
          .map((row) => ({
            key: buildGameKey(row.igdbGameId, row.platformIgdbId),
            payload: row.payload,
          }))
          .sort((left, right) => left.key.localeCompare(right.key, 'en'))
      );
      const sourceHashKey = `recommendations.discovery.source_hash.${source}`;
      const existingHash = await this.repository.getSetting(sourceHashKey, client);

      if (force || existingHash !== sourceHash) {
        await this.repository.upsertDiscoveryGames({
          client,
          rows: upsertRows,
        });
        const keepKeys = upsertRows.map((row) => buildGameKey(row.igdbGameId, row.platformIgdbId));
        await this.repository.pruneDiscoveryGamesBySource({
          client,
          source,
          keepKeys,
        });
        await this.repository.upsertSetting({
          queryable: client,
          settingKey: sourceHashKey,
          settingValue: sourceHash,
        });
      }

      await this.repository.upsertSetting({
        queryable: client,
        settingKey: refreshMarkerKey,
        settingValue: nowIso,
      });
    }

    if (this.discoveryEnrichmentService) {
      await this.discoveryEnrichmentService.enrichNow({
        limit: this.options.discoveryPoolSize,
        queryable: client,
      });
    }
  }

  private isStale(run: RecommendationRunSummary): boolean {
    const timestamp = Date.parse(run.finishedAt ?? run.startedAt);

    if (!Number.isFinite(timestamp)) {
      return true;
    }

    const staleMs = this.options.staleHours * 60 * 60 * 1000;
    return this.nowProvider() - timestamp >= staleMs;
  }

  private isFailureBackoffActive(run: RecommendationRunSummary | null): boolean {
    if (!run || run.status !== 'FAILED') {
      return false;
    }

    const timestamp = Date.parse(run.finishedAt ?? run.startedAt);

    if (!Number.isFinite(timestamp)) {
      return false;
    }

    const backoffMs = this.options.failureBackoffMinutes * 60 * 1000;
    return this.nowProvider() - timestamp < backoffMs;
  }
}

function createModeRecord<T>(
  factory: (mode: RecommendationRuntimeMode) => T
): Record<RecommendationRuntimeMode, T> {
  return {
    NEUTRAL: factory('NEUTRAL'),
    SHORT: factory('SHORT'),
    LONG: factory('LONG'),
  };
}

function dedupeByGameId(
  items: RankedRecommendationItem[],
  limit: number
): RankedRecommendationItem[] {
  const deduped: RankedRecommendationItem[] = [];
  const seen = new Set<string>();
  const safeLimit = Math.max(1, limit);

  for (const item of items) {
    if (seen.has(item.igdbGameId)) {
      continue;
    }

    seen.add(item.igdbGameId);
    deduped.push({
      ...item,
      rank: deduped.length + 1,
    });

    if (deduped.length >= safeLimit) {
      break;
    }
  }

  return deduped;
}

function dedupeSimilarRows(
  rows: Array<{
    igdbGameId: string;
    platformIgdbId: number;
    similarity: number;
    reasons: SimilarityReasons;
  }>,
  limit: number
): Array<{
  igdbGameId: string;
  platformIgdbId: number;
  similarity: number;
  reasons: SimilarityReasons;
}> {
  const deduped: Array<{
    igdbGameId: string;
    platformIgdbId: number;
    similarity: number;
    reasons: SimilarityReasons;
  }> = [];
  const seen = new Set<string>();
  const safeLimit = Math.max(1, limit);

  for (const row of rows) {
    if (seen.has(row.igdbGameId)) {
      continue;
    }

    seen.add(row.igdbGameId);
    deduped.push(row);

    if (deduped.length >= safeLimit) {
      break;
    }
  }

  return deduped;
}

function buildDiscoveryRecommendationLanes(params: {
  items: RankedRecommendationItem[];
  laneLimit: number;
  discoverySourceByGame: Map<string, 'popular' | 'recent'>;
}): RecommendationLaneCollection {
  const { items, discoverySourceByGame } = params;
  const laneLimit = Math.max(1, params.laneLimit);

  const blended = selectUniqueLaneItems({
    primary: items,
    fallback: items,
    laneLimit,
  });
  const popular = selectUniqueLaneItems({
    primary: items.filter(
      (item) =>
        discoverySourceByGame.get(buildGameKey(item.igdbGameId, item.platformIgdbId)) === 'popular'
    ),
    fallback: items,
    laneLimit,
  });
  const recent = selectUniqueLaneItems({
    primary: items.filter(
      (item) =>
        discoverySourceByGame.get(buildGameKey(item.igdbGameId, item.platformIgdbId)) === 'recent'
    ),
    fallback: items,
    laneLimit,
  });

  return {
    overall: blended,
    hiddenGems: popular,
    exploration: recent,
    blended,
    popular,
    recent,
  };
}

function selectUniqueLaneItems(params: {
  primary: RankedRecommendationItem[];
  fallback: RankedRecommendationItem[];
  laneLimit: number;
}): RankedRecommendationItem[] {
  const lane: RankedRecommendationItem[] = [];
  const seen = new Set<string>();

  const push = (item: RankedRecommendationItem): void => {
    if (seen.has(item.igdbGameId)) {
      return;
    }
    seen.add(item.igdbGameId);
    lane.push(item);
  };

  for (const item of params.primary) {
    push(item);
    if (lane.length >= params.laneLimit) {
      return lane;
    }
  }

  for (const item of params.fallback) {
    push(item);
    if (lane.length >= params.laneLimit) {
      return lane;
    }
  }

  return lane;
}

function normalizeLimit(value: number, max: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    return Math.min(20, max);
  }

  return Math.min(value, max);
}

function normalizePageLimit(value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return Math.min(10, max, MAX_RECOMMENDATION_PAGE_LIMIT);
  }

  return Math.min(value, max, MAX_RECOMMENDATION_PAGE_LIMIT);
}

function normalizeOffset(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    return 0;
  }

  return Math.min(value, MAX_RECOMMENDATION_PAGE_OFFSET);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) {
    return [];
  }

  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function buildDiscoveryPayload(row: DiscoveryCandidateRecord): Record<string, unknown> {
  return {
    ...row.payload,
    listType: 'discovery',
    status: null,
    rating: null,
    createdAt: null,
    updatedAt: null,
    discoverySource: row.source,
    discoverySourceScore: row.sourceScore,
  };
}

export function parseRecommendationTarget(value: unknown): RecommendationTarget | null {
  if (value === 'BACKLOG' || value === 'WISHLIST' || value === 'DISCOVERY') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = normalizeTokenKey(value).toUpperCase();
    if (normalized === 'BACKLOG' || normalized === 'WISHLIST' || normalized === 'DISCOVERY') {
      return normalized as RecommendationTarget;
    }
  }

  return null;
}

export function parseRuntimeModeOrNull(value: unknown): RecommendationRuntimeMode | null {
  const parsed = parseRecommendationRuntimeMode(value);
  return parsed;
}
