import { describe, expect, it } from 'vitest';

import { applyGameCatalogPlatformContext } from './game-catalog-platform-context';
import type { GameCatalogResult } from '../models/game.models';

describe('applyGameCatalogPlatformContext', () => {
  function makeCatalog(overrides: Partial<GameCatalogResult> = {}): GameCatalogResult {
    return {
      igdbGameId: '700',
      title: 'Mass Effect',
      coverUrl: null,
      coverSource: 'igdb',
      platforms: ['Xbox 360', 'PlayStation 3'],
      platformOptions: [
        { id: 12, name: 'Xbox 360' },
        { id: 9, name: 'PlayStation 3' },
      ],
      platform: 'Xbox 360',
      platformIgdbId: 12,
      releaseDate: '2007-11-20T00:00:00.000Z',
      releaseYear: 2007,
      ...overrides,
    };
  }

  it('returns the original catalog when no valid platform context is provided', () => {
    const catalog = makeCatalog();

    expect(applyGameCatalogPlatformContext(catalog, null)).toBe(catalog);
    expect(applyGameCatalogPlatformContext(catalog, undefined)).toBe(catalog);
    expect(applyGameCatalogPlatformContext(catalog, 0)).toBe(catalog);
  });

  it('applies the matching platform option when one exists', () => {
    const contextual = applyGameCatalogPlatformContext(makeCatalog(), 9);

    expect(contextual.platformIgdbId).toBe(9);
    expect(contextual.platform).toBe('PlayStation 3');
  });

  it('prefers the matching platform option label when the requested platform is known', () => {
    const contextual = applyGameCatalogPlatformContext(
      makeCatalog({ platform: 'Custom Xbox 360' }),
      12
    );

    expect(contextual.platformIgdbId).toBe(12);
    expect(contextual.platform).toBe('Xbox 360');
  });

  it('falls back to null platform label when the requested platform is unknown', () => {
    const contextual = applyGameCatalogPlatformContext(makeCatalog(), 999);

    expect(contextual.platformIgdbId).toBe(999);
    expect(contextual.platform).toBeNull();
  });
});
