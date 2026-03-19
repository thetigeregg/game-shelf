import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const AUTO = process.argv.includes('--auto');
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

function normalizePathForCompare(pathValue) {
  let resolved = path.resolve(pathValue);

  try {
    resolved = realpathSync(resolved);
  } catch {
    // Keep resolved path when realpath lookup fails.
  }

  return resolved.replace(/\\/g, '/').replace(/\/+$/, '');
}

function getCurrentWorktreePath() {
  try {
    const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      maxBuffer: DEFAULT_MAX_BUFFER,
    }).trim();

    if (toplevel) {
      return normalizePathForCompare(toplevel);
    }
  } catch {
    // Fallback to process.cwd() if git detection fails.
  }

  return normalizePathForCompare(process.cwd());
}

const CURRENT_WORKTREE_PATH = getCurrentWorktreePath();

function runGit(args, options = {}) {
  const { exitOnError = true, ...execOptions } = options;

  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: DEFAULT_MAX_BUFFER,
      ...execOptions,
    });
  } catch (error) {
    const commandString = ['git', ...args].join(' ');
    console.error(`Command failed: ${commandString}`);

    if (error && typeof error === 'object' && 'stderr' in error && error.stderr) {
      try {
        process.stderr.write(String(error.stderr));
      } catch {
        // Ignore stderr write failures.
      }
    }

    if (!exitOnError) {
      throw error;
    }

    let exitCode = 1;
    if (error && typeof error === 'object') {
      if (typeof error.status === 'number') {
        exitCode = error.status;
      } else if (typeof error.code === 'number') {
        exitCode = error.code;
      }
    }

    process.exit(exitCode);
  }
}

function isWorktreeClean(worktreePath) {
  try {
    const status = runGit(['-C', worktreePath, 'status', '--porcelain'], {
      exitOnError: false,
    }).trim();
    return status.length === 0;
  } catch {
    return false;
  }
}

function parseWorktrees(worktreesOutput) {
  return worktreesOutput
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((entry) => {
      const pathMatch = entry.match(/^worktree\s+(.+)$/m);
      const branchMatch = entry.match(/^branch\s+refs\/heads\/(.+)$/m);

      return {
        path: pathMatch?.[1]?.trim(),
        branch: branchMatch?.[1]?.trim(),
      };
    })
    .filter((w) => w.path && w.branch);
}

export function formatCleanupSummaryLine(label, worktrees) {
  if (worktrees.length === 0) {
    return `${label}: 0`;
  }

  const branches = worktrees.map((worktree) => worktree.branch).join(', ');
  return `${label}: ${worktrees.length} (${branches})`;
}

export function removeMergedWorktrees({
  mergedWorktrees,
  currentWorktreePath,
  currentBranch,
  normalizePath = normalizePathForCompare,
  checkWorktreeClean = isWorktreeClean,
  gitRunner = runGit,
  log = console.log,
}) {
  const summary = {
    removed: [],
    skippedCurrent: [],
    skippedDirty: [],
    skippedRemovalFailed: [],
    skippedBranchDeleteFailed: [],
  };

  mergedWorktrees.forEach((w) => {
    const isCurrentWorktree = normalizePath(w.path) === currentWorktreePath;
    const isCurrentBranch = w.branch === currentBranch;

    if (isCurrentWorktree || isCurrentBranch) {
      log(`Skipping current worktree/branch: ${w.branch} → ${w.path}`);
      summary.skippedCurrent.push(w);
      return;
    }

    if (!checkWorktreeClean(w.path)) {
      log(`Skipping dirty worktree/branch: ${w.branch} → ${w.path}`);
      summary.skippedDirty.push(w);
      return;
    }

    let removedWorktree = false;

    try {
      log(`Removing worktree ${w.path}`);
      gitRunner(['worktree', 'remove', '--', w.path], { stdio: 'inherit', exitOnError: false });
      removedWorktree = true;
    } catch {
      log(`Skipping worktree ${w.path}`);
      summary.skippedRemovalFailed.push(w);
    }

    if (!removedWorktree) {
      return;
    }

    try {
      log(`Deleting branch ${w.branch}`);
      gitRunner(['branch', '-D', '--', w.branch], { stdio: 'inherit', exitOnError: false });
      summary.removed.push(w);
    } catch {
      log(`Skipping branch ${w.branch}`);
      summary.skippedBranchDeleteFailed.push(w);
    }
  });

  return summary;
}

