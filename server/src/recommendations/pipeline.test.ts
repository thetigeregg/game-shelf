import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareScoringContext } from './pipeline.js';
import { RECOMMENDATION_SCORING_DEFAULTS } from './scoring-defaults.js';
import { NormalizedGameRecord } from './types.js';

function game(
  igdbGameId: string,
  overrides: Partial<NormalizedGameRecord> = {}
): NormalizedGameRecord {
  return {
    igdbGameId,
    platformIgdbId: 6,
    title: `Game ${igdbGameId}`,
    listType: 'collection',
    status: null,
    rating: null,
    createdAt: null,
    updatedAt: null,
    releaseYear: null,
    runtimeHours: null,
    summary: null,
    storyline: null,
    reviewScore: null,
    reviewSource: null,
    metacriticScore: null,
    mobyScore: null,
    genres: [],
    developers: [],
    publishers: [],
    franchises: [],
    collections: [],
    themes: [],
    keywords: [],
    similarGameIgdbIds: [],
    ...overrides,
  };
}

void test('prepareScoringContext builds IGDB link evidence and applies the weight multiplier', () => {
  // Fewer rated games than tuningMinRated, so tuning returns its defaults (weight 1).
  const games = [
    game('loved', { rating: 5, title: 'Loved', similarGameIgdbIds: ['candidate'] }),
    game('candidate'),
  ];
  const prepare = (igdbSimilarWeight: number) =>
    prepareScoringContext({
      games,
      embeddingsByGame: new Map(),
      structuredKeywordsByGame: new Map(),
      options: { ...RECOMMENDATION_SCORING_DEFAULTS, igdbSimilarWeight },
    });

  const context = prepare(0.5);
  assert.deepEqual(context.igdbLinksByGame.get('candidate'), {
    score: 0.5,
    likedTitles: ['Loved'],
  });
  assert.equal(context.tunedWeights.igdbSimilarWeight, 0.5);
  assert.equal(prepare(0).tunedWeights.igdbSimilarWeight, 0);
  assert.equal(prepare(-2).tunedWeights.igdbSimilarWeight, 0);
});
