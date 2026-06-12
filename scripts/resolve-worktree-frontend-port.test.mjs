import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWorktreeFrontendPort } from './resolve-worktree-frontend-port.mjs';

test('resolveWorktreeFrontendPort uses base port when WORKTREE_PORT_OFFSET is zero', async () => {
  const port = await resolveWorktreeFrontendPort({
    processEnv: {
      ...process.env,
      WORKTREE_PORT_OFFSET: '0',
    },
  });

  assert.equal(port, 8100);
});
