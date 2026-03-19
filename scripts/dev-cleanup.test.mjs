import test from 'node:test';
import assert from 'node:assert/strict';

import { removeMergedWorktrees } from './dev-cleanup.mjs';

test('removeMergedWorktrees skips dirty worktrees without deleting the branch', () => {
  const logs = [];
  const gitCalls = [];

  removeMergedWorktrees({
    mergedWorktrees: [{ branch: 'feat/dirty', path: '/tmp/worktree-dirty' }],
    currentWorktreePath: '/tmp/current',
    currentBranch: 'main',
    normalizePath: (value) => value,
    checkWorktreeClean: () => false,
    gitRunner: (args) => {
      gitCalls.push(args);
      return '';
    },
    log: (message) => logs.push(message),
  });

  assert.deepEqual(gitCalls, []);
  assert.deepEqual(logs, ['Skipping dirty worktree/branch: feat/dirty → /tmp/worktree-dirty']);
});

test('removeMergedWorktrees does not delete a branch when worktree removal fails', () => {
  const logs = [];
  const gitCalls = [];

  removeMergedWorktrees({
    mergedWorktrees: [{ branch: 'feat/remove-fails', path: '/tmp/worktree-fails' }],
    currentWorktreePath: '/tmp/current',
    currentBranch: 'main',
    normalizePath: (value) => value,
    checkWorktreeClean: () => true,
    gitRunner: (args) => {
      gitCalls.push(args);
      if (args[0] === 'worktree') {
        throw new Error('remove failed');
      }
      return '';
    },
    log: (message) => logs.push(message),
  });

  assert.deepEqual(gitCalls, [['worktree', 'remove', '--', '/tmp/worktree-fails']]);
  assert.deepEqual(logs, [
    'Removing worktree /tmp/worktree-fails',
    'Skipping worktree /tmp/worktree-fails',
  ]);
});

test('removeMergedWorktrees deletes the branch after successful worktree removal', () => {
  const logs = [];
  const gitCalls = [];

  removeMergedWorktrees({
    mergedWorktrees: [{ branch: 'feat/clean', path: '/tmp/worktree-clean' }],
    currentWorktreePath: '/tmp/current',
    currentBranch: 'main',
    normalizePath: (value) => value,
    checkWorktreeClean: () => true,
    gitRunner: (args) => {
      gitCalls.push(args);
      return '';
    },
    log: (message) => logs.push(message),
  });

  assert.deepEqual(gitCalls, [
    ['worktree', 'remove', '--', '/tmp/worktree-clean'],
    ['branch', '-D', '--', 'feat/clean'],
  ]);
  assert.deepEqual(logs, ['Removing worktree /tmp/worktree-clean', 'Deleting branch feat/clean']);
});
