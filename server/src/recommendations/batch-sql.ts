import {
  RankedRecommendationItem,
  RecommendationLaneKey,
  RecommendationRuntimeMode,
  RecommendationTarget,
  SimilarityEdge,
} from './types.js';

export interface SqlBatch {
  sqlValues: string;
  values: unknown[];
}

export function chunkItems<T>(items: T[], size: number): T[][] {
  const safeSize = Math.max(1, size);
  const chunks: T[][] = [];

  for (let offset = 0; offset < items.length; offset += safeSize) {
    chunks.push(items.slice(offset, offset + safeSize));
  }

  return chunks;
}

export function buildRecommendationsInsertBatch(params: {
  runId: number;
  runtimeMode: RecommendationRuntimeMode;
  items: RankedRecommendationItem[];
}): SqlBatch {
  const values: unknown[] = [];
  const tuples: string[] = [];

  for (const item of params.items) {
    const baseIndex = values.length;
    tuples.push(
      `(${sqlParam(baseIndex + 1)}, ${sqlParam(baseIndex + 2)}, ${sqlParam(baseIndex + 3)}, ${sqlParam(baseIndex + 4)}, ${sqlParam(baseIndex + 5)}, ${sqlParam(baseIndex + 6)}, ${sqlParam(baseIndex + 7)}::jsonb, ${sqlParam(baseIndex + 8)}::jsonb)`
    );
    values.push(
      params.runId,
      params.runtimeMode,
      item.rank,
      item.igdbGameId,
      item.platformIgdbId,
      item.scoreTotal,
      JSON.stringify(item.scoreComponents),
      JSON.stringify(item.explanations)
    );
  }

  return {
    sqlValues: tuples.join(',\n'),
    values,
  };
}

export function buildRecommendationLanesInsertBatch(params: {
  runId: number;
  runtimeMode: RecommendationRuntimeMode;
  lane: RecommendationLaneKey;
  items: RankedRecommendationItem[];
  rankOffset: number;
}): SqlBatch {
  const values: unknown[] = [];
  const tuples: string[] = [];

  for (let index = 0; index < params.items.length; index += 1) {
    const item = params.items[index];
    const baseIndex = values.length;
    tuples.push(
      `(${sqlParam(baseIndex + 1)}, ${sqlParam(baseIndex + 2)}, ${sqlParam(baseIndex + 3)}, ${sqlParam(baseIndex + 4)}, ${sqlParam(baseIndex + 5)}, ${sqlParam(baseIndex + 6)}, ${sqlParam(baseIndex + 7)}, ${sqlParam(baseIndex + 8)}::jsonb, ${sqlParam(baseIndex + 9)}::jsonb)`
    );
    values.push(
      params.runId,
      params.runtimeMode,
      params.lane,
      params.rankOffset + index + 1,
      item.igdbGameId,
      item.platformIgdbId,
      item.scoreTotal,
      JSON.stringify(item.scoreComponents),
      JSON.stringify(item.explanations)
    );
  }

  return {
    sqlValues: tuples.join(',\n'),
    values,
  };
}

export function buildSimilarityInsertBatch(params: {
  runId: number;
  target: RecommendationTarget;
  runtimeMode: RecommendationRuntimeMode;
  edges: SimilarityEdge[];
}): SqlBatch {
  const values: unknown[] = [];
  const tuples: string[] = [];

  for (const edge of params.edges) {
    const baseIndex = values.length;
    tuples.push(
      `(${sqlParam(baseIndex + 1)}, ${sqlParam(baseIndex + 2)}, ${sqlParam(baseIndex + 3)}, ${sqlParam(baseIndex + 4)}, ${sqlParam(baseIndex + 5)}, ${sqlParam(baseIndex + 6)}, ${sqlParam(baseIndex + 7)}, ${sqlParam(baseIndex + 8)}, ${sqlParam(baseIndex + 9)}::jsonb, NOW())`
    );
    values.push(
      params.runId,
      params.target,
      params.runtimeMode,
      edge.sourceIgdbGameId,
      edge.sourcePlatformIgdbId,
      edge.similarIgdbGameId,
      edge.similarPlatformIgdbId,
      edge.similarity,
      JSON.stringify(edge.reasons)
    );
  }

  return {
    sqlValues: tuples.join(',\n'),
    values,
  };
}

export function buildHistoryUpsertBatch(
  updates: Array<{
    target: RecommendationTarget;
    runtimeMode: RecommendationRuntimeMode;
    igdbGameId: string;
    platformIgdbId: number;
  }>
): SqlBatch {
  const values: unknown[] = [];
  const tuples: string[] = [];

  for (const update of updates) {
    const baseIndex = values.length;
    tuples.push(
      `(${sqlParam(baseIndex + 1)}, ${sqlParam(baseIndex + 2)}, ${sqlParam(baseIndex + 3)}, ${sqlParam(baseIndex + 4)}, 1, NOW())`
    );
    values.push(update.target, update.runtimeMode, update.igdbGameId, update.platformIgdbId);
  }

  return {
    sqlValues: tuples.join(',\n'),
    values,
  };
}

function sqlParam(index: number): string {
  return `$${String(index)}`;
}
