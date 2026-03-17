import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMetacriticSearchUrl,
  buildSearchTitleVariants,
  normalizeTitle,
  parseMetacriticScore
} from './search-utils.mjs';

test('normalizeTitle strips accents and punctuation', () => {
  assert.equal(normalizeTitle('Pokémon: Red/Blue'), 'pokemon red blue');
});

test('parseMetacriticScore handles valid, tbd, and invalid values', () => {
  assert.equal(parseMetacriticScore('95'), 95);
  assert.equal(parseMetacriticScore('TBD'), null);
  assert.equal(parseMetacriticScore('0'), null);
  assert.equal(parseMetacriticScore('101'), null);
});

test('buildSearchTitleVariants includes base and normalized title-cased variant', () => {
  assert.deepEqual(buildSearchTitleVariants('Animal Crossing: New Leaf'), [
    'Animal Crossing: New Leaf',
    'Animal Crossing New Leaf'
  ]);
});

test('buildMetacriticSearchUrl uses category=13 and normalized query path', () => {
  assert.equal(
    buildMetacriticSearchUrl('Animal Crossing: New Leaf'),
    'https://www.metacritic.com/search/animal%20crossing%20new%20leaf/?category=13'
  );
});
