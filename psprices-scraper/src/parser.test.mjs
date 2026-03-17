import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { normalizeCandidate } from './parser.mjs';
import { extractResultCardImageUrl } from './search-dom.mjs';

test('normalizeCandidate parses CHF amount and discount fields', () => {
  const candidate = normalizeCandidate({
    title: 'Final Fantasy VII Rebirth',
    priceText: 'CHF 59.90',
    oldPriceText: 'CHF 79.90',
    discountText: '-25%',
    url: 'https://psprices.com/region-ch/game/6511946/final-fantasy-vii-rebirth',
    gameId: '6511946',
    collectionTagCount: 2,
    hasMostEngagingTag: 'true',
    metacriticScore: '92',
    openCriticScore: '91',
  });

  assert.ok(candidate);
  assert.equal(candidate.title, 'Final Fantasy VII Rebirth');
  assert.equal(candidate.currency, 'CHF');
  assert.equal(candidate.amount, 59.9);
  assert.equal(candidate.regularAmount, 79.9);
  assert.equal(candidate.discountPercent, 25);
  assert.equal(candidate.isFree, false);
  assert.equal(candidate.gameId, '6511946');
  assert.equal(candidate.collectionTagCount, 2);
  assert.equal(candidate.hasMostEngagingTag, true);
  assert.equal(candidate.metacriticScore, 92);
  assert.equal(candidate.openCriticScore, 91);
});

test('normalizeCandidate treats free labels as zero amount', () => {
  const candidate = normalizeCandidate({
    title: 'Fortnite',
    priceText: 'Free',
    oldPriceText: '',
    discountText: '',
    url: 'https://psprices.com/region-ch/game/4490375/fortnite-fortnite',
  });

  assert.ok(candidate);
  assert.equal(candidate.currency, null);
  assert.equal(candidate.amount, 0);
  assert.equal(candidate.isFree, true);
});

test('normalizeCandidate treats localized free labels as zero amount', () => {
  const candidate = normalizeCandidate({
    title: 'Fortnite',
    priceText: 'Kostenlos',
    oldPriceText: '',
    discountText: '',
    url: 'https://psprices.com/region-us/game/6764113/fortnite-battle-royale',
  });

  assert.ok(candidate);
  assert.equal(candidate.amount, 0);
  assert.equal(candidate.isFree, true);
});

test('normalizeCandidate handles PS+ text and keeps base amount', () => {
  const candidate = normalizeCandidate({
    title: 'Connect: Pictures of Dog',
    priceText: 'CHF 2.73 2.53 PS+',
    oldPriceText: 'CHF 4.20',
    discountText: '-35%',
    url: 'https://psprices.com/region-ch/game/7800090/connect-pictures-of-dog',
  });

  assert.ok(candidate);
  assert.equal(candidate.currency, 'CHF');
  assert.equal(candidate.amount, 2.73);
  assert.equal(candidate.regularAmount, 4.2);
  assert.equal(candidate.discountPercent, 35);
  assert.equal(candidate.gameId, '7800090');
});

test('normalizeCandidate can infer currency from symbols', () => {
  const candidate = normalizeCandidate({
    title: 'Example Game',
    priceText: '\u20ac19.99',
    oldPriceText: '',
    discountText: '',
    url: 'https://psprices.com/region-ch/game/123/example-game',
  });

  assert.ok(candidate);
  assert.equal(candidate.currency, 'EUR');
  assert.equal(candidate.amount, 19.99);
});

test('normalizeCandidate keeps normalized cover image URLs when present', () => {
  const candidate = normalizeCandidate({
    title: 'Example Game',
    priceText: 'CHF 19.99',
    imageUrl: '//image.api.playstation.com/example.jpg',
    url: 'https://psprices.com/region-ch/game/123/example-game',
  });

  assert.ok(candidate);
  assert.equal(candidate.imageUrl, 'https://image.api.playstation.com/example.jpg');
});

test('extractResultCardImageUrl prefers the game card cover image node', () => {
  const dom = new JSDOM(`
    <main>
      <div class="game-fragment group flex flex-col text-sm mb-12">
        <div class="relative">
          <img src="https://cdn.psprices.com/unrelated-badge.png" alt="Badge" />
          <a class="flex flex-col gap-1 relative z-10 rounded text-text" href="/region-ch/game/1234/sonic-frontiers">
            <div class="card-wrapper relative border border-border rounded overflow-clip">
              <div class="relative">
                <div class="relative overflow-hidden aspect-square">
                  <img
                    class="relative z-10 w-full h-full object-contain rounded-b-sm"
                    src="https://image.api.playstation.com/vulcan/ap/rnd/202208/0519/G9fDIHISfuLRt7CQ0AfNxlJX.png"
                    alt="Sonic Frontiers"
                  />
                </div>
              </div>
            </div>
          </a>
        </div>
      </div>
    </main>
  `);

  const card = dom.window.document.querySelector('.game-fragment');
  assert.ok(card);
  assert.equal(
    extractResultCardImageUrl(card),
    'https://image.api.playstation.com/vulcan/ap/rnd/202208/0519/G9fDIHISfuLRt7CQ0AfNxlJX.png'
  );
});

test('extractResultCardImageUrl ignores platform icons inside the card wrapper', () => {
  const dom = new JSDOM(`
    <main>
      <div class="game-fragment group flex flex-col text-sm mb-12">
        <div class="relative">
          <a class="flex flex-col gap-1 relative z-10 rounded text-text" href="/region-ch/game/5425192/sonic-frontiers">
            <div class="card-wrapper relative border border-border rounded overflow-clip">
              <span class="h-6 px-1.5 rounded-t flex items-center justify-between">
                <img src="https://psprices.com/staticfiles/i/platforms-unified/ps4.svg" alt="PlayStation 4" class="h-3 invert" />
                <img src="https://psprices.com/staticfiles/i/platforms-unified/ps5.svg" alt="PlayStation 5" class="h-3 invert" />
              </span>
              <div class="relative">
                <div class="relative overflow-hidden aspect-square">
                  <img
                    src="https://image.api.playstation.com/vulcan/ap/rnd/202208/0519/G9fDIHISfuLRt7CQ0AfNxlJX.png"
                    alt=""
                    class="absolute inset-0 h-full w-full object-cover blur-xl"
                  />
                  <img
                    class="relative z-10 w-full h-full object-contain rounded-b-sm"
                    src="https://image.api.playstation.com/vulcan/ap/rnd/202208/0519/G9fDIHISfuLRt7CQ0AfNxlJX.png"
                    alt="Sonic Frontiers"
                  />
                </div>
              </div>
            </div>
          </a>
        </div>
      </div>
    </main>
  `);

  const card = dom.window.document.querySelector('.game-fragment');
  assert.ok(card);
  assert.equal(
    extractResultCardImageUrl(card),
    'https://image.api.playstation.com/vulcan/ap/rnd/202208/0519/G9fDIHISfuLRt7CQ0AfNxlJX.png'
  );
});
