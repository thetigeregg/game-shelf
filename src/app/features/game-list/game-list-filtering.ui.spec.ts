import { DEFAULT_GAME_LIST_FILTERS, GameEntry, GameListFilters } from '../../core/models/game.models';
import { GameListFilteringEngine } from './game-list-filtering';

function makeGame(partial: Partial<GameEntry> & Pick<GameEntry, 'igdbGameId' | 'platformIgdbId' | 'title'>): GameEntry {
  return {
    igdbGameId: partial.igdbGameId,
    platformIgdbId: partial.platformIgdbId,
    title: partial.title,
    coverUrl: partial.coverUrl ?? null,
    coverSource: partial.coverSource ?? 'none',
    platform: partial.platform ?? 'Nintendo Switch',
    releaseDate: partial.releaseDate ?? null,
    releaseYear: partial.releaseYear ?? null,
    listType: partial.listType ?? 'collection',
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-01-01T00:00:00.000Z',
    collections: partial.collections,
    developers: partial.developers,
    franchises: partial.franchises,
    publishers: partial.publishers,
    genres: partial.genres,
    tags: partial.tags,
    hltbMainHours: partial.hltbMainHours ?? null,
    rating: partial.rating ?? null,
    status: partial.status ?? null,
    gameType: partial.gameType ?? null,
    similarGameIgdbIds: partial.similarGameIgdbIds,
    hltbMainExtraHours: partial.hltbMainExtraHours,
    hltbCompletionistHours: partial.hltbCompletionistHours,
    storyline: partial.storyline,
    summary: partial.summary,
    tagIds: partial.tagIds,
    id: partial.id,
  };
}

