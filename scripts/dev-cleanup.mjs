import { execFileSync } from 'node:child_process';

const AUTO = process.argv.includes('--auto');
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

function normalizePathForCompare(pathValue) {
  return pathValue.replace(/\/+$/, '');
}

const CURRENT_WORKTREE_PATH = normalizePathForCompare(process.cwd());

function runGit(args, options = {}) {
  const { exitOnError = true, ...execOptions } = options;

  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: DEFAULT_MAX_BUFFER,
      ...execOptions
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

const CURRENT_BRANCH = runGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();

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

const worktrees = worktreesOutput
  .replace(/\r\n/g, '\n')
  .split(/\n{2,}/)
  .map((entry) => {
    const pathMatch = entry.match(/^worktree\s+(.+)$/m);
    const branchMatch = entry.match(/^branch\s+refs\/heads\/(.+)$/m);

    return {
      path: pathMatch?.[1]?.trim(),
      branch: branchMatch?.[1]?.trim()
    };
  })
  .filter((w) => w.path && w.branch);

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

  mergedWorktrees.forEach((w) => {
    const isCurrentWorktree = normalizePathForCompare(w.path) === CURRENT_WORKTREE_PATH;
    const isCurrentBranch = w.branch === CURRENT_BRANCH;

    if (isCurrentWorktree || isCurrentBranch) {
      console.log(`Skipping current worktree/branch: ${w.branch} → ${w.path}`);
      return;
    }

    try {
      console.log(`Removing worktree ${w.path}`);
      runGit(['worktree', 'remove', '--', w.path], { stdio: 'inherit', exitOnError: false });
    } catch {
      console.log(`Skipping worktree ${w.path}`);
    }

    try {
      console.log(`Deleting branch ${w.branch}`);
      runGit(['branch', '-d', '--', w.branch], { stdio: 'inherit', exitOnError: false });
    } catch {
      console.log(`Skipping branch ${w.branch}`);
    }
  });
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
