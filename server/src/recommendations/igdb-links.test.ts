import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIgdbLinkEvidence, IGDB_LINK_SHRINKAGE } from './igdb-links.js';
import { buildTasteSignalModel, DEFAULT_TASTE_SIGNAL_MODEL } from './signal.js';
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
    similarGameIgdbIds: [],
    ...overrides,
  } as NormalizedGameRecord;
}

void test('links count in both directions and shrink toward zero', () => {
  const evidence = buildIgdbLinkEvidence(
    [
      // Loved game listing the candidate.
      game('loved', { rating: 5, title: 'Loved', similarGameIgdbIds: ['candidate'] }),
      // Candidate listing a liked game itself.
      game('candidate', { similarGameIgdbIds: ['liked', 'unknown'] }),
      game('liked', { rating: 4, title: 'Liked' }),
    ],
    DEFAULT_TASTE_SIGNAL_MODEL
  );

  assert.equal(IGDB_LINK_SHRINKAGE, 1);
  // Loved (+1) and Liked (+0.5) over 2 links plus 1 pseudo-link.
  assert.deepEqual(evidence.get('candidate'), {
    score: 1.5 / 3,
    likedTitles: ['Loved', 'Liked'],
  });
  // Loved and Liked are linked to the unrated candidate only, which carries no signal.
  assert.equal(evidence.get('loved'), undefined);
  assert.equal(evidence.get('unknown'), undefined);
});

void test('disliked links pull the score down and never appear as liked titles', () => {
  const evidence = buildIgdbLinkEvidence(
    [
      game('candidate'),
      game('hated', { rating: 1, similarGameIgdbIds: ['candidate'] }),
      game('meh', { rating: 3, similarGameIgdbIds: ['candidate'] }),
    ],
    DEFAULT_TASTE_SIGNAL_MODEL
  );

  assert.deepEqual(evidence.get('candidate'), { score: -1 / 3, likedTitles: [] });
});

void test('a game never counts toward its own evidence, and platform copies average', () => {
  const evidence = buildIgdbLinkEvidence(
    [
      // Rated on two platforms (5 and 3): one linked game with signal 0.5.
      game('source', { rating: 5, similarGameIgdbIds: ['candidate'] }),
      game('source', { platformIgdbId: 48, rating: 3, similarGameIgdbIds: ['candidate'] }),
      // The candidate is rated and lists itself; its own rating must not count.
      game('candidate', { rating: 1, similarGameIgdbIds: ['candidate', 'source'] }),
    ],
    DEFAULT_TASTE_SIGNAL_MODEL
  );

  assert.deepEqual(evidence.get('candidate'), { score: 0.5 / 2, likedTitles: ['Game source'] });
  // Source is linked to the candidate, rated 1.
  assert.deepEqual(evidence.get('source'), { score: -1 / 2, likedTitles: [] });
});

void test('status signals feed link evidence through the signal model', () => {
  const games = [
    game('candidate'),
    game('replayed', { status: 'replay', title: 'Replayed', similarGameIgdbIds: ['candidate'] }),
  ];

  assert.equal(buildIgdbLinkEvidence(games, DEFAULT_TASTE_SIGNAL_MODEL).size, 0);

  const withStatus = buildIgdbLinkEvidence(
    games,
    buildTasteSignalModel(games, { ratingMeanCenterWeight: 0, statusSignalWeight: 1 })
  );
  assert.deepEqual(withStatus.get('candidate'), { score: 0.75 / 2, likedTitles: ['Replayed'] });
});

void test('liked titles are capped at three, strongest first', () => {
  const evidence = buildIgdbLinkEvidence(
    [
      game('candidate'),
      game('a', { rating: 4, title: 'Alpha', similarGameIgdbIds: ['candidate'] }),
      game('b', { rating: 5, title: 'Bravo', similarGameIgdbIds: ['candidate'] }),
      game('c', { rating: 4, title: 'Charlie', similarGameIgdbIds: ['candidate'] }),
      game('d', { rating: 3.5, title: 'Delta', similarGameIgdbIds: ['candidate'] }),
    ],
    DEFAULT_TASTE_SIGNAL_MODEL
  );

  assert.deepEqual(evidence.get('candidate')?.likedTitles, ['Bravo', 'Alpha', 'Charlie']);
});
