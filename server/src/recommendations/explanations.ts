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

  if (components.runtimeFit !== 0) {
    bullets.push({
      type: 'runtime',
      label: 'Runtime fit adjusted for selected runtime mode',
      evidence: ['runtime:mode'],
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

  if (components.exploration !== 0) {
    bullets.push({
      type: 'exploration',
      label: 'Exploration bonus for lower profile similarity',
      evidence: ['exploration:semantic-distance'],
      delta: components.exploration
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

  if (components.diversityPenalty !== 0) {
    bullets.push({
      type: 'diversity',
      label: 'Diversity penalty applied to avoid near-duplicate picks',
      evidence: ['diversity:blended-similarity'],
      delta: components.diversityPenalty
    });
  }

  if (components.repeatPenalty !== 0) {
    bullets.push({
      type: 'repeat',
      label: 'Penalty applied for repeated recent recommendations',
      evidence: ['repeat:history-count'],
      delta: components.repeatPenalty
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
  const positiveContributors: Array<{ key: string; value: number }> = [
    { key: 'taste', value: components.taste },
    { key: 'semantic', value: components.semantic },
    { key: 'runtimeFit', value: components.runtimeFit },
    { key: 'criticBoost', value: components.criticBoost },
    { key: 'recencyBoost', value: components.recencyBoost },
    { key: 'exploration', value: components.exploration }
  ].filter((entry) => entry.value > 0);

  positiveContributors.sort((left, right) => right.value - left.value);

  const strongest = positiveContributors[0]?.key;

  if (strongest === 'semantic') {
    return 'Strong semantic match with your preferred game themes';
  }

  if (strongest === 'taste' && matches.length > 0) {
    const labels = matches.map((match) => match.label).join(', ');
    return `Matches your tastes: ${labels}`;
  }

  if (strongest === 'runtimeFit') {
    return 'Strong runtime fit for your current mode';
  }

  if (strongest === 'recencyBoost') {
    return 'Good backlog candidate: older entry worth revisiting';
  }

  if (strongest === 'criticBoost') {
    return 'Strong critic signal and metadata fit';
  }

  if (strongest === 'exploration') {
    return 'Exploration pick with potential upside';
  }

  if (components.diversityPenalty < 0 || components.repeatPenalty < 0) {
    return 'Included with anti-stagnation balancing applied';
  }

  return 'Recommended from your current library metadata';
}

function buildMatchedTokens(matches: TasteMatch[]): RecommendationExplanation['matchedTokens'] {
  const grouped: Record<TokenFamily, string[]> = {
    genres: [],
    developers: [],
    publishers: [],
    franchises: [],
    collections: [],
    themes: [],
    keywords: []
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
