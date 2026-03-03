import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { selectCandidates } from './candidates.js';
import { buildEmbeddingText } from './embedding-text.js';
import { EmbeddingClient, OpenAiEmbeddingClient } from './embedding-client.js';
import { buildExplanation } from './explanations.js';
import { buildRecommendationLanes } from './lanes.js';
import { normalizeTokenKey } from './normalize.js';
import { buildPreferenceProfile } from './profile.js';
import { EmbeddingRepository } from './embedding-repository.js';
import { RecommendationRepository } from './repository.js';
import { parseRecommendationRuntimeMode, RECOMMENDATION_RUNTIME_MODES } from './runtime.js';
import { buildRankedScores } from './score.js';
import {
  buildGameKey,
  buildTasteProfileEmbedding,
  clampSemanticScore,
  cosineSimilarity
} from './semantic.js';
import { buildSimilarityGraph } from './similarity.js';
import { tuneRecommendationWeights } from './tuning.js';
import {
  GameEmbeddingUpsertInput,
  NormalizedGameRecord,
  RankedRecommendationItem,
  RebuildResult,
  RecommendationLaneCollection,
  RecommendationRunSummary,
  RecommendationRuntimeMode,
  RecommendationTarget,
  SimilarityReasons,
  StoredGameEmbedding,
  TunedRecommendationWeights
} from './types.js';

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
}

export interface RecommendationServiceDependencies {
  embeddingRepository?: EmbeddingRepository;
  embeddingClient?: EmbeddingClient;
  nowProvider?: () => number;
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
    limit: number,
    runtimeMode?: RecommendationRuntimeMode | null
  ): Promise<{
    run: RecommendationRunSummary;
    runtimeMode: RecommendationRuntimeMode;
    lanes: RecommendationLaneCollection;
  } | null>;
  getSimilarGames(params: {
    igdbGameId: string;
    platformIgdbId: number;
    target: RecommendationTarget;
    limit: number;
  }): Promise<
    Array<{
      igdbGameId: string;
      platformIgdbId: number;
      similarity: number;
      reasons: SimilarityReasons;
    }>
  >;
}

