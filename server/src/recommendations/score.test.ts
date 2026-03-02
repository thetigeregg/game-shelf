import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPreferenceProfile } from './profile.js';
import { buildRankedScores } from './score.js';
import { NormalizedGameRecord } from './types.js';

function buildGame(overrides: Partial<NormalizedGameRecord>): NormalizedGameRecord {
  return {
    igdbGameId: '1',
    platformIgdbId: 1,
    title: 'Game',
    listType: 'collection',
    status: null,
    rating: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    releaseYear: 2020,
    reviewScore: null,
    reviewSource: null,
    metacriticScore: null,
    mobyScore: null,
    genres: [],
    developers: [],
    publishers: [],
    franchises: [],
    collections: [],
    ...overrides
  };
}

void test('ranking is deterministic for the same input data', () => {
  const history: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: 'h1', rating: 5, genres: ['RPG'], developers: ['Alpha'] }),
    buildGame({ igdbGameId: 'h2', rating: 5, genres: ['RPG'], developers: ['Alpha'] }),
    buildGame({ igdbGameId: 'h3', rating: 4.5, genres: ['RPG'], developers: ['Beta'] }),
    buildGame({ igdbGameId: 'h4', rating: 4, genres: ['Action'], developers: ['Gamma'] }),
    buildGame({ igdbGameId: 'h5', rating: 2, genres: ['Puzzle'], developers: ['Delta'] })
  ];
  const candidates: NormalizedGameRecord[] = [
    buildGame({
      igdbGameId: 'c1',
      title: 'RPG Prime',
      status: 'wantToPlay',
      genres: ['RPG'],
      developers: ['Alpha'],
      reviewScore: 90,
      reviewSource: 'metacritic'
    }),
    buildGame({
      igdbGameId: 'c2',
      title: 'Puzzle Quest',
      status: 'wantToPlay',
      genres: ['Puzzle'],
      developers: ['Delta'],
      reviewScore: 70,
      reviewSource: 'metacritic'
    })
  ];

  const profile = buildPreferenceProfile([...history, ...candidates]);
  const first = buildRankedScores({ candidates, profile, target: 'BACKLOG', limit: 20 });
  const second = buildRankedScores({ candidates, profile, target: 'BACKLOG', limit: 20 });

  assert.deepEqual(first, second);
  assert.equal(first[0]?.game.igdbGameId, 'c1');
});

void test('cold start disables taste contribution when rated games are fewer than five', () => {
  const history: NormalizedGameRecord[] = [
    buildGame({ igdbGameId: 'h1', rating: 5, genres: ['RPG'], developers: ['Alpha'] })
  ];
  const candidates: NormalizedGameRecord[] = [
    buildGame({
      igdbGameId: 'c1',
      title: 'RPG Prime',
      status: 'wantToPlay',
      genres: ['RPG'],
      developers: ['Alpha']
    })
  ];

  const profile = buildPreferenceProfile([...history, ...candidates]);
  const ranked = buildRankedScores({ candidates, profile, target: 'BACKLOG', limit: 20 });

  assert.equal(ranked[0]?.components.taste, 0);
});
