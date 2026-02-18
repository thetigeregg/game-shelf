import {
  DEFAULT_GAME_LIST_FILTERS,
  GameEntry,
  GameGroupByField,
  GameListFilters,
  GameRating,
  GameRatingFilterOption,
  GameStatus,
  GameStatusFilterOption,
  GameType,
} from '../../core/models/game.models';
import {
  normalizeGameRatingFilterList,
  normalizeGameStatusFilterList,
  normalizeGameTypeList,
  normalizeStringList,
  normalizeTagFilterList,
} from '../../core/utils/game-filter-utils';
import { PLATFORM_CATALOG } from '../../core/data/platform-catalog';

export interface GameGroupSection {
  key: string;
  title: string;
  games: GameEntry[];
}

export interface GroupedGamesView {
  grouped: boolean;
  sections: GameGroupSection[];
  totalCount: number;
}

export type PlatformDisplayNameMap = Record<string, string>;

interface NormalizedFilterGame {
  updatedAt: string;
  titleLower: string;
  platform: string;
  collections: Set<string>;
  developers: Set<string>;
  franchises: Set<string>;
  publishers: Set<string>;
  genres: Set<string>;
  tagNames: Set<string>;
  gameType: GameType | null;
  status: GameStatus | null;
  rating: GameRating | null;
  effectiveHltbHours: number | null;
  releaseDate: string | null;
}

export class GameListFilteringEngine {
  private static readonly PLATFORM_DISPLAY_ALIAS_MAP: Record<string, string> = {
    'family computer': 'Nintendo Entertainment System',
    'family computer disk system': 'Nintendo Entertainment System',
    'super famicom': 'Super Nintendo Entertainment System',
    'new nintendo 3ds': 'Nintendo 3DS',
    'nintendo dsi': 'Nintendo DS',
    'e-reader / card-e reader': 'Game Boy Advance',
  };
  private readonly normalizedFilterGameByKey = new Map<string, NormalizedFilterGame>();
  private sortedGamesCache: {
    sourceGames: GameEntry[];
    sortField: GameListFilters['sortField'];
    sortDirection: GameListFilters['sortDirection'];
    sortedGames: GameEntry[];
  } | null = null;
  private readonly platformOrderByKey = new Map<string, number>();
  private platformDisplayNameById = new Map<number, string>();
  private readonly platformNameById = PLATFORM_CATALOG.reduce((map, entry) => {
    const platformId = typeof entry.id === 'number' && Number.isInteger(entry.id) && entry.id > 0
      ? entry.id
      : null;
    const platformName = String(entry.name ?? '').trim();

    if (platformId !== null && platformName.length > 0) {
      map.set(platformId, platformName);
    }

    return map;
  }, new Map<number, string>());
  private readonly canonicalCustomByPlatformNameKey = new Map<string, string>();
  private readonly canonicalPlatformNameKeyByCustomLabelKey = new Map<string, string>();

  constructor(private readonly noneTagFilterValue: string) {}

  setPlatformOrder(platformNames: string[]): void {
    this.platformOrderByKey.clear();

    platformNames.forEach((name, index) => {
      const key = this.normalizePlatformOrderKey(name);

      if (key.length > 0 && !this.platformOrderByKey.has(key)) {
        this.platformOrderByKey.set(key, index);
      }
    });
  }