export class RecommendationService implements RecommendationServiceApi {
  private readonly embeddingRepository: EmbeddingRepository;
  private readonly embeddingClient: EmbeddingClient;
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
        dimensions: this.options.embeddingDimensions
      });
    this.nowProvider = dependencies.nowProvider ?? (() => Date.now());
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
          status: 'BACKOFF_SKIPPED' as const
        };
      }

      const games = await this.repository.listNormalizedGames(client);
      const histories = await this.loadHistoryByMode(params.target, client);
      const settingsHash = this.computeSettingsHash();
      const inputHash = this.computeInputHash(games, params.target, histories);
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
        const embeddingsByGame = await this.ensureEmbeddings({ client, games });
        const semanticSimilarityByGame = this.buildSemanticSimilarityMap({
          games,
          embeddingsByGame
        });
        const tunedWeights = this.buildTunedWeights(games, semanticSimilarityByGame);
        const recommendationsByMode = this.buildRecommendationsByMode({
          games,
          target: params.target,
          semanticSimilarityByGame,
          tunedWeights,
          histories
        });
        const lanesByMode = this.buildLanesByMode(recommendationsByMode);
        const historyUpdates = this.buildHistoryUpdates(params.target, recommendationsByMode);
        const similarityEdges = buildSimilarityGraph({
          games,
          topK: this.options.similarityK,
          embeddingsByGame,
          structuredWeight: this.options.similarityStructuredWeight,
          semanticWeight: this.options.similaritySemanticWeight
        });

        await this.repository.finalizeRunSuccess({
          client,
          runId,
          recommendationsByMode,
          lanesByMode,
          historyUpdates,
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
      limit: safeLimit
    });

    if (!result) {
      return null;
    }

    return {
      ...result,
      runtimeMode: resolvedRuntimeMode
    };
  }

  async getRecommendationLanes(
    target: RecommendationTarget,
    limit: number,
    runtimeMode?: RecommendationRuntimeMode | null
  ): Promise<{
    run: RecommendationRunSummary;
    runtimeMode: RecommendationRuntimeMode;
    lanes: RecommendationLaneCollection;
  } | null> {
    const resolvedRuntimeMode = await this.resolveRuntimeMode(runtimeMode);
    const safeLimit = normalizeLimit(limit, this.options.laneLimit);
    const result = await this.repository.readRecommendationLanes({
      target,
      runtimeMode: resolvedRuntimeMode,
      limit: safeLimit
    });

    if (!result) {
      return null;
    }

    return {
      ...result,
      runtimeMode: resolvedRuntimeMode
    };
  }

  async getSimilarGames(params: {
    igdbGameId: string;
    platformIgdbId: number;
    target: RecommendationTarget;
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
      target: params.target,
      limit: safeLimit
    });

    return rows.map((row) => ({
      igdbGameId: row.igdbGameId,
      platformIgdbId: row.platformIgdbId,
      similarity: row.similarity,
      reasons: row.reasons
    }));
  }

  private async ensureEmbeddings(params: {
    client: PoolClient;
    games: NormalizedGameRecord[];
  }): Promise<Map<string, number[]>> {
    const { client, games } = params;
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
      const text = buildEmbeddingText(game);
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
          sourceHash: entry.sourceHash
        });

        existingByKey.set(entry.key, {
          igdbGameId: entry.game.igdbGameId,
          platformIgdbId: entry.game.platformIgdbId,
          embedding: vector,
          embeddingModel: this.options.embeddingModel,
          sourceHash: entry.sourceHash,
          createdAt: new Date(this.nowProvider()).toISOString(),
          updatedAt: new Date(this.nowProvider()).toISOString()
        });
      }
    }

    if (generatedRows.length > 0) {
      await this.embeddingRepository.upsertGameEmbeddings({
        client,
        rows: generatedRows
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
        queryable: client
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
        runtimeWeight: 1
      }
    });
  }

  private buildRecommendationsByMode(params: {
    games: NormalizedGameRecord[];
    target: RecommendationTarget;
    semanticSimilarityByGame: Map<string, number>;
    tunedWeights: TunedRecommendationWeights;
    histories: Record<RecommendationRuntimeMode, Map<string, { recommendationCount: number }>>;
  }): Record<RecommendationRuntimeMode, RankedRecommendationItem[]> {
    const { games, target, semanticSimilarityByGame, tunedWeights, histories } = params;
    const profile = buildPreferenceProfile(games);
    const candidates = selectCandidates(games, target);

    return createModeRecord((runtimeMode) => {
      const ranked = buildRankedScores({
        candidates,
        target,
        profile,
        limit: this.options.topLimit,
        runtimeMode,
        semanticSimilarityByGame,
        tunedWeights,
        explorationWeight: this.options.explorationWeight,
        diversityPenaltyWeight: this.options.diversityPenaltyWeight,
        repeatPenaltyStep: this.options.repeatPenaltyStep,
        historyByGame: histories[runtimeMode]
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
    });
  }

  private buildLanesByMode(
    recommendationsByMode: Record<RecommendationRuntimeMode, RankedRecommendationItem[]>
  ): Record<RecommendationRuntimeMode, RecommendationLaneCollection> {
    return createModeRecord((runtimeMode) =>
      buildRecommendationLanes({
        items: recommendationsByMode[runtimeMode],
        laneLimit: this.options.laneLimit
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
          platformIgdbId: item.platformIgdbId
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
      modelVersion: 'recommendation-v2.5-runtime-modes'
    });
  }

  private computeInputHash(
    games: NormalizedGameRecord[],
    target: RecommendationTarget,
    histories: Record<RecommendationRuntimeMode, Map<string, { recommendationCount: number }>>
  ): string {
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
        runtimeHours: game.runtimeHours,
        summary: game.summary,
        storyline: game.storyline,
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

    const historyMaterial = RECOMMENDATION_RUNTIME_MODES.map((mode) => ({
      mode,
      entries: [...histories[mode].entries()]
        .map(([key, entry]) => ({ key, recommendationCount: entry.recommendationCount }))
        .sort((left, right) => left.key.localeCompare(right.key, 'en'))
    }));

    return sha256({
      target,
      material,
      historyMaterial
    });
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
    LONG: factory('LONG')
  };
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

export function parseRuntimeModeOrNull(value: unknown): RecommendationRuntimeMode | null {
  const parsed = parseRecommendationRuntimeMode(value);
  return parsed;
}