describe('GameListFilteringEngine UI behavior', () => {
  const noneTagFilterValue = '__none__';
  let engine: GameListFilteringEngine;

  beforeEach(() => {
    engine = new GameListFilteringEngine(noneTagFilterValue);
  });

  it('normalizes filters and swaps invalid hltb range', () => {
    const normalized = engine.normalizeFilters({
      ...DEFAULT_GAME_LIST_FILTERS,
      platform: ['  Switch ', 'Switch', ''],
      tags: ['Action', noneTagFilterValue, ' Action '],
      hltbMainHoursMin: 20,
      hltbMainHoursMax: 10,
    });

    expect(normalized.platform).toEqual(['Switch']);
    expect(normalized.tags).toEqual([noneTagFilterValue, 'Action']);
    expect(normalized.hltbMainHoursMin).toBe(10);
    expect(normalized.hltbMainHoursMax).toBe(20);
  });

  it('keeps games with missing hltb values when hltb range filter is active', () => {
    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 130, title: 'A', hltbMainHours: 6 }),
      makeGame({ igdbGameId: '2', platformIgdbId: 130, title: 'B', hltbMainHours: null }),
      makeGame({ igdbGameId: '3', platformIgdbId: 130, title: 'C', hltbMainHours: 15 }),
    ];
    const filters: GameListFilters = {
      ...DEFAULT_GAME_LIST_FILTERS,
      hltbMainHoursMin: 5,
      hltbMainHoursMax: 10,
    };

    const result = engine.applyFiltersAndSort(games, filters, '');

    expect(result.map(game => game.title)).toEqual(['A', 'B']);
  });

  it('supports none-tag filter for untagged games', () => {
    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 130, title: 'Tagged', tags: [{ id: 1, name: 'Action', color: '#fff' }] }),
      makeGame({ igdbGameId: '2', platformIgdbId: 130, title: 'Untagged', tags: [] }),
    ];
    const filters: GameListFilters = {
      ...DEFAULT_GAME_LIST_FILTERS,
      tags: [noneTagFilterValue],
    };

    const result = engine.applyFiltersAndSort(games, filters, '');

    expect(result.map(game => game.title)).toEqual(['Untagged']);
  });

  it('builds grouped sections with no-series bucket', () => {
    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 130, title: 'With Series', collections: ['Zelda'] }),
      makeGame({ igdbGameId: '2', platformIgdbId: 130, title: 'Without Series', collections: [] }),
    ];

    const grouped = engine.buildGroupedView(games, 'collection');

    expect(grouped.grouped).toBe(true);
    expect(grouped.totalCount).toBe(2);
    expect(grouped.sections.map(section => section.title)).toEqual(['[No Series]', 'Zelda']);
  });

  it('extracts normalized option lists', () => {
    const games: GameEntry[] = [
      makeGame({
        igdbGameId: '1',
        platformIgdbId: 130,
        title: 'Alpha',
        platform: ' Nintendo Switch ',
        genres: ['Action', ' Action ', 'RPG'],
        collections: ['Series A', 'Series A', 'Series B'],
        tags: [{ id: 1, name: 'Favorite', color: '#fff' }, { id: 2, name: ' Favorite ', color: '#000' }],
        gameType: 'main_game',
      }),
      makeGame({
        igdbGameId: '2',
        platformIgdbId: 6,
        title: 'Beta',
        platform: 'PC (Microsoft Windows)',
        genres: ['RPG'],
        collections: ['Series B'],
        tags: [{ id: 3, name: 'Backlog', color: '#aaa' }],
        gameType: 'expansion',
      }),
    ];

    expect(engine.extractPlatforms(games)).toEqual(['Nintendo Switch', 'PC (Microsoft Windows)']);
    expect(engine.extractGenres(games)).toEqual(['Action', 'RPG']);
    expect(engine.extractCollections(games)).toEqual(['Series A', 'Series B']);
    expect(engine.extractTags(games)).toEqual(['Backlog', 'Favorite']);
    expect(engine.extractGameTypes(games)).toEqual(['expansion', 'main_game']);
  });

  it('treats Family Computer as Nintendo Entertainment System for platform filters/options', () => {
    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 99, title: 'JP Game', platform: 'Family Computer' }),
      makeGame({ igdbGameId: '2', platformIgdbId: 18, title: 'US Game', platform: 'Nintendo Entertainment System' }),
    ];

    expect(engine.extractPlatforms(games)).toEqual(['Nintendo Entertainment System']);

    const normalizedFilters = engine.normalizeFilters({
      ...DEFAULT_GAME_LIST_FILTERS,
      platform: ['Family Computer'],
    });

    expect(normalizedFilters.platform).toEqual(['Nintendo Entertainment System']);

    const filtered = engine.applyFiltersAndSort(games, normalizedFilters, '');
    expect(filtered.map(game => game.title)).toEqual(['JP Game', 'US Game']);
  });

  it('treats Super Famicom as Super Nintendo Entertainment System for platform grouping', () => {
    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 58, title: 'JP SNES', platform: 'Super Famicom' }),
      makeGame({ igdbGameId: '2', platformIgdbId: 19, title: 'US SNES', platform: 'Super Nintendo Entertainment System' }),
    ];

    const grouped = engine.buildGroupedView(games, 'platform');
    expect(grouped.sections.map(section => section.title)).toEqual(['Super Nintendo Entertainment System']);
    expect(grouped.sections[0].games.map(game => game.title)).toEqual(['JP SNES', 'US SNES']);
  });

  it('applies custom platform order when extracting platform lists', () => {
    engine.setPlatformOrder(['PC (Microsoft Windows)', 'Nintendo Switch']);

    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 130, title: 'Switch Game', platform: 'Nintendo Switch' }),
      makeGame({ igdbGameId: '2', platformIgdbId: 6, title: 'PC Game', platform: 'PC (Microsoft Windows)' }),
      makeGame({ igdbGameId: '3', platformIgdbId: 167, title: 'PS5 Game', platform: 'PlayStation 5' }),
    ];

    expect(engine.extractPlatforms(games)).toEqual([
      'PC (Microsoft Windows)',
      'Nintendo Switch',
      'PlayStation 5',
    ]);
  });

  it('applies custom platform display names by platform id for extraction and filtering', () => {
    engine.setPlatformDisplayNames({ '130': 'Switch' });

    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 130, title: 'Mario', platform: 'Nintendo Switch' }),
      makeGame({ igdbGameId: '2', platformIgdbId: 167, title: 'Astro', platform: 'PlayStation 5' }),
    ];

    expect(engine.extractPlatforms(games)).toEqual(['PlayStation 5', 'Switch']);

    const normalizedFilters = engine.normalizeFilters({
      ...DEFAULT_GAME_LIST_FILTERS,
      platform: ['Switch'],
    });

    const filtered = engine.applyFiltersAndSort(games, normalizedFilters, '');
    expect(filtered.map(game => game.title)).toEqual(['Mario']);
  });

  it('uses canonical custom names for aliased platforms and keeps default platform order ranking', () => {
    engine.setPlatformOrder([
      'Family Computer',
      'Nintendo Entertainment System',
      'Super Famicom',
      'Super Nintendo Entertainment System',
      'Nintendo 64',
    ]);
    engine.setPlatformDisplayNames({
      '99': 'Famicom',
      '18': 'NES',
      '19': 'SNES',
    });

    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 99, title: 'JP NES', platform: 'Family Computer' }),
      makeGame({ igdbGameId: '2', platformIgdbId: 18, title: 'US NES', platform: 'Nintendo Entertainment System' }),
      makeGame({ igdbGameId: '3', platformIgdbId: 58, title: 'JP SNES', platform: 'Super Famicom' }),
      makeGame({ igdbGameId: '4', platformIgdbId: 19, title: 'US SNES', platform: 'Super Nintendo Entertainment System' }),
      makeGame({ igdbGameId: '5', platformIgdbId: 4, title: 'N64', platform: 'Nintendo 64' }),
    ];

    expect(engine.extractPlatforms(games)).toEqual(['NES', 'SNES', 'Nintendo 64']);

    const grouped = engine.buildGroupedView(games, 'platform');
    expect(grouped.sections.map(section => section.title)).toEqual(['NES', 'SNES', 'Nintendo 64']);
  });

  it('filters by metadata fields, status, rating, and game type', () => {
    const games: GameEntry[] = [
      makeGame({
        igdbGameId: '1',
        platformIgdbId: 130,
        title: 'Target',
        platform: 'Nintendo Switch',
        genres: ['Action'],
        collections: ['Series A'],
        developers: ['Dev A'],
        franchises: ['Franchise A'],
        publishers: ['Pub A'],
        gameType: 'main_game',
        status: 'playing',
        rating: 4,
      }),
      makeGame({
        igdbGameId: '2',
        platformIgdbId: 130,
        title: 'Other',
        platform: 'Nintendo Switch',
        genres: ['RPG'],
        collections: ['Series B'],
        developers: ['Dev B'],
        franchises: ['Franchise B'],
        publishers: ['Pub B'],
        gameType: 'expansion',
        status: 'completed',
        rating: 5,
      }),
    ];

    const filters: GameListFilters = {
      ...DEFAULT_GAME_LIST_FILTERS,
      platform: ['Nintendo Switch'],
      genres: ['Action'],
      collections: ['Series A'],
      developers: ['Dev A'],
      franchises: ['Franchise A'],
      publishers: ['Pub A'],
      gameTypes: ['main_game'],
      statuses: ['playing'],
      ratings: [4],
    };

    const result = engine.applyFiltersAndSort(games, filters, '');
    expect(result.map(game => game.title)).toEqual(['Target']);
  });

  it('supports none status and none rating filters', () => {
    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 130, title: 'No Data', status: null, rating: null }),
      makeGame({ igdbGameId: '2', platformIgdbId: 130, title: 'Has Data', status: 'playing', rating: 3 }),
    ];

    const filters: GameListFilters = {
      ...DEFAULT_GAME_LIST_FILTERS,
      statuses: ['none'],
      ratings: ['none'],
    };

    const result = engine.applyFiltersAndSort(games, filters, '');
    expect(result.map(game => game.title)).toEqual(['No Data']);
  });

  it('filters by release date range and search query', () => {
    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 130, title: 'Super Mario', releaseDate: '2020-01-10T00:00:00.000Z' }),
      makeGame({ igdbGameId: '2', platformIgdbId: 130, title: 'Metroid Prime', releaseDate: '2022-05-15T00:00:00.000Z' }),
      makeGame({ igdbGameId: '3', platformIgdbId: 130, title: 'Zelda', releaseDate: null }),
    ];

    const filters: GameListFilters = {
      ...DEFAULT_GAME_LIST_FILTERS,
      releaseDateFrom: '2020-01-01',
      releaseDateTo: '2021-12-31',
    };

    const result = engine.applyFiltersAndSort(games, filters, '  mario  ');
    expect(result.map(game => game.title)).toEqual(['Super Mario']);
  });

  it('sorts by title and ignores leading articles', () => {
    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 130, title: 'The Last Game' }),
      makeGame({ igdbGameId: '2', platformIgdbId: 130, title: 'A Better Game' }),
      makeGame({ igdbGameId: '3', platformIgdbId: 130, title: 'Final Game' }),
    ];

    const result = engine.applyFiltersAndSort(games, DEFAULT_GAME_LIST_FILTERS, '');
    expect(result.map(game => game.title)).toEqual(['A Better Game', 'Final Game', 'The Last Game']);
  });

  it('sorts by platform with title fallback', () => {
    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 130, title: 'B Game', platform: 'Switch' }),
      makeGame({ igdbGameId: '2', platformIgdbId: 6, title: 'C Game', platform: 'PC' }),
      makeGame({ igdbGameId: '3', platformIgdbId: 130, title: 'A Game', platform: 'Switch' }),
    ];

    const result = engine.applyFiltersAndSort(games, {
      ...DEFAULT_GAME_LIST_FILTERS,
      sortField: 'platform',
      sortDirection: 'asc',
    }, '');

    expect(result.map(game => `${game.platform}:${game.title}`)).toEqual([
      'PC:C Game',
      'Switch:B Game',
      'Switch:A Game',
    ]);
  });

  it('sorts by createdAt and handles invalid timestamps', () => {
    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 130, title: 'Old', createdAt: '2020-01-01T00:00:00.000Z' }),
      makeGame({ igdbGameId: '2', platformIgdbId: 130, title: 'Invalid', createdAt: 'not-a-date' }),
      makeGame({ igdbGameId: '3', platformIgdbId: 130, title: 'New', createdAt: '2023-01-01T00:00:00.000Z' }),
    ];

    const result = engine.applyFiltersAndSort(games, {
      ...DEFAULT_GAME_LIST_FILTERS,
      sortField: 'createdAt',
      sortDirection: 'asc',
    }, '');

    expect(result.map(game => game.title)).toEqual(['Old', 'New', 'Invalid']);
  });

  it('sorts by releaseDate and supports descending order', () => {
    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 130, title: 'No Date', releaseDate: null }),
      makeGame({ igdbGameId: '2', platformIgdbId: 130, title: 'Early', releaseDate: '2000-01-01T00:00:00.000Z' }),
      makeGame({ igdbGameId: '3', platformIgdbId: 130, title: 'Late', releaseDate: '2020-01-01T00:00:00.000Z' }),
    ];

    const asc = engine.applyFiltersAndSort(games, {
      ...DEFAULT_GAME_LIST_FILTERS,
      sortField: 'releaseDate',
      sortDirection: 'asc',
    }, '');
    expect(asc.map(game => game.title)).toEqual(['Early', 'Late', 'No Date']);

    const desc = engine.applyFiltersAndSort(games, {
      ...DEFAULT_GAME_LIST_FILTERS,
      sortField: 'releaseDate',
      sortDirection: 'desc',
    }, '');
    expect(desc.map(game => game.title)).toEqual(['No Date', 'Late', 'Early']);
  });

  it('builds grouped view for tag and releaseYear with fallback buckets', () => {
    const games: GameEntry[] = [
      makeGame({
        igdbGameId: '1',
        platformIgdbId: 130,
        title: 'Tagged',
        releaseYear: 2020,
        tags: [{ id: 1, name: 'Tag A', color: '#fff' }],
      }),
      makeGame({
        igdbGameId: '2',
        platformIgdbId: 130,
        title: 'Untagged',
        releaseYear: null,
        tags: [],
      }),
    ];

    const byTag = engine.buildGroupedView(games, 'tag');
    expect(byTag.sections.map(section => section.title)).toEqual(['[No Tag]', 'Tag A']);

    const byYear = engine.buildGroupedView(games, 'releaseYear');
    expect(byYear.sections.map(section => section.title)).toEqual(['[No Release Year]', '2020']);
  });

  it('returns non-grouped view when groupBy is none', () => {
    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 130, title: 'A' }),
      makeGame({ igdbGameId: '2', platformIgdbId: 130, title: 'B' }),
    ];

    const grouped = engine.buildGroupedView(games, 'none');
    expect(grouped.grouped).toBe(false);
    expect(grouped.sections).toHaveLength(1);
    expect(grouped.sections[0].title).toBe('All Games');
  });

  it('uses title fallback for createdAt sort when timestamps are equal or invalid', () => {
    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 130, title: 'The Same', createdAt: '2020-01-01T00:00:00.000Z' }),
      makeGame({ igdbGameId: '2', platformIgdbId: 130, title: 'Same', createdAt: '2020-01-01T00:00:00.000Z' }),
      makeGame({ igdbGameId: '3', platformIgdbId: 130, title: 'B Invalid', createdAt: 'bad-date' }),
      makeGame({ igdbGameId: '4', platformIgdbId: 130, title: 'A Invalid', createdAt: 'bad-date' }),
    ];

    const result = engine.applyFiltersAndSort(games, {
      ...DEFAULT_GAME_LIST_FILTERS,
      sortField: 'createdAt',
      sortDirection: 'asc',
    }, '');

    expect(result.map(game => game.title)).toEqual(['Same', 'The Same', 'B Invalid', 'A Invalid']);
  });

  it('uses releaseDate right-date branch and title fallback for missing dates', () => {
    const games: GameEntry[] = [
      makeGame({ igdbGameId: '1', platformIgdbId: 130, title: 'No Date B', releaseDate: null }),
      makeGame({ igdbGameId: '2', platformIgdbId: 130, title: 'Has Date', releaseDate: '2021-01-01T00:00:00.000Z' }),
      makeGame({ igdbGameId: '3', platformIgdbId: 130, title: 'No Date A', releaseDate: null }),
    ];

    const result = engine.applyFiltersAndSort(games, {
      ...DEFAULT_GAME_LIST_FILTERS,
      sortField: 'releaseDate',
      sortDirection: 'asc',
    }, '');

    expect(result.map(game => game.title)).toEqual(['Has Date', 'No Date A', 'No Date B']);
  });
});
