import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCandidate } from './parser.mjs';

test('normalizeCandidate parses CHF amount and discount fields', () => {
  const candidate = normalizeCandidate({
    title: 'Final Fantasy VII Rebirth',
    priceText: 'CHF 59.90',
    oldPriceText: 'CHF 79.90',
    discountText: '-25%',
    url: 'https://psprices.com/region-ch/game/6511946/final-fantasy-vii-rebirth',
    gameId: '6511946'
  });

  assert.ok(candidate);
  assert.equal(candidate.title, 'Final Fantasy VII Rebirth');
  assert.equal(candidate.currency, 'CHF');
  assert.equal(candidate.amount, 59.9);
  assert.equal(candidate.regularAmount, 79.9);
  assert.equal(candidate.discountPercent, 25);
  assert.equal(candidate.isFree, false);
  assert.equal(candidate.gameId, '6511946');
});

test('normalizeCandidate treats free labels as zero amount', () => {
  const candidate = normalizeCandidate({
    title: 'Fortnite',
    priceText: 'Free',
    oldPriceText: '',
    discountText: '',
    url: 'https://psprices.com/region-ch/game/4490375/fortnite-fortnite'
  });

  assert.ok(candidate);
  assert.equal(candidate.currency, null);
  assert.equal(candidate.amount, 0);
  assert.equal(candidate.isFree, true);
});

test('normalizeCandidate handles PS+ text and keeps base amount', () => {
  const candidate = normalizeCandidate({
    title: 'Connect: Pictures of Dog',
    priceText: 'CHF 2.73 2.53 PS+',
    oldPriceText: 'CHF 4.20',
    discountText: '-35%',
    url: 'https://psprices.com/region-ch/game/7800090/connect-pictures-of-dog'
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
    url: 'https://psprices.com/region-ch/game/123/example-game'
  });

  assert.ok(candidate);
  assert.equal(candidate.currency, 'EUR');
  assert.equal(candidate.amount, 19.99);
});
