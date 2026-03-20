import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  formatCleanupSummaryLine,
  isEntrypoint,
  parseWorktrees,
  removeMergedWorktrees,
  removeMergedBranchesWithoutWorktrees,
  removeOrphanedManagedWorktreeDirs,
} from './dev-cleanup.mjs';

const REPO_ROOT = realpathSync(
  path.resolve(
    execFileSync('git', ['rev-parse', '--git-common-dir'], {
      encoding: 'utf8',
    }).trim(),
    '..'
  )
);

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

test('parseWorktrees keeps detached worktree paths without inventing a branch', () => {
  const worktrees = parseWorktrees(`worktree /repo/main
HEAD abcdef1234567890
branch refs/heads/main

worktree /repo/worktrees/detached
HEAD 1234567890abcdef
detached
`);

  assert.deepEqual(worktrees, [
    { path: '/repo/main', branch: 'main' },
    { path: '/repo/worktrees/detached', branch: undefined },
  ]);
});

test('isEntrypoint resolves relative argv[1] paths before comparing against import.meta.url', () => {
  assert.equal(
    isEntrypoint({
      argv1: 'scripts/dev-cleanup.mjs',
      moduleUrl: new URL('./dev-cleanup.mjs', import.meta.url).href,
    }),
    true
  );
});

test('isEntrypoint returns false when argv[1] is missing', () => {
  assert.equal(
    isEntrypoint({
      argv1: undefined,
      moduleUrl: new URL('./dev-cleanup.mjs', import.meta.url).href,
    }),
    false
  );
});

