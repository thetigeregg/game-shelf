import {
  GameEntry,
  HltbMatchCandidate,
  MetacriticMatchCandidate,
  ReviewMatchCandidate
} from '../../core/models/game.models';

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

export interface MetacriticPickerState {
  isMetacriticPickerModalOpen: boolean;
  isMetacriticPickerLoading: boolean;
  hasMetacriticPickerSearched: boolean;
  metacriticPickerQuery: string;
  metacriticPickerResults: MetacriticMatchCandidate[];
  metacriticPickerError: string | null;
  metacriticPickerTargetGame: GameEntry | null;
}

export interface ReviewPickerState {
  isReviewPickerModalOpen: boolean;
  isReviewPickerLoading: boolean;
  hasReviewPickerSearched: boolean;
  reviewPickerQuery: string;
  reviewPickerResults: ReviewMatchCandidate[];
  reviewPickerError: string | null;
  reviewPickerTargetGame: GameEntry | null;
}

export function normalizeMetadataOptions(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return [
    ...new Set(
      values
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0)
    )
  ];
}

export function dedupeHltbCandidates(candidates: HltbMatchCandidate[]): HltbMatchCandidate[] {
  const byKey = new Map<string, HltbMatchCandidate>();

  candidates.forEach((candidate) => {
    const key = `${candidate.title}::${String(candidate.releaseYear ?? '')}::${candidate.platform ?? ''}`;

    if (!byKey.has(key)) {
      byKey.set(key, candidate);
    }
  });

  return [...byKey.values()];
}

export function createOpenedImagePickerState(
  previousRequestId: number,
  title: string
): ImagePickerState {
  return {
    imagePickerSearchRequestId: previousRequestId,
    imagePickerQuery: title,
    imagePickerResults: [],
    imagePickerError: null,
    isImagePickerLoading: false,
    isImagePickerModalOpen: true
  };
}

export function createClosedImagePickerState(previousRequestId: number): ImagePickerState {
  return {
    imagePickerSearchRequestId: previousRequestId + 1,
    imagePickerQuery: '',
    imagePickerResults: [],
    imagePickerError: null,
    isImagePickerLoading: false,
    isImagePickerModalOpen: false
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
    hltbPickerTargetGame: game
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
    hltbPickerTargetGame: null
  };
}

export function dedupeMetacriticCandidates(
  candidates: MetacriticMatchCandidate[]
): MetacriticMatchCandidate[] {
  return dedupeReviewCandidates(candidates);
}

export function dedupeReviewCandidates<
  T extends {
    title: string;
    releaseYear: number | null;
    platform: string | null;
    reviewScore?: number | null;
    metacriticScore?: number | null;
  }
>(candidates: T[]): T[] {
  const byKey = new Map<string, T>();

  candidates.forEach((candidate) => {
    const key = `${candidate.title}::${String(candidate.releaseYear ?? '')}::${candidate.platform ?? ''}::${String(candidate.reviewScore ?? candidate.metacriticScore ?? '')}`;

    if (!byKey.has(key)) {
      byKey.set(key, candidate);
    }
  });

  return [...byKey.values()];
}

export function createOpenedMetacriticPickerState(game: GameEntry): MetacriticPickerState {
  const nextState = createOpenedReviewPickerState(game);
  return {
    isMetacriticPickerModalOpen: nextState.isReviewPickerModalOpen,
    isMetacriticPickerLoading: nextState.isReviewPickerLoading,
    hasMetacriticPickerSearched: nextState.hasReviewPickerSearched,
    metacriticPickerQuery: nextState.reviewPickerQuery,
    metacriticPickerResults: nextState.reviewPickerResults as MetacriticMatchCandidate[],
    metacriticPickerError: nextState.reviewPickerError,
    metacriticPickerTargetGame: nextState.reviewPickerTargetGame
  };
}

export function createOpenedReviewPickerState(game: GameEntry): ReviewPickerState {
  return {
    isReviewPickerModalOpen: true,
    isReviewPickerLoading: false,
    hasReviewPickerSearched: false,
    reviewPickerQuery: game.title,
    reviewPickerResults: [],
    reviewPickerError: null,
    reviewPickerTargetGame: game
  };
}

export function createClosedMetacriticPickerState(): MetacriticPickerState {
  const nextState = createClosedReviewPickerState();
  return {
    isMetacriticPickerModalOpen: nextState.isReviewPickerModalOpen,
    isMetacriticPickerLoading: nextState.isReviewPickerLoading,
    hasMetacriticPickerSearched: nextState.hasReviewPickerSearched,
    metacriticPickerQuery: nextState.reviewPickerQuery,
    metacriticPickerResults: nextState.reviewPickerResults as MetacriticMatchCandidate[],
    metacriticPickerError: nextState.reviewPickerError,
    metacriticPickerTargetGame: nextState.reviewPickerTargetGame
  };
}

export function createClosedReviewPickerState(): ReviewPickerState {
  return {
    isReviewPickerModalOpen: false,
    isReviewPickerLoading: false,
    hasReviewPickerSearched: false,
    reviewPickerQuery: '',
    reviewPickerResults: [],
    reviewPickerError: null,
    reviewPickerTargetGame: null
  };
}
