import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  formatCleanupSummaryLine,
  removeMergedWorktrees,
  removeOrphanedManagedWorktreeDirs,
} from './dev-cleanup.mjs';

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

test('removeOrphanedManagedWorktreeDirs removes orphaned task-start directories whose branch is gone', () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'dev-cleanup-orphaned-'));
  const managedRoot = path.join(realpathSync(rootDir), 'worktrees');
  const activeDir = path.join(managedRoot, 'feat', 'active');
  const staleDir = path.join(managedRoot, 'feat', 'stale');

  mkdirSync(activeDir, { recursive: true });
  mkdirSync(staleDir, { recursive: true });
  writeFileSync(path.join(activeDir, 'package.json'), '{}');
  writeFileSync(path.join(activeDir, 'angular.json'), '{}');
  writeFileSync(path.join(staleDir, 'package.json'), '{}');
  writeFileSync(path.join(staleDir, 'angular.json'), '{}');

  const removedDirs = [];
  const prunedDirs = [];
  const logs = [];

  const summary = removeOrphanedManagedWorktreeDirs({
    managedWorktreesRoot: managedRoot,
    activeWorktreePaths: [activeDir],
    branchExists: (branch) => branch === 'feat/active',
    removeDir: (dirPath) => removedDirs.push(dirPath),
    pruneAncestors: (dirPath, managedPath) => prunedDirs.push([dirPath, managedPath]),
    log: (message) => logs.push(message),
  });

  assert.deepEqual(removedDirs, [staleDir]);
  assert.deepEqual(prunedDirs, [[staleDir, managedRoot]]);
  assert.deepEqual(logs, [`Removing orphaned worktree directory ${staleDir}`]);
  assert.deepEqual(summary, {
    removed: [{ branch: 'feat/stale', path: staleDir }],
    skippedExistingBranch: [],
  });
});

test('removeOrphanedManagedWorktreeDirs keeps orphaned directories when the local branch still exists', () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'dev-cleanup-orphaned-'));
  const managedRoot = path.join(realpathSync(rootDir), 'worktrees');
  const staleDir = path.join(managedRoot, 'feat', 'keep-me');

  mkdirSync(staleDir, { recursive: true });
  writeFileSync(path.join(staleDir, 'package.json'), '{}');
  writeFileSync(path.join(staleDir, 'angular.json'), '{}');

  const logs = [];

  const summary = removeOrphanedManagedWorktreeDirs({
    managedWorktreesRoot: managedRoot,
    activeWorktreePaths: [],
    branchExists: () => true,
    removeDir: () => {
      throw new Error('should not remove when local branch still exists');
    },
    pruneAncestors: () => {
      throw new Error('should not prune when nothing was removed');
    },
    log: (message) => logs.push(message),
  });

  assert.deepEqual(logs, [
    `Skipping orphaned directory with local branch: feat/keep-me → ${staleDir}`,
  ]);
  assert.deepEqual(summary, {
    removed: [],
    skippedExistingBranch: [{ branch: 'feat/keep-me', path: staleDir }],
  });
});
