import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecommendationLanes } from './lanes.js';
import { RankedRecommendationItem } from './types.js';

function buildItem(overrides: Partial<RankedRecommendationItem>): RankedRecommendationItem {
  return {
    igdbGameId: '1',
    platformIgdbId: 1,
    rank: 1,
    scoreTotal: 1,
    scoreComponents: {
      taste: 0,
      novelty: 0,
      runtimeFit: 0,
      criticBoost: 0,
      recencyBoost: 0,
      semantic: 0,
      exploration: 0,
      diversityPenalty: 0,
      repeatPenalty: 0
    },
    explanations: {
      headline: 'x',
      bullets: [],
      matchedTokens: {
        genres: [],
        developers: [],
        publishers: [],
        franchises: [],
        collections: [],
        themes: [],
        keywords: []
      }
    },
    ...overrides
  };
}

void test('buildRecommendationLanes returns clipped lanes', () => {
  const items = [
    buildItem({
      igdbGameId: '1',
      scoreTotal: 2,
      scoreComponents: {
        taste: 1,
        novelty: 0,
        runtimeFit: 0,
        criticBoost: 0.1,
        recencyBoost: 0,
        semantic: 0.6,
        exploration: 0.1,
        diversityPenalty: 0,
        repeatPenalty: 0
      }
    }),
    buildItem({
      igdbGameId: '2',
      rank: 2,
      scoreTotal: 1,
      scoreComponents: {
        taste: 0,
        novelty: 0,
        runtimeFit: 0,
        criticBoost: 0.4,
        recencyBoost: 0,
        semantic: 0.1,
        exploration: 0.8,
        diversityPenalty: 0,
        repeatPenalty: 0
      }
    })
  ];

  const lanes = buildRecommendationLanes({ items, laneLimit: 1 });
  assert.equal(lanes.overall.length, 1);
  assert.equal(lanes.hiddenGems.length, 1);
  assert.equal(lanes.exploration.length, 1);
  assert.equal(lanes.blended.length, 1);
  assert.equal(lanes.popular.length, 1);
  assert.equal(lanes.recent.length, 1);
  assert.equal(lanes.overall[0]?.igdbGameId, '1');
});
