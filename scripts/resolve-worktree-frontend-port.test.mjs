import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseWorktreeFrontendPortOutput,
  resolveWorktreeFrontendPort,
} from './resolve-worktree-frontend-port.mjs';

test('parseWorktreeFrontendPortOutput accepts positive integer output', () => {
  assert.equal(parseWorktreeFrontendPortOutput('8100\n'), 8100);
});

test('parseWorktreeFrontendPortOutput rejects empty and non-numeric output', () => {
  assert.throws(() => parseWorktreeFrontendPortOutput(''), /Invalid worktree FRONTEND_PORT/);
  assert.throws(
    () => parseWorktreeFrontendPortOutput('not-a-port'),
    /Invalid worktree FRONTEND_PORT/
  );
  assert.throws(() => parseWorktreeFrontendPortOutput('NaN'), /Invalid worktree FRONTEND_PORT/);
});

test('resolveWorktreeFrontendPort uses base port when WORKTREE_PORT_OFFSET is zero', async () => {
  const port = await resolveWorktreeFrontendPort({
    processEnv: {
      ...process.env,
      WORKTREE_PORT_OFFSET: '0',
    },
  });

  assert.equal(port, 8100);
});
