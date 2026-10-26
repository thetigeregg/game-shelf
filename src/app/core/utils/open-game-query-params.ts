/** Query params a list page (`/tabs/wishlist`, `/tabs/collection`) reads to open a
 * game's detail on arrival — set by NotificationService for tapped push notifications. */
export const OPEN_GAME_QUERY_PARAM = 'openGame';
export const OPEN_GAME_PLATFORM_QUERY_PARAM = 'openGamePlatform';

/** Parses an open-game platform id, or null unless the whole value is a positive
 * integer (rejects `'167junk'`, `'167.5'`, `'0x10'`, `'1e2'`, which `parseInt`/`Number` would accept). */
export function parseOpenGamePlatformId(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
