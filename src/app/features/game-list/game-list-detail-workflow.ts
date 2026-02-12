import { GameEntry, HltbMatchCandidate } from '../../core/models/game.models';

export interface ImagePickerState {
  imagePickerSearchRequestId: number;
  imagePickerQuery: string;
  imagePickerResults: string[];
  imagePickerError: string | null;
  isImagePickerLoading: boolean;
  isImagePickerModalOpen: boolean;
}

export interface HltbPickerState {
  isHltbPickerModalOpen: boolean;
  isHltbPickerLoading: boolean;
  hasHltbPickerSearched: boolean;
  hltbPickerQuery: string;
  hltbPickerResults: HltbMatchCandidate[];
  hltbPickerError: string | null;
  hltbPickerTargetGame: GameEntry | null;
}

export function normalizeMetadataOptions(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(
    values
      .map(value => (typeof value === 'string' ? value.trim() : ''))
      .filter(value => value.length > 0),
  )];
}

export function dedupeHltbCandidates(candidates: HltbMatchCandidate[]): HltbMatchCandidate[] {
  const byKey = new Map<string, HltbMatchCandidate>();

  candidates.forEach(candidate => {
    const key = `${candidate.title}::${candidate.releaseYear ?? ''}::${candidate.platform ?? ''}`;

    if (!byKey.has(key)) {
      byKey.set(key, candidate);
    }
  });

  return [...byKey.values()];
}

export function createOpenedImagePickerState(previousRequestId: number, title: string): ImagePickerState {
  return {
    imagePickerSearchRequestId: previousRequestId,
    imagePickerQuery: title,
    imagePickerResults: [],
    imagePickerError: null,
    isImagePickerLoading: false,
    isImagePickerModalOpen: true,
  };
}

export function createClosedImagePickerState(previousRequestId: number): ImagePickerState {
  return {
    imagePickerSearchRequestId: previousRequestId + 1,
    imagePickerQuery: '',
    imagePickerResults: [],
    imagePickerError: null,
    isImagePickerLoading: false,
    isImagePickerModalOpen: false,
  };
}

export function createOpenedHltbPickerState(game: GameEntry): HltbPickerState {
  return {
    isHltbPickerModalOpen: true,
    isHltbPickerLoading: false,
    hasHltbPickerSearched: false,
    hltbPickerQuery: game.title,
    hltbPickerResults: [],
    hltbPickerError: null,
    hltbPickerTargetGame: game,
  };
}

export function createClosedHltbPickerState(): HltbPickerState {
  return {
    isHltbPickerModalOpen: false,
    isHltbPickerLoading: false,
    hasHltbPickerSearched: false,
    hltbPickerQuery: '',
    hltbPickerResults: [],
    hltbPickerError: null,
    hltbPickerTargetGame: null,
  };
}
