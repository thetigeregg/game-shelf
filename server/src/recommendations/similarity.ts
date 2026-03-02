import { buildTokenEntries } from './normalize.js';
import { TOKEN_FAMILY_WEIGHT } from './profile.js';
import { buildGameKey, clampSemanticScore, cosineSimilarity } from './semantic.js';
import {
  NormalizedGameRecord,
  SimilarityEdge,
  SimilarityReasons,
  TokenEntry,
  TokenFamily
} from './types.js';

interface GameTokenIndex {
  game: NormalizedGameRecord;
  byKey: Map<string, TokenEntry>;
  embedding: number[] | null;
}

const TOKEN_FAMILIES: TokenFamily[] = [
  'collections',
  'franchises',
  'developers',
  'genres',
  'publishers'
];

export function buildSimilarityGraph(params: {
  games: NormalizedGameRecord[];
  topK: number;
  embeddingsByGame?: Map<string, number[]>;
  structuredWeight?: number;
  semanticWeight?: number;
}): SimilarityEdge[] {
  const {
    games,
    topK,
    embeddingsByGame = new Map<string, number[]>(),
    structuredWeight = 0.6,
    semanticWeight = 0.4
  } = params;

  const index = games.map((game) => {
    const tokens = buildTokenEntries(game);
    const key = buildGameKey(game.igdbGameId, game.platformIgdbId);
    return {
      game,
      byKey: new Map(tokens.map((token) => [token.key, token])),
      embedding: embeddingsByGame.get(key) ?? null
    } satisfies GameTokenIndex;
  });

  const edges: SimilarityEdge[] = [];

  for (let sourceIndex = 0; sourceIndex < index.length; sourceIndex += 1) {
    const source = index[sourceIndex];
    const candidates: SimilarityEdge[] = [];

    for (let targetIndex = 0; targetIndex < index.length; targetIndex += 1) {
      if (sourceIndex === targetIndex) {
        continue;
      }

      const target = index[targetIndex];
      const structuredSimilarity = weightedJaccard(source.byKey, target.byKey);
      const semanticSimilarity = resolveSemanticSimilarity(source.embedding, target.embedding);
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
        blendedSimilarity
      });

      candidates.push({
        sourceIgdbGameId: source.game.igdbGameId,
        sourcePlatformIgdbId: source.game.platformIgdbId,
        similarIgdbGameId: target.game.igdbGameId,
        similarPlatformIgdbId: target.game.platformIgdbId,
        similarity: round4(blendedSimilarity),
        reasons
      });
    }

    candidates.sort(compareSimilarityEdges);
    edges.push(...candidates.slice(0, topK));
  }

  return edges;
}

function weightedJaccard(left: Map<string, TokenEntry>, right: Map<string, TokenEntry>): number {
  if (left.size === 0 && right.size === 0) {
    return 0;
  }

  const unionKeys = new Set<string>([...left.keys(), ...right.keys()]);
  let weightedIntersection = 0;
  let weightedUnion = 0;

  for (const key of unionKeys) {
    const leftToken = left.get(key);
    const rightToken = right.get(key);
    const family = leftToken?.family ?? rightToken?.family;

    if (!family) {
      continue;
    }

    const weight = TOKEN_FAMILY_WEIGHT[family];

    if (leftToken && rightToken) {
      weightedIntersection += weight;
    }

    weightedUnion += weight;
  }

  if (weightedUnion <= 0) {
    return 0;
  }

  return weightedIntersection / weightedUnion;
}

function resolveSemanticSimilarity(left: number[] | null, right: number[] | null): number {
  if (!left || !right) {
    return 0;
  }

  const cosine = cosineSimilarity(left, right);
  const bounded = clampSemanticScore(cosine);
  return clamp01((bounded + 1) / 2);
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
    collections: []
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

  for (const family of TOKEN_FAMILIES) {
    sharedTokens[family] = sharedTokens[family].slice(0, 3);
  }

  return {
    summary: buildSummary(sharedTokens, semanticSimilarity),
    structuredSimilarity: round4(structuredSimilarity),
    semanticSimilarity: round4(semanticSimilarity),
    blendedSimilarity: round4(blendedSimilarity),
    sharedTokens
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

  if (parts.length === 0 && semanticSimilarity > 0.6) {
    return 'High semantic similarity from game descriptions';
  }

  if (parts.length === 0 && sharedTokens.publishers.length > 0) {
    parts.push(`shared publisher (${sharedTokens.publishers.join(', ')})`);
  }

  return parts.length > 0 ? parts.join(' • ') : 'Shared metadata and semantic overlap';
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