export function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Repository cleanup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const status = runGit(['status', '--porcelain']).trim();
  if (status) {
    console.error(
      'Working tree is dirty. Please commit, stash, or discard your changes before running dev-cleanup.'
    );
    process.exit(1);
  }

  const currentBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();

  console.log('→ Fetching latest refs from origin');
  runGit(['fetch', '--prune', 'origin'], { stdio: 'inherit' });

  console.log('\n→ Pruning stale worktrees');
  runGit(['worktree', 'prune'], { stdio: 'inherit' });

  console.log('\n→ Active worktrees');
  runGit(['worktree', 'list'], { stdio: 'inherit' });

  const branchInfo = runGit(['branch', '-vv', '--no-color']);

  /*
Branches whose remote is gone
*/

  console.log('\n→ Local branches with missing remote\n');

  const goneBranches = branchInfo
    .split('\n')
    .filter((line) => line.includes(': gone]'))
    .map(
      (line) =>
        line
          .replace(/^[*+]\s*/, '')
          .trim()
          .split(/\s+/)[0]
    )
    .filter(Boolean);

  if (goneBranches.length === 0) {
    console.log('None');
  } else {
    goneBranches.forEach((b) => console.log(b));
  }

  /*
Branches merged into origin/main
*/

  console.log('\n→ Branches already merged into origin/main\n');

  const mergedBranches = runGit(['branch', '--merged', 'origin/main', '--no-color'])
    .split('\n')
    .map((b) => b.replace(/^[*+]\s*/, '').trim())
    .filter((b) => b && b !== 'main' && !b.startsWith('('));

  if (mergedBranches.length === 0) {
    console.log('None');
  } else {
    mergedBranches.forEach((b) => console.log(b));
  }

  /*
Find worktrees
*/

  const worktreesOutput = runGit(['worktree', 'list', '--porcelain']);
  const worktrees = parseWorktrees(worktreesOutput);

  /*
Worktrees whose branch is merged
*/

  console.log('\n→ Worktrees whose branch is merged\n');

  const mergedWorktrees = worktrees.filter((w) => mergedBranches.includes(w.branch));

  if (mergedWorktrees.length === 0) {
    console.log('None');
  } else {
    mergedWorktrees.forEach((w) => {
      console.log(`${w.branch} → ${w.path}`);
    });
  }

  /*
AUTO MODE
*/

  if (AUTO && mergedWorktrees.length > 0) {
    console.log('\n→ Removing merged worktrees and branches\n');
    const removalSummary = removeMergedWorktrees({
      mergedWorktrees,
      currentWorktreePath: CURRENT_WORKTREE_PATH,
      currentBranch,
    });

    const totalRemoved = removalSummary.removed.length;
    const totalSkipped =
      removalSummary.skippedCurrent.length +
      removalSummary.skippedDirty.length +
      removalSummary.skippedRemovalFailed.length +
      removalSummary.skippedBranchDeleteFailed.length;

    console.log('\n→ Cleanup summary\n');
    console.log(formatCleanupSummaryLine('Removed', removalSummary.removed));
    console.log(formatCleanupSummaryLine('Skipped current', removalSummary.skippedCurrent));
    console.log(formatCleanupSummaryLine('Skipped dirty', removalSummary.skippedDirty));
    console.log(
      formatCleanupSummaryLine('Skipped remove failed', removalSummary.skippedRemovalFailed)
    );
    console.log(
      formatCleanupSummaryLine(
        'Skipped branch delete failed',
        removalSummary.skippedBranchDeleteFailed
      )
    );
    console.log(`Total skipped: ${totalSkipped}`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
