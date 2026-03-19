import test from 'node:test';
import assert from 'node:assert/strict';

import { formatCleanupSummaryLine, removeMergedWorktrees } from './dev-cleanup.mjs';

test('formatCleanupSummaryLine omits branch list when the category is empty', () => {
  assert.equal(formatCleanupSummaryLine('Skipped dirty', []), 'Skipped dirty: 0');
});

test('formatCleanupSummaryLine includes branch names when entries exist', () => {
  assert.equal(
    formatCleanupSummaryLine('Skipped dirty', [
      { branch: 'feat/dirty-one', path: '/tmp/dirty-one' },
      { branch: 'feat/dirty-two', path: '/tmp/dirty-two' },
    ]),
    'Skipped dirty: 2 (feat/dirty-one, feat/dirty-two)'
  );
});

test('removeMergedWorktrees skips dirty worktrees without deleting the branch', () => {
  const logs = [];
  const gitCalls = [];

  const summary = removeMergedWorktrees({
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
  assert.deepEqual(summary, {
    removed: [],
    skippedCurrent: [],
    skippedDirty: [{ branch: 'feat/dirty', path: '/tmp/worktree-dirty' }],
    skippedRemovalFailed: [],
    skippedBranchDeleteFailed: [],
  });
});

test('removeMergedWorktrees does not delete a branch when worktree removal fails', () => {
  const logs = [];
  const gitCalls = [];

  const summary = removeMergedWorktrees({
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
  assert.deepEqual(summary, {
    removed: [],
    skippedCurrent: [],
    skippedDirty: [],
    skippedRemovalFailed: [{ branch: 'feat/remove-fails', path: '/tmp/worktree-fails' }],
    skippedBranchDeleteFailed: [],
  });
});

test('removeMergedWorktrees deletes the branch after successful worktree removal', () => {
  const logs = [];
  const gitCalls = [];

  const summary = removeMergedWorktrees({
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
  assert.deepEqual(summary, {
    removed: [{ branch: 'feat/clean', path: '/tmp/worktree-clean' }],
    skippedCurrent: [],
    skippedDirty: [],
    skippedRemovalFailed: [],
    skippedBranchDeleteFailed: [],
  });
});
