import { describe, expect, it } from 'vitest';
import { GameWebsite } from '../../core/models/game.models';
import { buildDetailWebsiteModalItems } from './detail-websites-modal.utils';

function makeWebsite(overrides: Partial<GameWebsite> = {}): GameWebsite {
  return {
    provider: null,
    providerLabel: null,
    url: 'https://example.com',
    typeId: null,
    typeName: null,
    trusted: null,
    ...overrides,
  };
}

describe('buildDetailWebsiteModalItems', () => {
  it('prepends google and gamefaqs and sorts remaining websites by type id', () => {
    const items = buildDetailWebsiteModalItems({
      websites: [
        makeWebsite({
          url: 'https://discord.gg/example',
          typeId: 18,
          typeName: 'Discord',
        }),
        makeWebsite({
          url: 'https://www.gog.com/en/game/example',
          typeId: 17,
          typeName: 'GOG',
        }),
        makeWebsite({
          url: 'https://example.com',
          typeId: 1,
          typeName: 'Official Website',
        }),
      ],
      buildSearchUrl: (provider) => `https://search.example/${provider}`,
    });

    expect(items.map((item) => item.label)).toEqual([
      'Google',
      'GameFAQs',
      'Official Website',
      'Wikipedia',
      'YouTube',
      'GOG',
      'Discord',
    ]);
  });

  it('prefers direct wikipedia and youtube links over search fallbacks', () => {
    const items = buildDetailWebsiteModalItems({
      websites: [
        makeWebsite({
          url: 'https://en.wikipedia.org/wiki/Test_game',
          typeId: 3,
          typeName: 'Wikipedia',
        }),
        makeWebsite({
          url: 'https://www.youtube.com/@testgame',
          typeId: 9,
          typeName: 'YouTube',
        }),
      ],
      buildSearchUrl: (provider) => `https://search.example/${provider}`,
    });

    expect(items.find((item) => item.label === 'Wikipedia')?.url).toBe(
      'https://en.wikipedia.org/wiki/Test_game'
    );
    expect(items.find((item) => item.label === 'YouTube')?.url).toBe(
      'https://www.youtube.com/@testgame'
    );
  });

  it('does not duplicate wikipedia or youtube when igdb already supplies them', () => {
    const items = buildDetailWebsiteModalItems({
      websites: [
        makeWebsite({
          url: 'https://en.wikipedia.org/wiki/Test_game',
          typeId: 3,
          typeName: 'Wikipedia',
        }),
        makeWebsite({
          url: 'https://www.youtube.com/@testgame',
          typeId: 9,
          typeName: 'YouTube',
        }),
      ],
      buildSearchUrl: (provider) => `https://search.example/${provider}`,
    });

    expect(items.filter((item) => item.label === 'Wikipedia')).toHaveLength(1);
    expect(items.filter((item) => item.label === 'YouTube')).toHaveLength(1);
  });
});
