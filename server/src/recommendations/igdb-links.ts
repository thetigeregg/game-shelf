import { TasteSignalModel } from './signal.js';
import { NormalizedGameRecord } from './types.js';

/**
 * How strongly IGDB's own "similar games" lists tie a game to what the user
 * has rated. A game is linked to a rated game when either lists the other.
 */
export interface IgdbLinkEvidence {
  /** Shrunk mean taste signal of the linked games, -1..1. */
  score: number;
  /** Titles of linked games with a positive signal, strongest first. */
  likedTitles: string[];
}

/** Pseudo-links at signal 0, so one link can't carry full weight. */
export const IGDB_LINK_SHRINKAGE = 1;
const MAX_LIKED_TITLES = 3;

interface SignalledGame {
  signalSum: number;
  platformCount: number;
  title: string;
}

/**
 * Link evidence for every game in `games`, keyed by IGDB game id (platforms
 * share it). A game's own rating never counts toward its own evidence, so the
 * map needs no leave-one-out treatment when tuning or evaluating.
 */
export function buildIgdbLinkEvidence(
  games: NormalizedGameRecord[],
  signalModel: TasteSignalModel
): Map<string, IgdbLinkEvidence> {
  // One entry per IGDB game: platform copies of a rated game average out.
  const signalled = new Map<string, SignalledGame>();
  for (const game of games) {
    const signal = signalModel.signalOf(game);
    if (signal === null) {
      continue;
    }

    const existing = signalled.get(game.igdbGameId);
    if (existing) {
      existing.signalSum += signal;
      existing.platformCount += 1;
    } else {
      signalled.set(game.igdbGameId, { signalSum: signal, platformCount: 1, title: game.title });
    }
  }

  // Rated game -> the games its IGDB list names, inverted.
  const listedBy = new Map<string, Set<string>>();
  for (const game of games) {
    if (!signalled.has(game.igdbGameId)) {
      continue;
    }

    for (const similarId of game.similarGameIgdbIds) {
      let sources = listedBy.get(similarId);
      if (!sources) {
        sources = new Set();
        listedBy.set(similarId, sources);
      }
      sources.add(game.igdbGameId);
    }
  }

  const similarIdsByGame = new Map<string, Set<string>>();
  for (const game of games) {
    let ids = similarIdsByGame.get(game.igdbGameId);
    if (!ids) {
      ids = new Set();
      similarIdsByGame.set(game.igdbGameId, ids);
    }
    for (const similarId of game.similarGameIgdbIds) {
      ids.add(similarId);
    }
  }

  const evidence = new Map<string, IgdbLinkEvidence>();
  for (const [gameId, ownSimilarIds] of similarIdsByGame) {
    const linked = new Set<string>(listedBy.get(gameId));
    for (const similarId of ownSimilarIds) {
      if (signalled.has(similarId)) {
        linked.add(similarId);
      }
    }
    linked.delete(gameId);

    if (linked.size === 0) {
      continue;
    }

    let sum = 0;
    const liked: Array<{ title: string; signal: number }> = [];
    for (const linkedId of linked) {
      const source = signalled.get(linkedId) as SignalledGame;
      const signal = source.signalSum / source.platformCount;
      sum += signal;
      if (signal > 0) {
        liked.push({ title: source.title, signal });
      }
    }

    liked.sort(
      (left, right) => right.signal - left.signal || left.title.localeCompare(right.title, 'en')
    );
    evidence.set(gameId, {
      score: sum / (linked.size + IGDB_LINK_SHRINKAGE),
      likedTitles: liked.slice(0, MAX_LIKED_TITLES).map((entry) => entry.title),
    });
  }

  return evidence;
}
