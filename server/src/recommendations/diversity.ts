import { calibrateCosine, CosineCalibration, dot } from './semantic.js';
import { NormalizedGameRecord } from './types.js';

export interface DiversityCandidate {
  game: NormalizedGameRecord;
  tokenKeys: Set<string>;
  /** Unit-length embedding, or null when the game has none. */
  unitEmbedding: number[] | null;
}

export interface PairSimilarityWeights {
  structuredWeight: number;
  semanticWeight: number;
  cosineCalibration: CosineCalibration | null;
}

/**
 * How alike two candidates are, 0..1: tag overlap blended with how close their
 * own embeddings are. When either game lacks an embedding only tags count.
 */
export function calculatePairSimilarity(
  left: DiversityCandidate,
  right: DiversityCandidate,
  weights: PairSimilarityWeights,
  structuredSimilarity = jaccard(left.tokenKeys, right.tokenKeys)
): number {
  if (!left.unitEmbedding || !right.unitEmbedding) {
    return clamp(structuredSimilarity, 0, 1);
  }

  const structuredWeight = Math.max(0, weights.structuredWeight);
  const semanticWeight = Math.max(0, weights.semanticWeight);
  const totalWeight = structuredWeight + semanticWeight;

  if (totalWeight <= 0) {
    return clamp(structuredSimilarity, 0, 1);
  }

  const semanticSimilarity = calibrateCosine(
    dot(left.unitEmbedding, right.unitEmbedding),
    weights.cosineCalibration
  );

  return clamp(
    (structuredSimilarity * structuredWeight + semanticSimilarity * semanticWeight) / totalWeight,
    0,
    1
  );
}

/**
 * Penalty for resembling something already picked: scaled by the closest
 * match among all selected items (max, not sum), so it separates near-duplicates
 * from unrelated games instead of saturating for everyone.
 */
export function calculateDiversityPenalty(
  params: {
    candidate: DiversityCandidate;
    selected: DiversityCandidate[];
    diversityPenaltyWeight: number;
  } & PairSimilarityWeights
): number {
  const { candidate, selected, diversityPenaltyWeight } = params;

  if (selected.length === 0 || diversityPenaltyWeight <= 0) {
    return 0;
  }

  let maxSimilarity = 0;
  for (const entry of selected) {
    maxSimilarity = Math.max(maxSimilarity, calculatePairSimilarity(candidate, entry, params));
  }

  return diversityPenaltyFromSimilarity(maxSimilarity, diversityPenaltyWeight);
}

export function diversityPenaltyFromSimilarity(
  maxSimilarity: number,
  diversityPenaltyWeight: number
): number {
  if (diversityPenaltyWeight <= 0 || maxSimilarity <= 0) {
    return 0;
  }

  return -(clamp(maxSimilarity, 0, 1) * diversityPenaltyWeight);
}

export function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 0;
  }

  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let intersection = 0;
  for (const value of smaller) {
    if (larger.has(value)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
