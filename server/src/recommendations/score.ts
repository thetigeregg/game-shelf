import { calculateDiversityPenalty } from './diversity.js';
import { computeRepeatPenalty } from './history.js';
import { buildTokenEntries } from './normalize.js';
import { TOKEN_FAMILY_WEIGHT } from './profile.js';
import { buildGameKey, clampSemanticScore } from './semantic.js';
import { scoreRuntimeFit } from './runtime.js';
import {
  NormalizedGameRecord,
  PreferenceProfile,
  RecommendationRuntimeMode,
  RecommendationScoreComponents,
  RecommendationTarget,
  TasteMatch,
  TokenFamily,
  TunedRecommendationWeights
} from './types.js';

interface BaseScore {
  game: NormalizedGameRecord;
  tokenKeys: Set<string>;
  baseComponents: RecommendationScoreComponents;
  tasteMatches: TasteMatch[];
}

export interface RankedScore {
  game: NormalizedGameRecord;
  total: number;
  components: RecommendationScoreComponents;
  tasteMatches: TasteMatch[];
}

export function buildRankedScores(params: {
  candidates: NormalizedGameRecord[];
  target: RecommendationTarget;
  profile: PreferenceProfile;
  limit: number;
  runtimeMode: RecommendationRuntimeMode;
  semanticSimilarityByGame: Map<string, number>;
  tunedWeights: TunedRecommendationWeights;
  explorationWeight: number;
  diversityPenaltyWeight: number;
  repeatPenaltyStep: number;
  historyByGame: Map<string, { recommendationCount: number }>;
}): RankedScore[] {
  const {
    candidates,
    profile,
    limit,
    target,
    runtimeMode,
    semanticSimilarityByGame,
    tunedWeights,
    explorationWeight,
    diversityPenaltyWeight,
    repeatPenaltyStep,
    historyByGame
  } = params;

  const baseScores = candidates.map((game) =>
    buildBaseScore({
      game,
      target,
      profile,
      runtimeMode,
      semanticSimilarityByGame,
      tunedWeights,
      explorationWeight,
      repeatPenaltyStep,
      historyByGame
    })
  );
  const remaining = [...baseScores];
  const selected: RankedScore[] = [];

  while (remaining.length > 0 && selected.length < limit) {
    let bestIndex = 0;
    let best: RankedScore | null = null;

    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index];
      const novelty = calculateNoveltyPenalty(entry.tokenKeys, selected);
      const diversityPenalty = calculateDiversityPenalty({
        candidate: { game: entry.game, tokenKeys: entry.tokenKeys },
        selected: selected.map((ranked) => ({
          game: ranked.game,
          tokenKeys: tokenSetForGame(ranked.game)
        })),
        semanticSimilarityByGame,
        diversityPenaltyWeight
      });
      const components: RecommendationScoreComponents = {
        ...entry.baseComponents,
        novelty,
        diversityPenalty
      };
      const total = calculateTotalScore(components);
      const ranked: RankedScore = {
        game: entry.game,
        total,
        components,
        tasteMatches: entry.tasteMatches
      };

      if (!best || compareRankedScores(ranked, best) < 0) {
        best = ranked;
        bestIndex = index;
      }
    }

    if (!best) {
      break;
    }

    selected.push(best);
    remaining.splice(bestIndex, 1);
  }

  return selected.map((item) => ({
    ...item,
    total: round4(item.total),
    components: {
      taste: round4(item.components.taste),
      novelty: round4(item.components.novelty),
      runtimeFit: round4(item.components.runtimeFit),
      criticBoost: round4(item.components.criticBoost),
      recencyBoost: round4(item.components.recencyBoost),
      semantic: round4(item.components.semantic),
      exploration: round4(item.components.exploration),
      diversityPenalty: round4(item.components.diversityPenalty),
      repeatPenalty: round4(item.components.repeatPenalty)
    },
    tasteMatches: item.tasteMatches.map((match) => ({
      ...match,
      delta: round4(match.delta)
    }))
  }));
}

