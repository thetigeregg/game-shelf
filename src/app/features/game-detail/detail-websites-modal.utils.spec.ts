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
  it('prepends google and gamefaqs and sorts remaining allowed websites by type id', () => {
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
    ]);
    expect(items.find((item) => item.label === 'Google')?.icon).toBe('google');
    expect(items.find((item) => item.label === 'GameFAQs')?.icon).toBe('gamefaqs');
    expect(items.find((item) => item.label === 'Official Website')?.icon).toBe('ion:globe');
    expect(items.find((item) => item.label === 'Discord')).toBeUndefined();
  });

  it('filters out social links even when upstream provider metadata is misleading', () => {
    const items = buildDetailWebsiteModalItems({
      websites: [
        makeWebsite({
          url: 'https://www.twitch.tv/directory/category/resident-evil-requiem',
          typeId: 6,
          typeName: 'Twitch',
          provider: 'itch',
          providerLabel: 'itch.io',
        }),
        makeWebsite({
          url: 'https://residentevil.fandom.com/wiki/Resident_Evil_Requiem',
          typeId: 2,
          typeName: 'Community Wiki',
        }),
        makeWebsite({
          url: 'https://www.residentevil.com/requiem/en-us/',
          typeId: 1,
          typeName: 'Official Website',
        }),
        makeWebsite({
          url: 'https://store.playstation.com/en-us/concept/10015533/',
          typeId: 23,
          typeName: 'Playstation',
        }),
      ],
      buildSearchUrl: (provider) => `https://search.example/${provider}`,
    });

    expect(items.map((item) => item.label)).toEqual([
      'Google',
      'GameFAQs',
      'Official Website',
      'Community Wiki',
      'Wikipedia',
      'YouTube',
      'Playstation',
    ]);
    expect(items.find((item) => item.label === 'Twitch')).toBeUndefined();
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
    expect(items.find((item) => item.label === 'Wikipedia')?.icon).toBe('wikipedia');
    expect(items.find((item) => item.label === 'YouTube')?.icon).toBe('youtube');
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

  it('assigns simple-icon brands for supported allowed website types', () => {
    const items = buildDetailWebsiteModalItems({
      websites: [
        makeWebsite({
          url: 'https://www.nintendo.com/us/store/products/test-game-switch/',
          typeId: 1,
          typeName: 'Official Website',
        }),
        makeWebsite({
          url: 'https://www.xbox.com/en-US/games/store/test-game/9NBLGGH12345',
          typeId: 1,
          typeName: 'Official Website',
        }),
        makeWebsite({
          url: 'https://gamefaqs.gamespot.com/switch/123456-test-game',
          typeName: 'GameFAQs',
        }),
        makeWebsite({
          url: 'https://store.steampowered.com/app/123',
          typeId: 13,
          typeName: 'Steam',
        }),
        makeWebsite({
          url: 'https://store.epicgames.com/en-US/p/test',
          typeId: 16,
          typeName: 'Epic',
        }),
        makeWebsite({
          url: 'https://www.playstation.com/en-us/games/test/',
          typeId: 23,
          typeName: 'PlayStation',
        }),
        makeWebsite({
          url: 'https://apps.apple.com/us/app/test/id123',
          typeId: 10,
          typeName: 'App Store (iPhone)',
        }),
        makeWebsite({
          url: 'https://play.google.com/store/apps/details?id=test',
          typeId: 12,
          typeName: 'Google Play',
        }),
        makeWebsite({ url: 'https://test.itch.io/game', typeId: 15, typeName: 'Itch' }),
        makeWebsite({ url: 'https://www.gog.com/en/game/test', typeId: 17, typeName: 'GOG' }),
      ],
      buildSearchUrl: (provider) => `https://search.example/${provider}`,
    });

    expect(items.find((item) => item.url.includes('nintendo.com'))?.icon).toBe('nintendo');
    expect(items.find((item) => item.url.includes('xbox.com'))?.icon).toBe('xbox');
    expect(items.find((item) => item.label === 'Steam')?.icon).toBe('steam');
    expect(items.find((item) => item.label === 'Epic')?.icon).toBe('epicgames');
    expect(items.find((item) => item.label === 'PlayStation')?.icon).toBe('playstation');
    expect(items.find((item) => item.label === 'App Store (iPhone)')?.icon).toBe('appstore');
    expect(items.find((item) => item.label === 'Google Play')?.icon).toBe('googleplay');
    expect(items.find((item) => item.label === 'Itch')?.icon).toBe('itchdotio');
    expect(items.find((item) => item.label === 'GOG')?.icon).toBe('gogdotcom');
  });
});
