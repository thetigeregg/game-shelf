import { buildTokenEntries } from './normalize.js';
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
  'themes',
  'keywords',
  'developers',
  'genres',
  'publishers'
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
  structuredFamilyWeight?: {
    themes: number;
    genres: number;
    series: number;
    developers: number;
    publishers: number;
    keywords: number;
  };
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
      keywords: 0.05
    }
  } = params;

  const indexByKey = new Map<string, GameTokenIndex>();
  for (const game of games) {
    const tokens = buildTokenEntries(game, { structuredKeywordsByGame });
    const key = buildGameKey(game.igdbGameId, game.platformIgdbId);
    indexByKey.set(key, {
      game,
      byKey: new Map(tokens.map((token) => [token.key, token])),
      embedding: embeddingsByGame.get(key) ?? null
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
        source.byKey,
        target.byKey,
        structuredFamilyWeight
      );
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

function weightedStructuredSimilarity(
  left: Map<string, TokenEntry>,
  right: Map<string, TokenEntry>,
  weights: {
    themes: number;
    genres: number;
    series: number;
    developers: number;
    publishers: number;
    keywords: number;
  }
): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  const theme = jaccardForFamilies(left, right, ['themes']);
  const genre = jaccardForFamilies(left, right, ['genres']);
  const series = jaccardForSeriesFamilies(left, right);
  const developer = jaccardForFamilies(left, right, ['developers']);
  const publisher = jaccardForFamilies(left, right, ['publishers']);
  const keyword = jaccardForFamilies(left, right, ['keywords']);
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
    (theme * weights.themes +
      genre * weights.genres +
      series * weights.series +
      developer * weights.developers +
      publisher * weights.publishers +
      keyword * weights.keywords) /
      totalWeight
  );
}

function jaccardForFamilies(
  left: Map<string, TokenEntry>,
  right: Map<string, TokenEntry>,
  families: TokenFamily[]
): number {
  const familySet = new Set<TokenFamily>(families);
  const leftSet = new Set<string>();
  const rightSet = new Set<string>();

  for (const [key, token] of left.entries()) {
    if (familySet.has(token.family)) {
      leftSet.add(key);
    }
  }

  for (const [key, token] of right.entries()) {
    if (familySet.has(token.family)) {
      rightSet.add(key);
    }
  }

  if (leftSet.size === 0 && rightSet.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const key of leftSet) {
    if (rightSet.has(key)) {
      intersection += 1;
    }
  }

  const union = leftSet.size + rightSet.size - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function jaccardForSeriesFamilies(
  left: Map<string, TokenEntry>,
  right: Map<string, TokenEntry>
): number {
  const leftSet = collectSeriesLabels(left);
  const rightSet = collectSeriesLabels(right);

  if (leftSet.size === 0 && rightSet.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const label of leftSet) {
    if (rightSet.has(label)) {
      intersection += 1;
    }
  }

  const union = leftSet.size + rightSet.size - intersection;
  return union <= 0 ? 0 : intersection / union;
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
    collections: [],
    themes: [],
    keywords: []
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