function buildBaseScore(params: {
  game: NormalizedGameRecord;
  target: RecommendationTarget;
  profile: PreferenceProfile;
  runtimeMode: RecommendationRuntimeMode;
  semanticSimilarityByGame: Map<string, number>;
  tunedWeights: TunedRecommendationWeights;
  explorationWeight: number;
  repeatPenaltyStep: number;
  historyByGame: Map<string, { recommendationCount: number }>;
}): BaseScore {
  const {
    game,
    target,
    profile,
    runtimeMode,
    semanticSimilarityByGame,
    tunedWeights,
    explorationWeight,
    repeatPenaltyStep,
    historyByGame
  } = params;

  const tokens = buildTokenEntries(game);
  const tokenKeys = new Set(tokens.map((token) => token.key));
  const tasteEvaluation = evaluateTaste(tokens, profile, tunedWeights.tasteWeight);
  const semantic = evaluateSemanticScore(
    game,
    semanticSimilarityByGame,
    tunedWeights.semanticWeight
  );
  const runtimeFit = evaluateRuntimeFit(game, runtimeMode, tunedWeights.runtimeWeight);
  const exploration = evaluateExploration(
    semanticSimilarityByGame.get(buildGameKey(game.igdbGameId, game.platformIgdbId)) ?? 0,
    explorationWeight
  );
  const historyKey = buildGameKey(game.igdbGameId, game.platformIgdbId);
  const recommendationCount = historyByGame.get(historyKey)?.recommendationCount ?? 0;

  const baseComponents: RecommendationScoreComponents = {
    taste: tasteEvaluation.score,
    novelty: 0,
    runtimeFit,
    criticBoost: evaluateCriticBoost(game, tunedWeights.criticWeight),
    recencyBoost: evaluateRecencyBoost(game, target),
    semantic,
    exploration,
    diversityPenalty: 0,
    repeatPenalty: computeRepeatPenalty(recommendationCount, repeatPenaltyStep)
  };

  return {
    game,
    tokenKeys,
    baseComponents,
    tasteMatches: tasteEvaluation.matches
  };
}

function evaluateTaste(
  tokens: ReturnType<typeof buildTokenEntries>,
  profile: PreferenceProfile,
  tasteWeight: number
): { score: number; matches: TasteMatch[] } {
  if (profile.ratedGameCount < 5) {
    return {
      score: 0,
      matches: []
    };
  }

  let score = 0;
  const matches: TasteMatch[] = [];

  for (const token of tokens) {
    const preference = profile.weights.get(token.key);

    if (!preference) {
      continue;
    }

    const familyWeight = TOKEN_FAMILY_WEIGHT[token.family];
    const delta = preference.weight * familyWeight * tasteWeight;
    score += delta;

    if (delta > 0) {
      matches.push({
        family: token.family,
        key: token.key,
        label: token.label,
        delta
      });
    }
  }

  return {
    score: clamp(score, -4, 4),
    matches: matches.sort((left, right) => right.delta - left.delta).slice(0, 6)
  };
}

function evaluateSemanticScore(
  game: NormalizedGameRecord,
  semanticSimilarityByGame: Map<string, number>,
  semanticWeight: number
): number {
  const key = buildGameKey(game.igdbGameId, game.platformIgdbId);
  const similarity = semanticSimilarityByGame.get(key) ?? 0;
  const bounded = clampSemanticScore(similarity);
  return clamp(bounded * semanticWeight, -3, 3);
}

function evaluateRuntimeFit(
  game: NormalizedGameRecord,
  runtimeMode: RecommendationRuntimeMode,
  runtimeWeight: number
): number {
  return clamp(scoreRuntimeFit(game.runtimeHours, runtimeMode) * runtimeWeight, -2, 2);
}

function evaluateExploration(semanticSimilarity: number, explorationWeight: number): number {
  const boundedWeight = Number.isFinite(explorationWeight) ? Math.max(0, explorationWeight) : 0;
  const similarity01 = (clampSemanticScore(semanticSimilarity) + 1) / 2;
  return clamp((1 - similarity01) * boundedWeight, 0, 1.5);
}

