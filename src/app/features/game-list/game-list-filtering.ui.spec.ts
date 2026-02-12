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
});
