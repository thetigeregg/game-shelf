import assert from 'node:assert/strict';
import test from 'node:test';
import { searchTitleVariants } from './search-variants.mjs';

test('searchTitleVariants merges candidates from every variant in order', async () => {
  const searched = [];
  const result = await searchTitleVariants(['Hades II', 'Hades Ii'], async (variant) => {
    searched.push(variant);
    return [{ title: `${variant} result` }];
  });

  assert.deepEqual(searched, ['Hades II', 'Hades Ii']);
  assert.deepEqual(result, {
    candidates: [{ title: 'Hades II result' }, { title: 'Hades Ii result' }],
    failures: [],
  });
});

test('searchTitleVariants keeps earlier results when a later variant fails', async () => {
  const failure = new Error('FlareSolverr failed: timeout');
  const result = await searchTitleVariants(['Hades II', 'Hades Ii'], async (variant) => {
    if (variant === 'Hades Ii') {
      throw failure;
    }
    return [{ title: 'Hades II' }];
  });

  assert.deepEqual(result.candidates, [{ title: 'Hades II' }]);
  assert.deepEqual(result.failures, [{ variant: 'Hades Ii', error: failure }]);
});

test('searchTitleVariants keeps later results when an earlier variant fails', async () => {
  const failure = new Error('PSPrices: 500');
  const result = await searchTitleVariants(['first', 'second'], async (variant) => {
    if (variant === 'first') {
      throw failure;
    }
    return [{ title: 'second' }];
  });

  assert.deepEqual(result.candidates, [{ title: 'second' }]);
  assert.deepEqual(result.failures, [{ variant: 'first', error: failure }]);
});

test('searchTitleVariants treats a variant with no matches as a success', async () => {
  const result = await searchTitleVariants(['first', 'second'], async (variant) => {
    if (variant === 'first') {
      throw new Error('blocked');
    }
    return [];
  });

  assert.deepEqual(result.candidates, []);
  assert.equal(result.failures.length, 1);
});

test('searchTitleVariants throws the first error when every variant fails', async () => {
  const first = new Error('blocked by Cloudflare: challenge; FlareSolverr failed: ENOTFOUND');
  await assert.rejects(
    searchTitleVariants(['first', 'second'], async (variant) => {
      throw variant === 'first' ? first : new Error('second failure');
    }),
    (error) => error === first
  );
});

test('searchTitleVariants returns nothing for no variants', async () => {
  assert.deepEqual(
    await searchTitleVariants([], async () => {
      throw new Error('not called');
    }),
    { candidates: [], failures: [] }
  );
});
