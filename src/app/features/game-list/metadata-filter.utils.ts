import {
  DEFAULT_GAME_LIST_FILTERS,
  GameEntry,
  GameListFilters
} from '../../core/models/game.models';

export type MetadataFilterKind = 'series' | 'developer' | 'franchise' | 'genre' | 'publisher';

export interface MetadataFilterSelection {
  kind: MetadataFilterKind;
  value: string;
}

export function getMetadataSelectionTitle(kind: MetadataFilterKind): string {
  if (kind === 'series') {
    return 'Select Series';
  }

  if (kind === 'developer') {
    return 'Select Developer';
  }

  if (kind === 'franchise') {
    return 'Select Franchise';
  }

  if (kind === 'genre') {
    return 'Select Genre';
  }

  return 'Select Publisher';
}

export function getMetadataSelectionValues(
  game: Pick<GameEntry, 'collections' | 'developers' | 'franchises' | 'genres' | 'publishers'>,
  kind: MetadataFilterKind
): string[] | undefined {
  if (kind === 'series') {
    return game.collections;
  }

  if (kind === 'developer') {
    return game.developers;
  }

  if (kind === 'franchise') {
    return game.franchises;
  }

  if (kind === 'genre') {
    return game.genres;
  }

  return game.publishers;
}

export function applyMetadataSelectionToFilters(
  selection: MetadataFilterSelection,
  defaultFilters: GameListFilters = DEFAULT_GAME_LIST_FILTERS
): GameListFilters {
  const normalized = typeof selection.value === 'string' ? selection.value.trim() : '';

  if (normalized.length === 0) {
    return {
      ...defaultFilters
    };
  }

  const nextFilters: GameListFilters = {
    ...defaultFilters
  };

  if (selection.kind === 'series') {
    nextFilters.collections = [normalized];
  } else if (selection.kind === 'developer') {
    nextFilters.developers = [normalized];
  } else if (selection.kind === 'franchise') {
    nextFilters.franchises = [normalized];
  } else if (selection.kind === 'genre') {
    nextFilters.genres = [normalized];
  } else {
    nextFilters.publishers = [normalized];
  }

  return nextFilters;
}
