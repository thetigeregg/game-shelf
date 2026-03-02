import {
  RecommendationExplanation,
  RecommendationExplanationBullet,
  RecommendationScoreComponents,
  TasteMatch,
  TokenFamily
} from './types.js';
import { getTopPositiveTasteMatches, tasteFamilyLabel } from './score.js';

export function buildExplanation(params: {
  components: RecommendationScoreComponents;
  tasteMatches: TasteMatch[];
}): RecommendationExplanation {
  const { components, tasteMatches } = params;
  const topMatches = getTopPositiveTasteMatches(tasteMatches, 3);
  const bullets: RecommendationExplanationBullet[] = [];

  if (components.taste !== 0) {
    const evidence = topMatches.map((match) => `${match.family}:${match.label}`);
    bullets.push({
      type: 'taste',
      label:
        topMatches.length > 0
          ? `Matches your preferences in ${topMatches
              .map((match) => `${tasteFamilyLabel(match.family)} ${match.label}`)
              .join(', ')}`
          : 'Matches your rated-game preferences',
      evidence,
      delta: components.taste
    });
  }

  if (components.semantic !== 0) {
    bullets.push({
      type: 'semantic',
      label:
        components.semantic > 0
          ? 'Semantic match with games you rate highly'
          : 'Lower semantic match with your liked games',
      evidence: ['semantic:embedding-cosine'],
      delta: components.semantic
    });
  }

  if (components.novelty !== 0) {
    bullets.push({
      type: 'novelty',
      label:
        components.novelty < 0
          ? 'Reduced score to keep the list diverse'
          : 'Boosted for variety against similar picks',
      evidence: ['novelty:jaccard'],
      delta: components.novelty
    });
  }

  if (components.runtimeFit !== 0) {
    bullets.push({
      type: 'runtime',
      label: 'Runtime matches your current preference',
      evidence: ['runtime:neutral'],
      delta: components.runtimeFit
    });
  }

  if (components.criticBoost !== 0) {
    bullets.push({
      type: 'critic',
      label: 'Critic score contributed positively',
      evidence: ['critic:normalized'],
      delta: components.criticBoost
    });
  }

  if (components.recencyBoost !== 0) {
    bullets.push({
      type: 'recency',
      label: 'Older backlog entry received a recency boost',
      evidence: ['recency:backlog-age'],
      delta: components.recencyBoost
    });
  }

  const matchedTokens = buildMatchedTokens(topMatches);

  return {
    headline: buildHeadline(components, topMatches),
    bullets: bullets.map((bullet) => ({
      ...bullet,
      delta: round4(bullet.delta)
    })),
    matchedTokens
  };
}

function buildHeadline(components: RecommendationScoreComponents, matches: TasteMatch[]): string {
  if (components.semantic > 0.5) {
    return 'Strong semantic match with your preferred game themes';
  }

  if (components.taste > 0 && matches.length > 0) {
    const labels = matches.map((match) => match.label).join(', ');
    return `Matches your tastes: ${labels}`;
  }

  if (components.recencyBoost > 0) {
    return 'Good backlog candidate: older entry worth revisiting';
  }

  if (components.criticBoost > 0) {
    return 'Strong critic signal and metadata fit';
  }

  if (components.novelty < 0) {
    return 'Included with diversity balancing applied';
  }

  return 'Recommended from your current library metadata';
}

function buildMatchedTokens(matches: TasteMatch[]): RecommendationExplanation['matchedTokens'] {
  const grouped: Record<TokenFamily, string[]> = {
    genres: [],
    developers: [],
    publishers: [],
    franchises: [],
    collections: []
  };

  for (const match of matches) {
    if (grouped[match.family].includes(match.label)) {
      continue;
    }

    grouped[match.family].push(match.label);
  }

  return grouped;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
