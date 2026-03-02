import { buildTokenEntries } from './normalize.js';
import { TOKEN_FAMILY_WEIGHT } from './profile.js';
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
}

const TOKEN_FAMILIES: TokenFamily[] = [
  'collections',
  'franchises',
  'developers',
  'genres',
  'publishers'
];

export function buildSimilarityGraph(
  games: NormalizedGameRecord[],
  topK: number
): SimilarityEdge[] {
  const index = games.map((game) => {
    const tokens = buildTokenEntries(game);
    return {
      game,
      byKey: new Map(tokens.map((token) => [token.key, token]))
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
      const similarity = weightedJaccard(source.byKey, target.byKey);

      if (similarity <= 0) {
        continue;
      }

      const reasons = buildReasons(source.byKey, target.byKey);

      candidates.push({
        sourceIgdbGameId: source.game.igdbGameId,
        sourcePlatformIgdbId: source.game.platformIgdbId,
        similarIgdbGameId: target.game.igdbGameId,
        similarPlatformIgdbId: target.game.platformIgdbId,
        similarity: round4(similarity),
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

function buildReasons(
  source: Map<string, TokenEntry>,
  target: Map<string, TokenEntry>
): SimilarityReasons {
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
    summary: buildSummary(sharedTokens),
    sharedTokens
  };
}

function buildSummary(sharedTokens: SimilarityReasons['sharedTokens']): string {
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

  if (parts.length === 0 && sharedTokens.publishers.length > 0) {
    parts.push(`shared publisher (${sharedTokens.publishers.join(', ')})`);
  }

  return parts.length > 0 ? parts.join(' • ') : 'Shared metadata overlap';
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

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