  setPlatformDisplayNames(displayNames: PlatformDisplayNameMap): void {
    const nextMap = new Map<number, string>();
    const nextCanonicalCustomByPlatformNameKey = new Map<string, string>();
    const nextCanonicalPlatformNameKeyByCustomLabelKey = new Map<string, string>();

    Object.entries(displayNames ?? {}).forEach(([rawKey, rawValue]) => {
      const platformId = Number.parseInt(String(rawKey ?? ''), 10);
      const normalizedName = String(rawValue ?? '').trim();

      if (Number.isInteger(platformId) && platformId > 0 && normalizedName.length > 0) {
        nextMap.set(platformId, normalizedName);

        const platformName = this.platformNameById.get(platformId) ?? '';
        const canonicalPlatformName = this.getAliasedPlatformName(platformName);
        const canonicalPlatformNameKey = this.normalizePlatformKey(canonicalPlatformName);

        if (canonicalPlatformNameKey.length > 0 && !nextCanonicalCustomByPlatformNameKey.has(canonicalPlatformNameKey)) {
          nextCanonicalCustomByPlatformNameKey.set(canonicalPlatformNameKey, normalizedName);
          nextCanonicalPlatformNameKeyByCustomLabelKey.set(this.normalizePlatformKey(normalizedName), canonicalPlatformNameKey);
        }
      }
    });

    const unchanged = nextMap.size === this.platformDisplayNameById.size
      && [...nextMap.entries()].every(([platformId, name]) => this.platformDisplayNameById.get(platformId) === name);

    if (unchanged) {
      return;
    }

    this.platformDisplayNameById = nextMap;
    this.canonicalCustomByPlatformNameKey.clear();
    nextCanonicalCustomByPlatformNameKey.forEach((value, key) => this.canonicalCustomByPlatformNameKey.set(key, value));
    this.canonicalPlatformNameKeyByCustomLabelKey.clear();
    nextCanonicalPlatformNameKeyByCustomLabelKey.forEach((value, key) => this.canonicalPlatformNameKeyByCustomLabelKey.set(key, value));
    this.normalizedFilterGameByKey.clear();
    this.sortedGamesCache = null;
  }

  normalizeFilters(filters: GameListFilters): GameListFilters {
    const normalizedPlatforms = [...new Set(
      normalizeStringList(filters.platform)
        .map(platform => this.getCanonicalPlatformLabel(platform))
        .filter(platform => platform.length > 0),
    )];
    const normalizedGenres = normalizeStringList(filters.genres);
    const normalizedCollections = normalizeStringList(filters.collections);
    const normalizedDevelopers = normalizeStringList(filters.developers);
    const normalizedFranchises = normalizeStringList(filters.franchises);
    const normalizedPublishers = normalizeStringList(filters.publishers);
    const normalizedGameTypes = normalizeGameTypeList(filters.gameTypes);
    const normalizedStatuses = normalizeGameStatusFilterList(filters.statuses);
    const normalizedTags = normalizeTagFilterList(filters.tags, this.noneTagFilterValue);
    const normalizedRatings = normalizeGameRatingFilterList(filters.ratings);
    const hltbMainHoursMin = this.normalizeFilterHours(filters.hltbMainHoursMin);
    const hltbMainHoursMax = this.normalizeFilterHours(filters.hltbMainHoursMax);

    return {
      ...DEFAULT_GAME_LIST_FILTERS,
      ...filters,
      platform: normalizedPlatforms,
      collections: normalizedCollections,
      developers: normalizedDevelopers,
      franchises: normalizedFranchises,
      publishers: normalizedPublishers,
      gameTypes: normalizedGameTypes,
      genres: normalizedGenres,
      statuses: normalizedStatuses,
      tags: normalizedTags,
      ratings: normalizedRatings,
      hltbMainHoursMin: hltbMainHoursMin !== null && hltbMainHoursMax !== null && hltbMainHoursMin > hltbMainHoursMax
        ? hltbMainHoursMax
        : hltbMainHoursMin,
      hltbMainHoursMax: hltbMainHoursMin !== null && hltbMainHoursMax !== null && hltbMainHoursMin > hltbMainHoursMax
        ? hltbMainHoursMin
        : hltbMainHoursMax,
    };
  }

  extractPlatforms(games: GameEntry[]): string[] {
    return [...new Set(
      games
        .map(game => this.getCanonicalPlatformLabel(this.getDisplayPlatformName(game), this.getDisplayPlatformIgdbId(game)))
        .filter(platform => platform.length > 0),
    )].sort((a, b) => this.comparePlatformNames(a, b));
  }