test('removeMergedWorktrees skips dirty worktrees without deleting the branch', () => {
  const logs = [];
  const gitCalls = [];
  const worktreePath = path.join(
    REPO_ROOT,
    'worktrees',
    'feat',
    'script-again-again-again-again',
    'tmp',
    'worktree-dirty'
  );

  const summary = removeMergedWorktrees({
    mergedWorktrees: [{ branch: 'feat/dirty', path: worktreePath }],
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
  assert.deepEqual(logs, [
    'Skipping dirty worktree/branch: feat/dirty → ./worktrees/feat/script-again-again-again-again/tmp/worktree-dirty',
  ]);
  assert.deepEqual(summary, {
    removed: [],
    skippedCurrent: [],
    skippedDirty: [{ branch: 'feat/dirty', path: worktreePath }],
    skippedRemovalFailed: [],
    skippedBranchDeleteFailed: [],
  });
});

test('removeMergedWorktrees does not delete a branch when worktree removal fails', () => {
  const logs = [];
  const gitCalls = [];
  const worktreePath = path.join(
    REPO_ROOT,
    'worktrees',
    'feat',
    'script-again-again-again-again',
    'tmp',
    'worktree-fails'
  );

  const summary = removeMergedWorktrees({
    mergedWorktrees: [{ branch: 'feat/remove-fails', path: worktreePath }],
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

  assert.deepEqual(gitCalls, [['worktree', 'remove', '--', worktreePath]]);
  assert.deepEqual(logs, [
    'Removing worktree ./worktrees/feat/script-again-again-again-again/tmp/worktree-fails',
    'Skipping worktree ./worktrees/feat/script-again-again-again-again/tmp/worktree-fails',
  ]);
  assert.deepEqual(summary, {
    removed: [],
    skippedCurrent: [],
    skippedDirty: [],
    skippedRemovalFailed: [{ branch: 'feat/remove-fails', path: worktreePath }],
    skippedBranchDeleteFailed: [],
  });
});

test('removeMergedWorktrees deletes the branch after successful worktree removal', () => {
  const logs = [];
  const gitCalls = [];
  const worktreePath = path.join(
    REPO_ROOT,
    'worktrees',
    'feat',
    'script-again-again-again-again',
    'tmp',
    'worktree-clean'
  );

  const summary = removeMergedWorktrees({
    mergedWorktrees: [{ branch: 'feat/clean', path: worktreePath }],
    currentWorktreePath: '/tmp/current',
    currentBranch: 'main',
    normalizePath: (value) => value,
    checkWorktreeClean: () => true,
    gitRunner: (args) => {
      gitCalls.push(args);
      return '';
    },
    pruneAncestors: () => {},
    log: (message) => logs.push(message),
  });

  assert.deepEqual(gitCalls, [
    ['worktree', 'remove', '--', worktreePath],
    ['branch', '-D', '--', 'feat/clean'],
  ]);
  assert.deepEqual(logs, [
    'Removing worktree ./worktrees/feat/script-again-again-again-again/tmp/worktree-clean',
    'Deleting branch feat/clean',
  ]);
  assert.deepEqual(summary, {
    removed: [{ branch: 'feat/clean', path: worktreePath }],
    skippedCurrent: [],
    skippedDirty: [],
    skippedRemovalFailed: [],
    skippedBranchDeleteFailed: [],
  });
});

test('removeMergedWorktrees dry-run previews removals without calling git', () => {
  const logs = [];
  const gitCalls = [];
  const worktreePath = path.join(
    REPO_ROOT,
    'worktrees',
    'feat',
    'script-again-again-again-again',
    'tmp',
    'worktree-dry-run'
  );

  const summary = removeMergedWorktrees({
    mergedWorktrees: [{ branch: 'feat/dry-run', path: worktreePath }],
    currentWorktreePath: '/tmp/current',
    currentBranch: 'main',
    normalizePath: (value) => value,
    checkWorktreeClean: () => true,
    gitRunner: (args) => {
      gitCalls.push(args);
      return '';
    },
    dryRun: true,
    log: (message) => logs.push(message),
  });

  assert.deepEqual(gitCalls, []);
  assert.deepEqual(logs, [
    '[dry-run] Would remove worktree ./worktrees/feat/script-again-again-again-again/tmp/worktree-dry-run',
    '[dry-run] Would delete branch feat/dry-run',
  ]);
  assert.deepEqual(summary, {
    removed: [{ branch: 'feat/dry-run', path: worktreePath }],
    skippedCurrent: [],
    skippedDirty: [],
    skippedRemovalFailed: [],
    skippedBranchDeleteFailed: [],
  });
});

test('removeMergedBranchesWithoutWorktrees deletes merged branches that are not active anywhere', () => {
  const logs = [];
  const gitCalls = [];

  const summary = removeMergedBranchesWithoutWorktrees({
    mergedBranches: ['feat/branch-only'],
    activeWorktreeBranches: ['feat/active'],
    currentBranch: 'main',
    gitRunner: (args) => {
      gitCalls.push(args);
      return '';
    },
    log: (message) => logs.push(message),
  });

  assert.deepEqual(gitCalls, [['branch', '-D', '--', 'feat/branch-only']]);
  assert.deepEqual(logs, ['Deleting merged branch without worktree feat/branch-only']);
  assert.deepEqual(summary, {
    removed: [{ branch: 'feat/branch-only' }],
    skippedCurrent: [],
    skippedActiveWorktree: [],
    skippedDeleteFailed: [],
  });
});

test('removeMergedBranchesWithoutWorktrees dry-run previews deletions', () => {
  const logs = [];

  const summary = removeMergedBranchesWithoutWorktrees({
    mergedBranches: ['feat/branch-only'],
    activeWorktreeBranches: [],
    currentBranch: 'main',
    dryRun: true,
    log: (message) => logs.push(message),
  });

  assert.deepEqual(logs, [
    '[dry-run] Would delete merged branch without worktree feat/branch-only',
  ]);
  assert.deepEqual(summary, {
    removed: [{ branch: 'feat/branch-only' }],
    skippedCurrent: [],
    skippedActiveWorktree: [],
    skippedDeleteFailed: [],
  });
});

test('removeOrphanedManagedWorktreeDirs removes orphaned task-start directories whose branch is gone', () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'dev-cleanup-orphaned-'));
  const managedRoot = path.join(realpathSync(rootDir), 'worktrees');
  const activeDir = path.join(managedRoot, 'feat', 'active');
  const staleDir = path.join(managedRoot, 'feat', 'stale');

  mkdirSync(activeDir, { recursive: true });
  mkdirSync(staleDir, { recursive: true });
  writeFileSync(path.join(activeDir, '.git'), 'gitdir: /tmp/repo/.git/worktrees/active\n');
  writeFileSync(path.join(staleDir, '.git'), 'gitdir: /tmp/repo/.git/worktrees/stale\n');

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

  rmSync(rootDir, { recursive: true, force: true });
});

test('removeOrphanedManagedWorktreeDirs keeps orphaned directories when the local branch still exists', () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'dev-cleanup-orphaned-'));
  const managedRoot = path.join(realpathSync(rootDir), 'worktrees');
  const staleDir = path.join(managedRoot, 'feat', 'keep-me');

  mkdirSync(staleDir, { recursive: true });
  writeFileSync(path.join(staleDir, '.git'), 'gitdir: /tmp/repo/.git/worktrees/keep-me\n');

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
    `Warning: orphaned directory still has a local branch: feat/keep-me → ${staleDir}`,
  ]);
  assert.deepEqual(summary, {
    removed: [],
    skippedExistingBranch: [{ branch: 'feat/keep-me', path: staleDir }],
  });

  rmSync(rootDir, { recursive: true, force: true });
});

test('removeOrphanedManagedWorktreeDirs dry-run previews orphan removal without deleting', () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'dev-cleanup-orphaned-'));
  const managedRoot = path.join(realpathSync(rootDir), 'worktrees');
  const staleDir = path.join(managedRoot, 'feat', 'preview-me');

  mkdirSync(staleDir, { recursive: true });
  writeFileSync(path.join(staleDir, '.git'), 'gitdir: /tmp/repo/.git/worktrees/preview-me\n');

  const logs = [];

  const summary = removeOrphanedManagedWorktreeDirs({
    managedWorktreesRoot: managedRoot,
    activeWorktreePaths: [],
    branchExists: () => false,
    removeDir: () => {
      throw new Error('dry-run should not remove directories');
    },
    pruneAncestors: () => {
      throw new Error('dry-run should not prune directories');
    },
    dryRun: true,
    log: (message) => logs.push(message),
  });

  assert.deepEqual(logs, [`[dry-run] Would remove orphaned worktree directory ${staleDir}`]);
  assert.deepEqual(summary, {
    removed: [{ branch: 'feat/preview-me', path: staleDir }],
    skippedExistingBranch: [],
  });

  rmSync(rootDir, { recursive: true, force: true });
});
