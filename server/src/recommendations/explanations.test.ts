import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExplanation } from './explanations.js';

void test('explanation bullets preserve component deltas', () => {
  const explanation = buildExplanation({
    components: {
      taste: 1.2,
      novelty: -0.15,
      runtimeFit: 0,
      criticBoost: 0.25,
      recencyBoost: 0.3,
      semantic: 0.6
    },
    tasteMatches: [
      {
        family: 'collections',
        key: 'collections:mario',
        label: 'Mario',
        delta: 0.9
      },
      {
        family: 'genres',
        key: 'genres:platformer',
        label: 'Platformer',
        delta: 0.3
      }
    ]
  });

  assert.equal(explanation.headline.includes('semantic match'), true);
  assert.equal(explanation.bullets.find((bullet) => bullet.type === 'taste')?.delta, 1.2);
  assert.equal(explanation.bullets.find((bullet) => bullet.type === 'semantic')?.delta, 0.6);
  assert.equal(explanation.bullets.find((bullet) => bullet.type === 'novelty')?.delta, -0.15);
  assert.equal(explanation.bullets.find((bullet) => bullet.type === 'critic')?.delta, 0.25);
  assert.equal(explanation.bullets.find((bullet) => bullet.type === 'recency')?.delta, 0.3);
  assert.deepEqual(explanation.matchedTokens.collections, ['Mario']);
});
