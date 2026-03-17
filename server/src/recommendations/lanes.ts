import { RecommendationLaneCollection, RankedRecommendationItem } from './types.js';

export function buildRecommendationLanes(params: {
  items: RankedRecommendationItem[];
  laneLimit: number;
}): RecommendationLaneCollection {
  const { items } = params;
  const laneLimit = Math.max(1, params.laneLimit);

  const overall = selectLaneItems({
    items,
    fallback: items,
    laneLimit,
  });
  const hiddenGems = selectLaneItems({
    items: items.filter(
      (item) => item.scoreComponents.semantic >= 0.4 && item.scoreComponents.criticBoost <= 0.2
    ),
    fallback: items,
    laneLimit,
  });
  const exploration = selectLaneItems({
    items: [...items].sort(
      (left, right) => right.scoreComponents.exploration - left.scoreComponents.exploration
    ),
    fallback: items,
    laneLimit,
  });

  return {
    overall,
    hiddenGems,
    exploration,
    blended: overall,
    popular: hiddenGems,
    recent: exploration,
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
    if (seen.has(item.igdbGameId)) {
      return;
    }
    seen.add(item.igdbGameId);
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
