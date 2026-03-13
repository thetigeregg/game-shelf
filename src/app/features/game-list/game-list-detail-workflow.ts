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
    const key = `${candidate.title}::${String(candidate.releaseYear ?? '')}::${candidate.platform ?? ''}::${String(candidate.hltbGameId ?? '')}::${candidate.hltbUrl ?? ''}`;

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
    reviewUrl?: string | null;
    metacriticUrl?: string | null;
    imageUrl?: string | null;
    reviewScore?: number | null;
    metacriticScore?: number | null;
  }
>(candidates: T[]): T[] {
  const deduped: T[] = [];

  candidates.forEach((candidate) => {
    const candidateIdentityUrl = candidate.reviewUrl ?? candidate.metacriticUrl ?? '';
    const existingIndex = deduped.findIndex((entry) => {
      if (
        entry.title !== candidate.title ||
        entry.releaseYear !== candidate.releaseYear ||
        entry.platform !== candidate.platform
      ) {
        return false;
      }

      const entryIdentityUrl = entry.reviewUrl ?? entry.metacriticUrl ?? '';
      return (
        entryIdentityUrl === candidateIdentityUrl ||
        entryIdentityUrl.length === 0 ||
        candidateIdentityUrl.length === 0
      );
    });
    if (existingIndex === -1) {
      deduped.push(candidate);
      return;
    }

    const existing = deduped[existingIndex];
    const existingScore = existing.reviewScore ?? existing.metacriticScore ?? null;
    const candidateScore = candidate.reviewScore ?? candidate.metacriticScore ?? null;
    const shouldReplace =
      (existing.imageUrl == null && candidate.imageUrl != null) ||
      (existingScore == null && candidateScore != null);

    if (shouldReplace) {
      deduped[existingIndex] = candidate;
    }
  });

  return deduped;
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
