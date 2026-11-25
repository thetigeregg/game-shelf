import { buildTokenEntries } from './normalize.js';
import { jaccard } from './diversity.js';
import {
  buildCosineCalibration,
  buildGameKey,
  calibrateCosine,
  CosineCalibration,
  dot,
  normalizeVector,
} from './semantic.js';
import {
  NormalizedGameRecord,
  SimilarityEdge,
  SimilarityReasons,
  TokenEntry,
  TokenFamily,
} from './types.js';

type StructuredFamily = 'themes' | 'genres' | 'developers' | 'publishers' | 'keywords';

interface GameTokenIndex {
  game: NormalizedGameRecord;
  byKey: Map<string, TokenEntry>;
  familySets: Record<StructuredFamily, Set<string>>;
  seriesLabels: Set<string>;
  /** Unit-length embedding, so pair similarity is a single dot product. */
  unitEmbedding: number[] | null;
}

interface StructuredFamilyWeights {
  themes: number;
  genres: number;
  series: number;
  developers: number;
  publishers: number;
  keywords: number;
}

const TOKEN_FAMILIES: TokenFamily[] = [
  'collections',
  'franchises',
  'themes',
  'keywords',
  'developers',
  'genres',
  'publishers',
];

export function buildSimilarityGraph(params: {
  games: NormalizedGameRecord[];
  topK: number;
  sourceGames?: NormalizedGameRecord[];
  targetGames?: NormalizedGameRecord[];
  embeddingsByGame?: Map<string, number[]>;
  structuredWeight?: number;
  semanticWeight?: number;
  structuredKeywordsByGame?: Map<string, string[]>;
  structuredFamilyWeight?: StructuredFamilyWeights;
  /** Library-specific cosine range; computed from `embeddingsByGame` when omitted. */
  cosineCalibration?: CosineCalibration | null;
}): SimilarityEdge[] {
  const {
    games,
    topK,
    sourceGames = games,
    targetGames = games,
    embeddingsByGame = new Map<string, number[]>(),
    structuredWeight = 0.6,
    semanticWeight = 0.4,
    structuredKeywordsByGame,
    structuredFamilyWeight = {
      themes: 0.35,
      genres: 0.25,
      series: 0.2,
      developers: 0.1,
      publishers: 0.1,
      keywords: 0.05,
    },
  } = params;
  const cosineCalibration =
    params.cosineCalibration === undefined
      ? buildCosineCalibration(embeddingsByGame)
      : params.cosineCalibration;

  const indexByKey = new Map<string, GameTokenIndex>();
  for (const game of games) {
    const tokens = buildTokenEntries(game, { structuredKeywordsByGame });
    const key = buildGameKey(game.igdbGameId, game.platformIgdbId);
    const byKey = new Map(tokens.map((token) => [token.key, token]));
    const embedding = embeddingsByGame.get(key);
    indexByKey.set(key, {
      game,
      byKey,
      familySets: {
        themes: collectFamilyKeys(byKey, 'themes'),
        genres: collectFamilyKeys(byKey, 'genres'),
        developers: collectFamilyKeys(byKey, 'developers'),
        publishers: collectFamilyKeys(byKey, 'publishers'),
        keywords: collectFamilyKeys(byKey, 'keywords'),
      },
      seriesLabels: collectSeriesLabels(byKey),
      unitEmbedding: embedding ? normalizeVector(embedding) : null,
    });
  }

  const sourceIndex = sourceGames
    .map((game) => indexByKey.get(buildGameKey(game.igdbGameId, game.platformIgdbId)) ?? null)
    .filter((entry): entry is GameTokenIndex => entry !== null);
  const targetIndex = targetGames
    .map((game) => indexByKey.get(buildGameKey(game.igdbGameId, game.platformIgdbId)) ?? null)
    .filter((entry): entry is GameTokenIndex => entry !== null);

  const edges: SimilarityEdge[] = [];

  for (const source of sourceIndex) {
    const candidates: SimilarityEdge[] = [];

    for (const target of targetIndex) {
      if (source.game.igdbGameId === target.game.igdbGameId) {
        continue;
      }
      const structuredSimilarity = weightedStructuredSimilarity(
        source,
        target,
        structuredFamilyWeight
      );
      const semanticSimilarity =
        source.unitEmbedding && target.unitEmbedding
          ? calibrateCosine(dot(source.unitEmbedding, target.unitEmbedding), cosineCalibration)
          : 0;
      const blendedSimilarity = clamp01(
        structuredSimilarity * structuredWeight + semanticSimilarity * semanticWeight
      );

      if (blendedSimilarity <= 0) {
        continue;
      }

      const reasons = buildReasons({
        source: source.byKey,
        target: target.byKey,
        structuredSimilarity,
        semanticSimilarity,
        blendedSimilarity,
      });

      candidates.push({
        sourceIgdbGameId: source.game.igdbGameId,
        sourcePlatformIgdbId: source.game.platformIgdbId,
        similarIgdbGameId: target.game.igdbGameId,
        similarPlatformIgdbId: target.game.platformIgdbId,
        similarity: round4(blendedSimilarity),
        reasons,
      });
    }

    candidates.sort(compareSimilarityEdges);
    edges.push(...candidates.slice(0, topK));
  }

  return edges;
}

