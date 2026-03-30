import assert from 'node:assert/strict';
import test from 'node:test';

import { createPwaStackEnv, createSharedEnv, isEntrypoint } from './worktree-dev.mjs';

test('createSharedEnv keeps the dev manuals origin absolute by default', () => {
  const env = createSharedEnv({ processEnv: { PATH: '/usr/bin' } });

  assert.match(env.MANUALS_PUBLIC_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+\/manuals$/);
  assert.equal(env.PATH, '/usr/bin');
});

test('createSharedEnv preserves an explicit secrets host dir from the provided env', () => {
  const env = createSharedEnv({
    processEnv: {
      PATH: '/usr/bin',
      SECRETS_HOST_DIR: '/tmp/custom-secrets',
    },
  });

  assert.equal(env.SECRETS_HOST_DIR, '/tmp/custom-secrets');
});

test('createPwaStackEnv overrides manuals links to the local HTTPS proxy path', () => {
  const env = createPwaStackEnv({
    MANUALS_PUBLIC_BASE_URL: 'http://127.0.0.1:9999/manuals',
    NODE_ENV: 'development',
  });

  assert.equal(env.MANUALS_PUBLIC_BASE_URL, '/manuals');
  assert.equal(env.NODE_ENV, 'development');
});

test('isEntrypoint resolves relative script paths before comparing module urls', () => {
  assert.equal(
    isEntrypoint({
      argv1: 'scripts/worktree-dev.mjs',
      moduleUrl: new URL('./worktree-dev.mjs', import.meta.url).href,
    }),
    true
  );
});
