import { NormalizedGameRecord, RecommendationTarget } from './types.js';

const BACKLOG_ALLOWED = new Set<NormalizedGameRecord['status']>([null, 'wantToPlay']);
const BACKLOG_EXCLUDED = new Set<NormalizedGameRecord['status']>([
  'completed',
  'dropped',
  'playing',
  'paused',
  'replay'
]);
const WISHLIST_EXCLUDED = new Set<NormalizedGameRecord['status']>(['completed', 'dropped']);

export function selectCandidates(
  games: NormalizedGameRecord[],
  target: RecommendationTarget
): NormalizedGameRecord[] {
  if (target === 'BACKLOG') {
    return games.filter((game) => {
      if (game.listType !== 'collection') {
        return false;
      }

      if (BACKLOG_EXCLUDED.has(game.status)) {
        return false;
      }

      return BACKLOG_ALLOWED.has(game.status);
    });
  }

  return games.filter((game) => {
    if (game.listType !== 'wishlist') {
      return false;
    }

    return !WISHLIST_EXCLUDED.has(game.status);
  });
}
