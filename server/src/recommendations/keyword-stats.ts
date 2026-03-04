import { NormalizedGameRecord } from './types.js';

export interface KeywordStat {
  globalCount: number;
  libraryCount: number;
}

export interface KeywordSelectionOptions {
  globalMaxRatio: number;
  structuredMaxRatio: number;
  minLibraryCount: number;
  structuredMax: number;
  embeddingMax: number;
}

export interface KeywordSelectionResult {
  embeddingKeywordsByGame: Map<string, string[]>;
  structuredKeywordsByGame: Map<string, string[]>;
  stats: Map<string, KeywordStat>;
}

export function buildKeywordSelection(params: {
  games: NormalizedGameRecord[];
  preparedKeywordsByGame: Map<string, string[]>;
  options: KeywordSelectionOptions;
}): KeywordSelectionResult {
  const { games, preparedKeywordsByGame, options } = params;
  const stats = buildKeywordStats(games, preparedKeywordsByGame);
  const totalGames = Math.max(1, games.length);
  const globalMaxCount = totalGames * options.globalMaxRatio;
  const structuredMaxCount = totalGames * options.structuredMaxRatio;

  const embeddingKeywordsByGame = new Map<string, string[]>();
  const globallyEligible = new Set<string>();

  for (const [gameKey, keywords] of preparedKeywordsByGame.entries()) {
    const filtered = keywords.filter((keyword) => {
      const stat = stats.get(keyword);
      if (!stat) {
        return false;
      }

      if (stat.globalCount <= 1) {
        return false;
      }

      if (stat.globalCount > globalMaxCount) {
        return false;
      }

      return stat.libraryCount > 0;
    });

    filtered.forEach((keyword) => globallyEligible.add(keyword));
    embeddingKeywordsByGame.set(
      gameKey,
      stableSortKeywords(filtered, stats).slice(0, Math.max(1, options.embeddingMax))
    );
  }

  const structuredCandidates = [...globallyEligible].filter((keyword) => {
    const stat = stats.get(keyword);
    if (!stat) {
      return false;
    }

    if (stat.libraryCount < options.minLibraryCount) {
      return false;
    }

    return stat.globalCount <= structuredMaxCount;
  });

  const structuredAllowed = new Set(
    stableSortKeywords(structuredCandidates, stats).slice(0, Math.max(1, options.structuredMax))
  );

  const structuredKeywordsByGame = new Map<string, string[]>();
  for (const [gameKey, keywords] of embeddingKeywordsByGame.entries()) {
    structuredKeywordsByGame.set(
      gameKey,
      keywords.filter((keyword) => structuredAllowed.has(keyword))
    );
  }

  return {
    embeddingKeywordsByGame,
    structuredKeywordsByGame,
    stats
  };
}

function buildKeywordStats(
  games: NormalizedGameRecord[],
  preparedKeywordsByGame: Map<string, string[]>
): Map<string, KeywordStat> {
  const stats = new Map<string, KeywordStat>();

  for (const game of games) {
    const gameKey = `${game.igdbGameId}::${String(game.platformIgdbId)}`;
    const keywords = preparedKeywordsByGame.get(gameKey) ?? [];

    for (const keyword of keywords) {
      const existing = stats.get(keyword);
      if (existing) {
        existing.globalCount += 1;
        if (game.listType === 'collection') {
          existing.libraryCount += 1;
        }
      } else {
        stats.set(keyword, {
          globalCount: 1,
          libraryCount: game.listType === 'collection' ? 1 : 0
        });
      }
    }
  }

  return stats;
}

function stableSortKeywords(keywords: string[], stats: Map<string, KeywordStat>): string[] {
  return [...keywords].sort((left, right) => {
    const leftStat = stats.get(left);
    const rightStat = stats.get(right);
    const leftLibrary = leftStat?.libraryCount ?? 0;
    const rightLibrary = rightStat?.libraryCount ?? 0;

    if (leftLibrary !== rightLibrary) {
      return rightLibrary - leftLibrary;
    }

    const leftGlobal = leftStat?.globalCount ?? Number.MAX_SAFE_INTEGER;
    const rightGlobal = rightStat?.globalCount ?? Number.MAX_SAFE_INTEGER;
    if (leftGlobal !== rightGlobal) {
      return leftGlobal - rightGlobal;
    }

    return left.localeCompare(right, 'en');
  });
}