  extractGenres(games: GameEntry[]): string[] {
    const genreSet = new Set<string>();

    games.forEach(game => {
      normalizeStringList(game.genres).forEach(genre => genreSet.add(genre));
    });

    return Array.from(genreSet).sort((a, b) => this.compareTitles(a, b));
  }

  extractCollections(games: GameEntry[]): string[] {
    const collectionSet = new Set<string>();

    games.forEach(game => {
      normalizeStringList(game.collections).forEach(collection => collectionSet.add(collection));
    });

    return Array.from(collectionSet).sort((a, b) => this.compareTitles(a, b));
  }

  extractGameTypes(games: GameEntry[]): GameType[] {
    const gameTypeSet = new Set<GameType>();

    games.forEach(game => {
      const gameType = game.gameType ?? null;

      if (gameType && normalizeGameTypeList([gameType]).length > 0) {
        gameTypeSet.add(gameType);
      }
    });

    return Array.from(gameTypeSet).sort((a, b) => a.localeCompare(b));
  }

  extractTags(games: GameEntry[]): string[] {
    const tagSet = new Set<string>();

    games.forEach(game => {
      normalizeStringList((game.tags ?? []).map(tag => tag.name)).forEach(tagName => tagSet.add(tagName));
    });

    return Array.from(tagSet).sort((a, b) => this.compareTitles(a, b));
  }

  applyFiltersAndSort(games: GameEntry[], filters: GameListFilters, searchQuery: string): GameEntry[] {
    this.pruneNormalizedFilterCache(games);
    const normalizedSearchQuery = searchQuery.trim().toLowerCase();
    const minMainHours = this.normalizeFilterHours(filters.hltbMainHoursMin);
    const maxMainHours = this.normalizeFilterHours(filters.hltbMainHoursMax);
    const sortedGames = this.getSortedGames(games, filters.sortField, filters.sortDirection);
    return sortedGames.filter(game => this.matchesFilters(game, filters, normalizedSearchQuery, minMainHours, maxMainHours));
  }

  buildGroupedView(games: GameEntry[], groupBy: GameGroupByField): GroupedGamesView {
    if (groupBy === 'none') {
      return {
        grouped: false,
        sections: [{ key: 'none', title: 'All Games', games }],
        totalCount: games.length,
      };
    }

    const sectionsMap = new Map<string, GameEntry[]>();

    games.forEach(game => {
      this.getGroupTitlesForGame(game, groupBy).forEach(title => {
        const normalized = title.trim();

        if (!sectionsMap.has(normalized)) {
          sectionsMap.set(normalized, []);
        }

        sectionsMap.get(normalized)?.push(game);
      });
    });

    const sortedSections = [...sectionsMap.entries()]
      .sort(([left], [right]) => this.compareGroupTitles(left, right, groupBy))
      .map(([title, groupedGames]) => ({
        key: `${groupBy}-${title}`,
        title,
        games: groupedGames,
      }));

    return {
      grouped: true,
      sections: sortedSections,
      totalCount: games.length,
    };
  }

  private getGroupTitlesForGame(game: GameEntry, groupBy: GameGroupByField): string[] {
    const noGroupLabel = this.getNoGroupLabel(groupBy);

    if (groupBy === 'platform') {
      return [this.getCanonicalPlatformLabel(this.getDisplayPlatformName(game), this.getDisplayPlatformIgdbId(game)) || noGroupLabel];
    }

    if (groupBy === 'releaseYear') {
      return [game.releaseYear ? String(game.releaseYear) : noGroupLabel];
    }

    if (groupBy === 'tag') {
      const tagNames = normalizeStringList((game.tags ?? []).map(tag => tag.name));
      return tagNames.length > 0 ? tagNames : [noGroupLabel];
    }

    if (groupBy === 'developer') {
      return this.getMetadataGroupValues(game.developers, noGroupLabel);
    }

    if (groupBy === 'franchise') {
      return this.getMetadataGroupValues(game.franchises, noGroupLabel);
    }

    if (groupBy === 'collection') {
      return this.getMetadataGroupValues(game.collections, noGroupLabel);
    }

    if (groupBy === 'genre') {
      return this.getMetadataGroupValues(game.genres, noGroupLabel);
    }

    if (groupBy === 'publisher') {
      return this.getMetadataGroupValues(game.publishers, noGroupLabel);
    }

    return ['All Games'];
  }

