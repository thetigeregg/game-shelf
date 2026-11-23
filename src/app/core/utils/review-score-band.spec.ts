import { describe, expect, it } from 'vitest';
import { getReviewScoreBand } from './review-score-band';

describe('getReviewScoreBand', () => {
  it('bands scores at 75 and 50', () => {
    expect(getReviewScoreBand(100)).toBe('mc-good');
    expect(getReviewScoreBand(75)).toBe('mc-good');
    expect(getReviewScoreBand(74.9)).toBe('mc-okay');
    expect(getReviewScoreBand(50)).toBe('mc-okay');
    expect(getReviewScoreBand(49)).toBe('mc-bad');
    expect(getReviewScoreBand(1)).toBe('mc-bad');
  });
});
