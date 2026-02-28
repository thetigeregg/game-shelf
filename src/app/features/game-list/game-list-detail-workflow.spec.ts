import { describe, expect, it } from 'vitest';

import type {
  GameEntry,
  HltbMatchCandidate,
  MetacriticMatchCandidate,
  ReviewMatchCandidate
} from '../../core/models/game.models';
import {
  createClosedHltbPickerState,
  createClosedImagePickerState,
  createClosedMetacriticPickerState,
  createClosedReviewPickerState,
  createOpenedHltbPickerState,
  createOpenedImagePickerState,
  createOpenedMetacriticPickerState,
  createOpenedReviewPickerState,
  dedupeHltbCandidates,
  dedupeMetacriticCandidates,
  dedupeReviewCandidates,
  normalizeMetadataOptions
} from './game-list-detail-workflow';

function makeGame(overrides: Partial<GameEntry> = {}): GameEntry {
  return {
    igdbGameId: '1',
    title: 'Chrono Trigger',
    coverUrl: null,
    coverSource: 'none',
    platform: 'SNES',
    platformIgdbId: 19,
    releaseDate: null,
    releaseYear: 1995,
    listType: 'collection',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('game-list-detail-workflow', () => {
  it('normalizes metadata options by trimming and deduping', () => {
    expect(normalizeMetadataOptions(undefined)).toEqual([]);
    expect(normalizeMetadataOptions([' Action ', 'Action', '', '  ', 'RPG'])).toEqual([
      'Action',
      'RPG'
    ]);
  });

  it('dedupes hltb candidates by title/year/platform key', () => {
    const first: HltbMatchCandidate = {
      title: 'Chrono Trigger',
      releaseYear: 1995,
      platform: 'SNES',
      hltbMainHours: 25,
      hltbMainExtraHours: 30,
      hltbCompletionistHours: 40
    };
    const duplicate = { ...first, hltbMainHours: 26 };
    const other = { ...first, platform: 'DS' };

    const result = dedupeHltbCandidates([first, duplicate, other]);
    expect(result).toEqual([first, other]);
  });

  it('opens and closes image picker state', () => {
    expect(createOpenedImagePickerState(7, 'Query')).toEqual({
      imagePickerSearchRequestId: 7,
      imagePickerQuery: 'Query',
      imagePickerResults: [],
      imagePickerError: null,
      isImagePickerLoading: false,
      isImagePickerModalOpen: true
    });

    expect(createClosedImagePickerState(7)).toEqual({
      imagePickerSearchRequestId: 8,
      imagePickerQuery: '',
      imagePickerResults: [],
      imagePickerError: null,
      isImagePickerLoading: false,
      isImagePickerModalOpen: false
    });
  });

  it('opens and closes hltb picker state', () => {
    const game = makeGame({ title: 'EarthBound' });
    expect(createOpenedHltbPickerState(game)).toMatchObject({
      isHltbPickerModalOpen: true,
      hasHltbPickerSearched: false,
      hltbPickerQuery: 'EarthBound',
      hltbPickerTargetGame: game
    });
    expect(createClosedHltbPickerState()).toMatchObject({
      isHltbPickerModalOpen: false,
      hltbPickerQuery: '',
      hltbPickerTargetGame: null
    });
  });

  it('dedupes review candidates and prefers image/score completion', () => {
    const original: ReviewMatchCandidate = {
      title: 'Chrono Trigger',
      releaseYear: 1995,
      platform: 'SNES',
      reviewScore: null,
      reviewUrl: null,
      reviewSource: 'mobygames',
      imageUrl: null
    };
    const upgraded: ReviewMatchCandidate = {
      ...original,
      imageUrl: 'https://example.com/front.jpg'
    };

    const result = dedupeReviewCandidates([original, upgraded]);
    expect(result).toEqual([upgraded]);
  });

  it('dedupes review candidates with different scores and prefers the scored one', () => {
    const noScore: ReviewMatchCandidate = {
      title: 'Chrono Trigger',
      releaseYear: 1995,
      platform: 'SNES',
      reviewScore: null,
      reviewUrl: null,
      reviewSource: 'mobygames',
      imageUrl: null
    };
    const withScore: ReviewMatchCandidate = {
      ...noScore,
      reviewScore: 85,
      reviewUrl: 'https://example.com/review'
    };

    expect(dedupeReviewCandidates([noScore, withScore])).toEqual([withScore]);
    expect(dedupeReviewCandidates([withScore, noScore])).toEqual([withScore]);
  });

  it('dedupes metacritic candidates through generic review dedupe', () => {
    const original: MetacriticMatchCandidate = {
      title: 'Chrono Trigger',
      releaseYear: 1995,
      platform: 'DS',
      metacriticScore: null,
      metacriticUrl: null,
      imageUrl: null
    };
    const upgraded: MetacriticMatchCandidate = {
      ...original,
      imageUrl: 'https://example.com/ct.jpg'
    };
    expect(dedupeMetacriticCandidates([original, upgraded])).toEqual([upgraded]);
  });

  it('opens and closes review and metacritic pickers', () => {
    const game = makeGame({ title: 'Super Metroid' });
    expect(createOpenedReviewPickerState(game)).toMatchObject({
      isReviewPickerModalOpen: true,
      reviewPickerQuery: 'Super Metroid',
      reviewPickerTargetGame: game
    });
    expect(createClosedReviewPickerState()).toMatchObject({
      isReviewPickerModalOpen: false,
      reviewPickerQuery: '',
      reviewPickerTargetGame: null
    });

    expect(createOpenedMetacriticPickerState(game)).toMatchObject({
      isMetacriticPickerModalOpen: true,
      metacriticPickerQuery: 'Super Metroid',
      metacriticPickerTargetGame: game
    });
    expect(createClosedMetacriticPickerState()).toMatchObject({
      isMetacriticPickerModalOpen: false,
      metacriticPickerQuery: '',
      metacriticPickerTargetGame: null
    });
  });
});
