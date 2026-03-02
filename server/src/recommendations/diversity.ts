import { buildGameKey } from './semantic.js';
import { NormalizedGameRecord } from './types.js';

export interface DiversityCandidate {
  game: NormalizedGameRecord;
  tokenKeys: Set<string>;
}

export function calculateDiversityPenalty(params: {
  candidate: DiversityCandidate;
  selected: DiversityCandidate[];
  semanticSimilarityByGame: Map<string, number>;
  diversityPenaltyWeight: number;
}): number {
  const { candidate, selected, semanticSimilarityByGame, diversityPenaltyWeight } = params;

  if (selected.length === 0 || diversityPenaltyWeight <= 0) {
    return 0;
  }

  let penalty = 0;

  for (const selectedCandidate of selected.slice(0, 5)) {
    const similarity = blendedCandidateSimilarity(
      candidate,
      selectedCandidate,
      semanticSimilarityByGame
    );
    penalty += similarity * diversityPenaltyWeight;
  }

  return -clamp(penalty, 0, 1.5);
}

function blendedCandidateSimilarity(
  left: DiversityCandidate,
  right: DiversityCandidate,
  semanticSimilarityByGame: Map<string, number>
): number {
  const structured = jaccard(left.tokenKeys, right.tokenKeys);
  const leftSemantic = semanticSimilarityByGame.get(
    buildGameKey(left.game.igdbGameId, left.game.platformIgdbId)
  );
  const rightSemantic = semanticSimilarityByGame.get(
    buildGameKey(right.game.igdbGameId, right.game.platformIgdbId)
  );
  const semantic =
    typeof leftSemantic === 'number' && typeof rightSemantic === 'number'
      ? 1 - clamp(Math.abs(leftSemantic - rightSemantic) / 2, 0, 1)
      : 0;

  return clamp(structured * 0.6 + semantic * 0.4, 0, 1);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
