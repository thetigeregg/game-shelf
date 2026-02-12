import { GameEntry } from '../../core/models/game.models';

export function normalizeSimilarGameIds(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(item => /^\d+$/.test(item)),
  )];
}

export function findSimilarLibraryGames(params: {
  currentGame: GameEntry;
  libraryGames: GameEntry[];
  similarIds: string[];
  compareTitles: (leftTitle: string, rightTitle: string) => number;
}): GameEntry[] {
  const { currentGame, libraryGames, similarIds, compareTitles } = params;
  const currentGameKey = `${currentGame.igdbGameId}::${currentGame.platformIgdbId}`;
  const similarIdSet = new Set(similarIds);

  return libraryGames
    .filter(candidate =>
      `${candidate.igdbGameId}::${candidate.platformIgdbId}` !== currentGameKey
      && similarIdSet.has(String(candidate.igdbGameId).trim()),
    )
    .sort((left, right) => compareTitles(left.title, right.title));
}
