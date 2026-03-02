import { RecommendationLaneCollection, RankedRecommendationItem } from './types.js';

export function buildRecommendationLanes(params: {
  items: RankedRecommendationItem[];
  laneLimit: number;
}): RecommendationLaneCollection {
  const { items } = params;
  const laneLimit = Math.max(1, params.laneLimit);

  const overall = items.slice(0, laneLimit);
  const hiddenGems = selectLaneItems({
    items: items.filter(
      (item) => item.scoreComponents.semantic >= 0.4 && item.scoreComponents.criticBoost <= 0.2
    ),
    fallback: items,
    laneLimit
  });
  const exploration = selectLaneItems({
    items: [...items].sort(
      (left, right) => right.scoreComponents.exploration - left.scoreComponents.exploration
    ),
    fallback: items,
    laneLimit
  });

  return {
    overall,
    hiddenGems,
    exploration
  };
}

function selectLaneItems(params: {
  items: RankedRecommendationItem[];
  fallback: RankedRecommendationItem[];
  laneLimit: number;
}): RankedRecommendationItem[] {
  const seen = new Set<string>();
  const lane: RankedRecommendationItem[] = [];

  const push = (item: RankedRecommendationItem): void => {
    const key = `${item.igdbGameId}::${String(item.platformIgdbId)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    lane.push(item);
  };

  for (const item of params.items) {
    push(item);
    if (lane.length >= params.laneLimit) {
      return lane;
    }
  }

  for (const item of params.fallback) {
    push(item);
    if (lane.length >= params.laneLimit) {
      return lane;
    }
  }

  return lane;
}