  private getMetadataGroupValues(values: string[] | undefined, fallback: string): string[] {
    const normalizedValues = normalizeStringList(values);
    return normalizedValues.length > 0 ? normalizedValues : [fallback];
  }

  private compareGroupTitles(left: string, right: string, groupBy: GameGroupByField): number {
    const noGroupLabel = this.getNoGroupLabel(groupBy);

    if (left === noGroupLabel && right !== noGroupLabel) {
      return -1;
    }

    if (right === noGroupLabel && left !== noGroupLabel) {
      return 1;
    }

    if (groupBy === 'releaseYear') {
      const leftYear = Number.parseInt(left, 10);
      const rightYear = Number.parseInt(right, 10);

      if (!Number.isNaN(leftYear) && !Number.isNaN(rightYear) && leftYear !== rightYear) {
        return rightYear - leftYear;
      }
    }

    if (groupBy === 'platform') {
      return this.comparePlatformNames(left, right);
    }

    return this.compareTitles(left, right);
  }

  private comparePlatformNames(left: string, right: string): number {
    const leftRank = this.getPlatformOrderRank(left);
    const rightRank = this.getPlatformOrderRank(right);

    if (leftRank !== null && rightRank !== null && leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    if (leftRank !== null && rightRank === null) {
      return -1;
    }

    if (leftRank === null && rightRank !== null) {
      return 1;
    }

    return this.compareTitles(left, right);
  }

  private getPlatformOrderRank(value: string): number | null {
    const key = this.normalizePlatformOrderKey(value);
    const directRank = this.platformOrderByKey.get(key);

    if (typeof directRank === 'number') {
      return directRank;
    }

    const canonicalPlatformNameKey = this.canonicalPlatformNameKeyByCustomLabelKey.get(key);

    if (canonicalPlatformNameKey) {
      return this.platformOrderByKey.get(canonicalPlatformNameKey) ?? null;
    }

    return null;
  }

  private normalizePlatformOrderKey(value: string): string {
    return this.normalizePlatformKey(this.getAliasedPlatformName(value));
  }

  private getCanonicalPlatformLabel(value: string | null | undefined, platformIgdbId?: number | null): string {
    const trimmed = String(value ?? '').trim();

    if (trimmed.length === 0) {
      return '';
    }

    const aliased = this.getAliasedPlatformName(trimmed);
    const aliasedKey = this.normalizePlatformKey(aliased);
    const canonicalCustomName = this.canonicalCustomByPlatformNameKey.get(aliasedKey);

    if (typeof canonicalCustomName === 'string' && canonicalCustomName.trim().length > 0) {
      return canonicalCustomName.trim();
    }

    const platformId = typeof platformIgdbId === 'number' && Number.isInteger(platformIgdbId) && platformIgdbId > 0
      ? platformIgdbId
      : null;

    if (platformId !== null) {
      const customName = this.platformDisplayNameById.get(platformId);

      if (typeof customName === 'string' && customName.trim().length > 0) {
        return customName.trim();
      }
    }

    return aliased;
  }

  private getAliasedPlatformName(value: string | null | undefined): string {
    const trimmed = String(value ?? '').trim();

    if (trimmed.length === 0) {
      return '';
    }

    const normalizedKey = this.normalizePlatformKey(trimmed);
    return GameListFilteringEngine.PLATFORM_DISPLAY_ALIAS_MAP[normalizedKey] ?? trimmed;
  }

  private normalizePlatformKey(value: string | null | undefined): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private getNoGroupLabel(groupBy: GameGroupByField): string {
    if (groupBy === 'platform') {
      return '[No Platform]';
    }

    if (groupBy === 'developer') {
      return '[No Developer]';
    }

    if (groupBy === 'franchise') {
      return '[No Franchise]';
    }

    if (groupBy === 'collection') {
      return '[No Series]';
    }

    if (groupBy === 'tag') {
      return '[No Tag]';
    }

    if (groupBy === 'genre') {
      return '[No Genre]';
    }

    if (groupBy === 'publisher') {
      return '[No Publisher]';
    }

    if (groupBy === 'releaseYear') {
      return '[No Release Year]';
    }

    return '[No Group]';
  }

  private matchesFilters(
    game: GameEntry,
    filters: GameListFilters,
    normalizedSearchQuery: string,
    minMainHours: number | null,
    maxMainHours: number | null,
  ): boolean {
    const normalized = this.getNormalizedFilterGame(game);

    if (normalizedSearchQuery.length > 0 && !normalized.titleLower.includes(normalizedSearchQuery)) {
      return false;
    }

    if (filters.platform.length > 0 && !filters.platform.includes(normalized.platform)) {
      return false;
    }

    if (filters.genres.length > 0 && !filters.genres.some(selectedGenre => normalized.genres.has(selectedGenre))) {
      return false;
    }

    if (filters.collections.length > 0 && !filters.collections.some(selectedCollection => normalized.collections.has(selectedCollection))) {
      return false;
    }

    if (filters.developers.length > 0 && !filters.developers.some(selectedDeveloper => normalized.developers.has(selectedDeveloper))) {
      return false;
    }

    if (filters.franchises.length > 0 && !filters.franchises.some(selectedFranchise => normalized.franchises.has(selectedFranchise))) {
      return false;
    }

    if (filters.publishers.length > 0 && !filters.publishers.some(selectedPublisher => normalized.publishers.has(selectedPublisher))) {
      return false;
    }

    if (filters.gameTypes.length > 0) {
      const gameType = normalized.gameType;

      if (!gameType || !filters.gameTypes.includes(gameType)) {
        return false;
      }
    }

    if (filters.statuses.length > 0) {
      const gameStatus = normalized.status;
      const matchesNone = gameStatus === null && filters.statuses.includes('none');
      const matchesStatus = gameStatus !== null && filters.statuses.includes(gameStatus as GameStatusFilterOption);

      if (!matchesNone && !matchesStatus) {
        return false;
      }
    }

    if (filters.tags.length > 0) {
      const matchesNoneTagFilter = filters.tags.includes(this.noneTagFilterValue);
      const selectedTagNames = filters.tags.filter(tag => tag !== this.noneTagFilterValue);
      const matchesSelectedTag = selectedTagNames.some(selectedTag => normalized.tagNames.has(selectedTag));
      const matchesNoTags = matchesNoneTagFilter && normalized.tagNames.size === 0;

      if (!matchesSelectedTag && !matchesNoTags) {
        return false;
      }
    }

    if (filters.ratings.length > 0) {
      const gameRating = normalized.rating;
      const matchesNone = gameRating === null && filters.ratings.includes('none');
      const matchesRating = gameRating !== null && filters.ratings.includes(gameRating as GameRatingFilterOption);

      if (!matchesNone && !matchesRating) {
        return false;
      }
    }

    const gameMainHours = normalized.effectiveHltbHours;

    if (gameMainHours !== null) {
      if (minMainHours !== null && gameMainHours < minMainHours) {
        return false;
      }

      if (maxMainHours !== null && gameMainHours > maxMainHours) {
        return false;
      }
    }

    const gameDate = normalized.releaseDate;

    if (filters.releaseDateFrom && (!gameDate || gameDate < filters.releaseDateFrom)) {
      return false;
    }

    if (filters.releaseDateTo && (!gameDate || gameDate > filters.releaseDateTo)) {
      return false;
    }

    return true;
  }

  private getSortedGames(
    games: GameEntry[],
    sortField: GameListFilters['sortField'],
    sortDirection: GameListFilters['sortDirection'],
  ): GameEntry[] {
    const existingCache = this.sortedGamesCache;

    if (existingCache
      && existingCache.sourceGames === games
      && existingCache.sortField === sortField
      && existingCache.sortDirection === sortDirection) {
      return existingCache.sortedGames;
    }

    const sortedAsc = [...games].sort((left, right) => this.compareGames(left, right, sortField));
    const sortedGames = sortDirection === 'desc' ? sortedAsc.reverse() : sortedAsc;
    this.sortedGamesCache = {
      sourceGames: games,
      sortField,
      sortDirection,
      sortedGames,
    };
    return sortedGames;
  }

  private pruneNormalizedFilterCache(games: GameEntry[]): void {
    const activeKeys = new Set(games.map(game => this.getGameKey(game)));

    this.normalizedFilterGameByKey.forEach((_value, key) => {
      if (!activeKeys.has(key)) {
        this.normalizedFilterGameByKey.delete(key);
      }
    });
  }

  private getNormalizedFilterGame(game: GameEntry): NormalizedFilterGame {
    const gameKey = this.getGameKey(game);
    const existing = this.normalizedFilterGameByKey.get(gameKey);
    const gameUpdatedAt = typeof game.updatedAt === 'string' ? game.updatedAt : '';

    if (existing && existing.updatedAt === gameUpdatedAt) {
      return existing;
    }

    const normalized: NormalizedFilterGame = {
      updatedAt: gameUpdatedAt,
      titleLower: this.getDisplayTitle(game).toLowerCase(),
      platform: this.getCanonicalPlatformLabel(this.getDisplayPlatformName(game), this.getDisplayPlatformIgdbId(game)),
      collections: new Set(normalizeStringList(game.collections)),
      developers: new Set(normalizeStringList(game.developers)),
      franchises: new Set(normalizeStringList(game.franchises)),
      publishers: new Set(normalizeStringList(game.publishers)),
      genres: new Set(normalizeStringList(game.genres)),
      tagNames: new Set(normalizeStringList((game.tags ?? []).map(tag => tag.name))),
      gameType: game.gameType ?? null,
      status: this.normalizeStatus(game.status),
      rating: this.normalizeRating(game.rating),
      effectiveHltbHours: this.selectEffectiveHltbHours(game),
      releaseDate: this.getDateOnly(game.releaseDate),
    };

    this.normalizedFilterGameByKey.set(gameKey, normalized);
    return normalized;
  }

  private sortGamesByTitleFallback(left: GameEntry, right: GameEntry): number {
    return this.compareTitles(this.getDisplayTitle(left), this.getDisplayTitle(right));
  }

  private compareGames(left: GameEntry, right: GameEntry, sortField: GameListFilters['sortField']): number {
    if (sortField === 'title') {
      return this.sortGamesByTitleFallback(left, right);
    }

    if (sortField === 'platform') {
      const leftPlatform = this.getCanonicalPlatformLabel(this.getDisplayPlatformName(left), this.getDisplayPlatformIgdbId(left)) || 'Unknown platform';
      const rightPlatform = this.getCanonicalPlatformLabel(this.getDisplayPlatformName(right), this.getDisplayPlatformIgdbId(right)) || 'Unknown platform';
      const platformCompare = leftPlatform.localeCompare(rightPlatform, undefined, { sensitivity: 'base' });

      if (platformCompare !== 0) {
        return platformCompare;
      }

      return this.sortGamesByTitleFallback(left, right);
    }

    if (sortField === 'createdAt') {
      const leftCreatedAt = Date.parse(left.createdAt);
      const rightCreatedAt = Date.parse(right.createdAt);
      const leftValid = Number.isNaN(leftCreatedAt) ? null : leftCreatedAt;
      const rightValid = Number.isNaN(rightCreatedAt) ? null : rightCreatedAt;

      if (leftValid !== null && rightValid !== null && leftValid !== rightValid) {
        return leftValid - rightValid;
      }

      if (leftValid !== null && rightValid === null) {
        return -1;
      }

      if (leftValid === null && rightValid !== null) {
        return 1;
      }

      return this.sortGamesByTitleFallback(left, right);
    }

    const leftDate = this.getDateOnly(left.releaseDate);
    const rightDate = this.getDateOnly(right.releaseDate);

    if (leftDate && rightDate) {
      return leftDate.localeCompare(rightDate);
    }

    if (leftDate) {
      return -1;
    }

    if (rightDate) {
      return 1;
    }

    return this.sortGamesByTitleFallback(left, right);
  }

  private compareTitles(leftTitle: string, rightTitle: string): number {
    const normalizedLeft = this.normalizeTitleForSort(leftTitle);
    const normalizedRight = this.normalizeTitleForSort(rightTitle);
    const normalizedCompare = normalizedLeft.localeCompare(normalizedRight, undefined, { sensitivity: 'base' });

    if (normalizedCompare !== 0) {
      return normalizedCompare;
    }

    return leftTitle.localeCompare(rightTitle, undefined, { sensitivity: 'base' });
  }

  private normalizeTitleForSort(title: string): string {
    const normalized = typeof title === 'string' ? title.trim() : '';
    return normalized.replace(/^(?:the|a)\s+/i, '');
  }

  private getDateOnly(releaseDate: string | null): string | null {
    if (typeof releaseDate !== 'string' || releaseDate.length < 10) {
      return null;
    }

    return releaseDate.slice(0, 10);
  }

  private normalizeFilterHours(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return null;
    }

    return Math.round(value * 10) / 10;
  }

