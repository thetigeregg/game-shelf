import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePreferredPsPricesUrl, resolvePreferredPsPricesUrl } from './psprices-url.js';

void test('normalizePreferredPsPricesUrl canonicalizes accepted psprices urls', () => {
  assert.equal(
    normalizePreferredPsPricesUrl('//www.psprices.com/region-ch/game/123/night-in-the-woods'),
    'https://psprices.com/region-ch/game/123/night-in-the-woods'
  );
  assert.equal(
    normalizePreferredPsPricesUrl('http://psprices.com/region-ch/game/123/night-in-the-woods'),
    'https://psprices.com/region-ch/game/123/night-in-the-woods'
  );
  assert.equal(
    normalizePreferredPsPricesUrl('https://sub.psprices.com/path?q=1'),
    'https://sub.psprices.com/path?q=1'
  );
});

void test('normalizePreferredPsPricesUrl rejects blank, malformed, and non-psprices urls', () => {
  assert.equal(normalizePreferredPsPricesUrl('   '), null);
  assert.equal(normalizePreferredPsPricesUrl('psprices.com/region-ch/game/123'), null);
  assert.equal(normalizePreferredPsPricesUrl('https://example.com/game/123'), null);
  assert.equal(normalizePreferredPsPricesUrl('https://'), null);
  assert.equal(normalizePreferredPsPricesUrl(null), null);
});

void test('resolvePreferredPsPricesUrl prefers explicit psPricesUrl and falls back to psprices priceUrl', () => {
  assert.equal(
    resolvePreferredPsPricesUrl({
      psPricesUrl: 'http://www.psprices.com/region-ch/game/123/night-in-the-woods',
      priceSource: 'psprices',
      priceUrl: 'https://example.com/ignored'
    }),
    'https://psprices.com/region-ch/game/123/night-in-the-woods'
  );

  assert.equal(
    resolvePreferredPsPricesUrl({
      psPricesUrl: 'https://example.com/not-psprices',
      priceSource: 'psprices',
      priceUrl: '//psprices.com/region-ch/game/456/night-in-the-woods'
    }),
    'https://psprices.com/region-ch/game/456/night-in-the-woods'
  );

  assert.equal(
    resolvePreferredPsPricesUrl({
      priceSource: 'steam',
      priceUrl: 'https://psprices.com/region-ch/game/456/night-in-the-woods'
    }),
    null
  );
});
