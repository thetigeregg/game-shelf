import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIgdbWebsites } from '../../shared/igdb-websites-normalization.mjs';

function normalizeSingleWebsite(entry) {
  const [normalized] = normalizeIgdbWebsites({ websites: [entry] });
  return normalized ?? null;
}

test('normalizeIgdbWebsites maps all whitelisted website hosts to the expected providers', () => {
  const cases = [
    {
      name: 'Steam store',
      url: 'https://store.steampowered.com/app/123/Test_Game/',
      expectedProvider: 'steam',
      expectedLabel: 'Steam',
    },
    {
      name: 'PlayStation store',
      url: 'https://store.playstation.com/en-us/concept/10015533/',
      expectedProvider: 'playstation',
      expectedLabel: 'PlayStation',
    },
    {
      name: 'Xbox store',
      url: 'https://www.xbox.com/en-us/games/store/test-game/9TEST',
      expectedProvider: 'xbox',
      expectedLabel: 'Xbox',
    },
    {
      name: 'Microsoft store path',
      url: 'https://www.microsoft.com/en-us/store/apps/9TEST',
      expectedProvider: 'xbox',
      expectedLabel: 'Xbox',
    },
    {
      name: 'Nintendo store',
      url: 'https://www.nintendo.com/us/store/products/test-game-switch-2/',
      expectedProvider: 'nintendo',
      expectedLabel: 'Nintendo',
    },
    {
      name: 'Nintendo Europe',
      url: 'https://www.nintendo-europe.com/Games/Nintendo-Switch-2-games/Test-Game-1234567.html',
      expectedProvider: 'nintendo',
      expectedLabel: 'Nintendo',
    },
    {
      name: 'Epic Games Store',
      url: 'https://store.epicgames.com/en-US/p/test-game',
      expectedProvider: 'epic',
      expectedLabel: 'Epic Games Store',
    },
    {
      name: 'GOG',
      url: 'https://www.gog.com/en/game/test_game',
      expectedProvider: 'gog',
      expectedLabel: 'GOG',
    },
    {
      name: 'itch.io',
      url: 'https://teststudio.itch.io/test-game',
      expectedProvider: 'itch',
      expectedLabel: 'itch.io',
    },
    {
      name: 'Apple App Store',
      url: 'https://apps.apple.com/us/app/test-game/id123456',
      expectedProvider: 'apple',
      expectedLabel: 'Apple App Store',
    },
    {
      name: 'Google Play',
      url: 'https://play.google.com/store/apps/details?id=com.example.test',
      expectedProvider: 'android',
      expectedLabel: 'Google Play',
    },
    {
      name: 'Amazon',
      url: 'https://www.amazon.com/dp/B012345678',
      expectedProvider: 'amazon',
      expectedLabel: 'Amazon',
    },
    {
      name: 'Meta app path',
      url: 'https://www.meta.com/experiences/test-game/1234567890/',
      expectedProvider: 'oculus',
      expectedLabel: 'Meta Quest',
    },
    {
      name: 'Oculus app path',
      url: 'https://www.oculus.com/experiences/quest/1234567890/',
      expectedProvider: 'oculus',
      expectedLabel: 'Meta Quest',
    },
    {
      name: 'Utomik',
      url: 'https://www.utomik.com/games/test-game',
      expectedProvider: 'utomik',
      expectedLabel: 'Utomik',
    },
    {
      name: 'Game Jolt',
      url: 'https://gamejolt.com/games/test-game/123456',
      expectedProvider: 'gamejolt',
      expectedLabel: 'Game Jolt',
    },
    {
      name: 'Kartridge',
      url: 'https://www.kartridge.com/games/test/test-game',
      expectedProvider: 'kartridge',
      expectedLabel: 'Kartridge',
    },
  ];

  for (const testCase of cases) {
    const normalized = normalizeSingleWebsite({ url: testCase.url });

    assert.ok(normalized, `${testCase.name} should normalize`);
    assert.equal(normalized.provider, testCase.expectedProvider, testCase.name);
    assert.equal(normalized.providerLabel, testCase.expectedLabel, testCase.name);
    assert.equal(normalized.url, testCase.url);
    assert.equal(normalized.typeId, null);
    assert.equal(normalized.typeName, null);
  }
});

test('normalizeIgdbWebsites does not misclassify non-whitelisted urls as store providers', () => {
  const cases = [
    {
      name: 'Twitch directory',
      entry: {
        type: 6,
        url: 'https://www.twitch.tv/directory/category/resident-evil-requiem',
      },
      expectedTypeName: 'Twitch',
    },
    {
      name: 'Microsoft non-store page',
      entry: {
        url: 'https://www.microsoft.com/en-us/gaming',
      },
      expectedTypeName: null,
    },
    {
      name: 'Meta homepage without app path',
      entry: {
        url: 'https://www.meta.com/',
      },
      expectedTypeName: null,
    },
  ];

  for (const testCase of cases) {
    const normalized = normalizeSingleWebsite(testCase.entry);

    assert.ok(normalized, `${testCase.name} should normalize`);
    assert.equal(normalized.provider, null, testCase.name);
    assert.equal(normalized.providerLabel, null, testCase.name);
    assert.equal(normalized.typeName, testCase.expectedTypeName, testCase.name);
  }
});

test('normalizeIgdbWebsites distinguishes Twitch and itch website type names', () => {
  const twitch = normalizeSingleWebsite({
    type: 6,
    url: 'https://www.twitch.tv/testgame',
  });
  const itch = normalizeSingleWebsite({
    type: 15,
    url: 'https://teststudio.itch.io/test-game',
  });

  assert.deepEqual(
    {
      provider: twitch?.provider ?? null,
      providerLabel: twitch?.providerLabel ?? null,
      typeId: twitch?.typeId ?? null,
      typeName: twitch?.typeName ?? null,
    },
    {
      provider: null,
      providerLabel: null,
      typeId: 6,
      typeName: 'Twitch',
    }
  );

  assert.deepEqual(
    {
      provider: itch?.provider ?? null,
      providerLabel: itch?.providerLabel ?? null,
      typeId: itch?.typeId ?? null,
      typeName: itch?.typeName ?? null,
    },
    {
      provider: 'itch',
      providerLabel: 'itch.io',
      typeId: 15,
      typeName: 'Itch',
    }
  );
});