  private selectEffectiveHltbHours(game: GameEntry): number | null {
    const main = this.normalizeFilterHours(game.hltbMainHours);

    if (main !== null) {
      return main;
    }

    const mainExtra = this.normalizeFilterHours(game.hltbMainExtraHours);

    if (mainExtra !== null) {
      return mainExtra;
    }

    return this.normalizeFilterHours(game.hltbCompletionistHours);
  }

  private normalizeStatus(value: string | GameStatus | null | undefined): GameStatus | null {
    if (value === 'playing' || value === 'wantToPlay' || value === 'completed' || value === 'paused' || value === 'dropped' || value === 'replay') {
      return value;
    }

    return null;
  }

  private normalizeRating(value: number | string | GameRating | null | undefined): GameRating | null {
    const numeric = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);

    if (numeric === 1 || numeric === 2 || numeric === 3 || numeric === 4 || numeric === 5) {
      return numeric;
    }

    return null;
  }

  private getGameKey(game: GameEntry): string {
    return `${game.igdbGameId}::${game.platformIgdbId}`;
  }

  private getDisplayTitle(game: GameEntry): string {
    const customTitle = typeof game.customTitle === 'string' ? game.customTitle.trim() : '';
    const baseTitle = typeof game.title === 'string' ? game.title.trim() : '';
    return customTitle.length > 0 ? customTitle : baseTitle;
  }

  private getDisplayPlatformName(game: GameEntry): string {
    const customPlatform = typeof game.customPlatform === 'string' ? game.customPlatform.trim() : '';
    const customPlatformIgdbId = this.normalizeOptionalPlatformIgdbId(game.customPlatformIgdbId);

    if (customPlatform.length > 0 && customPlatformIgdbId !== null) {
      return customPlatform;
    }

    return typeof game.platform === 'string' ? game.platform.trim() : '';
  }

  private getDisplayPlatformIgdbId(game: GameEntry): number | null {
    const customPlatform = typeof game.customPlatform === 'string' ? game.customPlatform.trim() : '';
    const customPlatformIgdbId = this.normalizeOptionalPlatformIgdbId(game.customPlatformIgdbId);

    if (customPlatform.length > 0 && customPlatformIgdbId !== null) {
      return customPlatformIgdbId;
    }

    return this.normalizeOptionalPlatformIgdbId(game.platformIgdbId);
  }

  private normalizeOptionalPlatformIgdbId(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
}