function evaluateCriticBoost(game: NormalizedGameRecord, criticWeight: number): number {
  const normalizedScore = normalizeCriticScore(game);

  if (normalizedScore === null) {
    return 0;
  }

  const centered = Math.max(0, normalizedScore - 60) / 40;
  return clamp(centered * 0.5 * criticWeight, 0, 1);
}

function normalizeCriticScore(game: NormalizedGameRecord): number | null {
  const reviewScore = game.reviewScore;
  const metacriticScore = game.metacriticScore;

  if (typeof reviewScore === 'number' && Number.isFinite(reviewScore)) {
    if (game.reviewSource === 'mobygames') {
      if (reviewScore > 0 && reviewScore <= 10) {
        const scaled = reviewScore * 10;
        return scaled > 0 && scaled <= 100 ? scaled : null;
      }

      return reviewScore > 0 && reviewScore <= 100 ? reviewScore : null;
    }

    if (reviewScore <= 10) {
      const scaled = reviewScore * 10;
      return scaled > 0 && scaled <= 100 ? scaled : null;
    }

    return reviewScore > 0 && reviewScore <= 100 ? reviewScore : null;
  }

  if (typeof metacriticScore === 'number' && Number.isFinite(metacriticScore)) {
    return metacriticScore > 0 && metacriticScore <= 100 ? metacriticScore : null;
  }

  if (typeof game.mobyScore === 'number' && Number.isFinite(game.mobyScore)) {
    const scaled = game.mobyScore * 10;
    return scaled > 0 && scaled <= 100 ? scaled : null;
  }

  return null;
}

function evaluateRecencyBoost(game: NormalizedGameRecord, target: RecommendationTarget): number {
  if (target !== 'BACKLOG') {
    return 0;
  }

  const baselineDate = game.createdAt ?? game.updatedAt;

  if (!baselineDate) {
    return 0;
  }

  const timestamp = Date.parse(baselineDate);

  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  const ageDays = Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  const normalized = Math.log10(ageDays + 1) / Math.log10(3650 + 1);
  return clamp(normalized * 0.8, 0, 0.8);
}

function calculateNoveltyPenalty(tokenKeys: Set<string>, selected: RankedScore[]): number {
  if (selected.length === 0 || tokenKeys.size === 0) {
    return 0;
  }

  let maxOverlap = 0;

  for (const candidate of selected.slice(0, 5)) {
    const overlap = jaccard(tokenKeys, tokenSetForGame(candidate.game));
    maxOverlap = Math.max(maxOverlap, overlap);
  }

  return -clamp(maxOverlap * 0.35, 0, 0.35);
}

function tokenSetForGame(game: NormalizedGameRecord): Set<string> {
  return new Set(buildTokenEntries(game).map((token) => token.key));
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

function calculateTotalScore(components: RecommendationScoreComponents): number {
  return (
    components.taste +
    components.novelty +
    components.runtimeFit +
    components.criticBoost +
    components.recencyBoost +
    components.semantic +
    components.exploration +
    components.diversityPenalty +
    components.repeatPenalty
  );
}

function compareRankedScores(left: RankedScore, right: RankedScore): number {
  if (left.total !== right.total) {
    return right.total - left.total;
  }

  const titleComparison = left.game.title.localeCompare(right.game.title, 'en', {
    sensitivity: 'base'
  });

  if (titleComparison !== 0) {
    return titleComparison;
  }

  if (left.game.igdbGameId !== right.game.igdbGameId) {
    return left.game.igdbGameId < right.game.igdbGameId ? -1 : 1;
  }

  return left.game.platformIgdbId - right.game.platformIgdbId;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function getTopPositiveTasteMatches(matches: TasteMatch[], limit = 3): TasteMatch[] {
  return matches
    .filter((match) => match.delta > 0)
    .sort((left, right) => right.delta - left.delta)
    .slice(0, limit);
}

export function tasteFamilyLabel(family: TokenFamily): string {
  if (family === 'collections') {
    return 'series';
  }

  return family.endsWith('s') ? family.slice(0, -1) : family;
}