function weightedStructuredSimilarity(
  left: GameTokenIndex,
  right: GameTokenIndex,
  weights: StructuredFamilyWeights
): number {
  if (left.byKey.size === 0 || right.byKey.size === 0) {
    return 0;
  }

  const totalWeight =
    weights.themes +
    weights.genres +
    weights.series +
    weights.developers +
    weights.publishers +
    weights.keywords;

  if (totalWeight <= 0) {
    return 0;
  }

  return clamp01(
    (jaccard(left.familySets.themes, right.familySets.themes) * weights.themes +
      jaccard(left.familySets.genres, right.familySets.genres) * weights.genres +
      jaccard(left.seriesLabels, right.seriesLabels) * weights.series +
      jaccard(left.familySets.developers, right.familySets.developers) * weights.developers +
      jaccard(left.familySets.publishers, right.familySets.publishers) * weights.publishers +
      jaccard(left.familySets.keywords, right.familySets.keywords) * weights.keywords) /
      totalWeight
  );
}

function collectFamilyKeys(tokens: Map<string, TokenEntry>, family: TokenFamily): Set<string> {
  const keys = new Set<string>();

  for (const [key, token] of tokens) {
    if (token.family === family) {
      keys.add(key);
    }
  }

  return keys;
}

function collectSeriesLabels(tokens: Map<string, TokenEntry>): Set<string> {
  const labels = new Set<string>();

  for (const token of tokens.values()) {
    if (token.family !== 'collections' && token.family !== 'franchises') {
      continue;
    }

    const normalized = normalizeTokenLabel(token.label);
    if (normalized.length > 0) {
      labels.add(normalized);
    }
  }

  return labels;
}

function normalizeTokenLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildReasons(params: {
  source: Map<string, TokenEntry>;
  target: Map<string, TokenEntry>;
  structuredSimilarity: number;
  semanticSimilarity: number;
  blendedSimilarity: number;
}): SimilarityReasons {
  const { source, target, structuredSimilarity, semanticSimilarity, blendedSimilarity } = params;
  const sharedTokens: SimilarityReasons['sharedTokens'] = {
    genres: [],
    developers: [],
    publishers: [],
    franchises: [],
    collections: [],
    themes: [],
    keywords: [],
  };

  for (const [key, token] of source) {
    const targetToken = target.get(key);

    if (!targetToken) {
      continue;
    }

    const list = sharedTokens[token.family];

    if (!list.includes(token.label)) {
      list.push(token.label);
    }
  }

  dedupeSeriesSharedTokens(sharedTokens);

  for (const family of TOKEN_FAMILIES) {
    sharedTokens[family] = sharedTokens[family].slice(0, 3);
  }

  return {
    summary: buildSummary(sharedTokens, semanticSimilarity),
    structuredSimilarity: round4(structuredSimilarity),
    semanticSimilarity: round4(semanticSimilarity),
    blendedSimilarity: round4(blendedSimilarity),
    sharedTokens,
  };
}

function buildSummary(
  sharedTokens: SimilarityReasons['sharedTokens'],
  semanticSimilarity: number
): string {
  const parts: string[] = [];

  if (sharedTokens.collections.length > 0) {
    parts.push(`same series (${sharedTokens.collections.join(', ')})`);
  }

  if (sharedTokens.franchises.length > 0) {
    parts.push(`same franchise (${sharedTokens.franchises.join(', ')})`);
  }

  if (sharedTokens.developers.length > 0) {
    parts.push(`same developer (${sharedTokens.developers.join(', ')})`);
  }

  if (sharedTokens.genres.length > 0) {
    parts.push(`shared genre (${sharedTokens.genres.join(', ')})`);
  }

  if (sharedTokens.themes.length > 0) {
    parts.push(`shared theme (${sharedTokens.themes.join(', ')})`);
  }

  if (parts.length === 0 && sharedTokens.keywords.length > 0) {
    parts.push(`shared keywords (${sharedTokens.keywords.join(', ')})`);
  }

  if (parts.length === 0 && semanticSimilarity > 0.6) {
    return 'High semantic similarity from game descriptions';
  }

  if (parts.length === 0 && sharedTokens.publishers.length > 0) {
    parts.push(`shared publisher (${sharedTokens.publishers.join(', ')})`);
  }

  return parts.length > 0 ? parts.join(' • ') : 'Shared metadata and semantic overlap';
}

function dedupeSeriesSharedTokens(sharedTokens: SimilarityReasons['sharedTokens']): void {
  if (sharedTokens.collections.length === 0 || sharedTokens.franchises.length === 0) {
    return;
  }

  const collectionLabels = new Set(
    sharedTokens.collections
      .map((label) => normalizeTokenLabel(label))
      .filter((label) => label.length > 0)
  );

  sharedTokens.franchises = sharedTokens.franchises.filter(
    (label) => !collectionLabels.has(normalizeTokenLabel(label))
  );
}

function compareSimilarityEdges(left: SimilarityEdge, right: SimilarityEdge): number {
  if (left.similarity !== right.similarity) {
    return right.similarity - left.similarity;
  }

  if (left.similarIgdbGameId !== right.similarIgdbGameId) {
    return left.similarIgdbGameId < right.similarIgdbGameId ? -1 : 1;
  }

  return left.similarPlatformIgdbId - right.similarPlatformIgdbId;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
