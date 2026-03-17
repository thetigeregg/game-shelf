import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTokenEntries, normalizeDbGameRow, normalizeTokenKey } from './normalize.js';

void test('normalizeDbGameRow returns normalized record for valid payload', () => {
  const normalized = normalizeDbGameRow({
    igdb_game_id: ' 123 ',
    platform_igdb_id: 48,
    payload: {
      igdbGameId: '123',
      platformIgdbId: 48,
      title: ' Zelda ',
      listType: 'collection',
      discoverySource: 'popular',
      status: 'wantToPlay',
      rating: 4.6,
      createdAt: '2026-03-03T00:00:00.000Z',
      updatedAt: '2026-03-03T10:00:00.000Z',
      releaseYear: 2023,
      hltbMainHours: 0,
      hltbMainExtraHours: 12.345,
      hltbCompletionistHours: 30,
      summary: ' Summary ',
      storyline: ' Storyline ',
      reviewScore: 88.889,
      reviewSource: 'metacritic',
      metacriticScore: 90.444,
      mobyScore: 8.987,
      genres: ['Action', 'Action', ' '],
      themes: ['Fantasy'],
      keywords: ['Open World', 'Open World'],
      developers: ['Nintendo'],
      publishers: ['Nintendo'],
      franchises: ['Zelda'],
      collections: ['The Legend of Zelda'],
    },
  });

  assert.ok(normalized);
  assert.equal(normalized.title, 'Zelda');
  assert.equal(normalized.rating, 4.5);
  assert.equal(normalized.runtimeHours, 12.35);
  assert.equal(normalized.reviewScore, 88.89);
  assert.equal(normalized.metacriticScore, 90.44);
  assert.equal(normalized.mobyScore, 8.99);
  assert.deepEqual(normalized.genres, ['Action']);
  assert.deepEqual(normalized.keywords, ['Open World']);
});

void test('normalizeDbGameRow rejects invalid payloads and list types', () => {
  assert.equal(normalizeDbGameRow({ igdb_game_id: '1', platform_igdb_id: 6, payload: null }), null);
  assert.equal(normalizeDbGameRow({ igdb_game_id: '1', platform_igdb_id: 6, payload: [] }), null);
  assert.equal(
    normalizeDbGameRow({
      igdb_game_id: '1',
      platform_igdb_id: 6,
      payload: { listType: 'invalid' },
    }),
    null
  );
});

void test('normalizeDbGameRow applies defensive fallbacks and nulling', () => {
  const normalized = normalizeDbGameRow({
    igdb_game_id: '777',
    platform_igdb_id: 130,
    payload: {
      title: ' ',
      listType: 'wishlist',
      status: 'invalid',
      rating: 9,
      createdAt: 'invalid-date',
      updatedAt: '',
      releaseYear: 1950,
      hltbMainHours: -1,
      hltbMainExtraHours: 0,
      hltbCompletionistHours: -5,
      reviewScore: Number.NaN,
      reviewSource: 'invalid',
      metacriticScore: Number.POSITIVE_INFINITY,
      mobyScore: undefined,
      genres: [1, null],
      themes: 'invalid',
      keywords: ['  '],
      developers: ['Dev'],
      publishers: [],
      franchises: [],
      collections: [],
    },
  });

  assert.ok(normalized);
  assert.equal(normalized.igdbGameId, '777');
  assert.equal(normalized.platformIgdbId, 130);
  assert.equal(normalized.title, '777');
  assert.equal(normalized.status, null);
  assert.equal(normalized.rating, null);
  assert.equal(normalized.createdAt, null);
  assert.equal(normalized.updatedAt, null);
  assert.equal(normalized.releaseYear, null);
  assert.equal(normalized.runtimeHours, null);
  assert.equal(normalized.reviewScore, null);
  assert.equal(normalized.reviewSource, null);
  assert.equal(normalized.metacriticScore, null);
  assert.equal(normalized.mobyScore, null);
  assert.deepEqual(normalized.genres, []);
  assert.deepEqual(normalized.themes, []);
  assert.deepEqual(normalized.keywords, []);
});

void test('buildTokenEntries dedupes and supports structured keyword overrides', () => {
  const game = {
    igdbGameId: '100',
    platformIgdbId: 6,
    title: 'Game',
    listType: 'collection' as const,
    discoverySource: null,
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
    genres: ['Action', ' Action '],
    themes: ['Fantasy'],
    keywords: ['Legacy Keyword'],
    developers: ['Nintendo'],
    publishers: [],
    franchises: [],
    collections: [],
  };

  const structuredKeywordsByGame = new Map<string, string[]>([
    ['100::6', ['Structured', 'Structured', ' ']],
  ]);

  const entries = buildTokenEntries(game, { structuredKeywordsByGame });
  const keys = entries.map((entry) => entry.key).sort();
  assert.deepEqual(keys, [
    'developers:nintendo',
    'genres:action',
    'keywords:structured',
    'themes:fantasy',
  ]);
});

void test('normalizeTokenKey trims and collapses whitespace', () => {
  assert.equal(normalizeTokenKey('  The   Legend   Of Zelda  '), 'the legend of zelda');
});
