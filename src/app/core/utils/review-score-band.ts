export type ReviewScoreBand = 'mc-good' | 'mc-okay' | 'mc-bad';

/**
 * Metacritic's colour bands for a 0–100 review score: good from 75, okay from 50, bad
 * below. The class names match the `--ion-color-mc-*` theme colours.
 */
export function getReviewScoreBand(scoreOutOf100: number): ReviewScoreBand {
  if (scoreOutOf100 >= 75) {
    return 'mc-good';
  }

  if (scoreOutOf100 >= 50) {
    return 'mc-okay';
  }

  return 'mc-bad';
}
