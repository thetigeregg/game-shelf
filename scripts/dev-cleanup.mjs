import { execFileSync } from 'node:child_process';

const AUTO = process.argv.includes('--auto');
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

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
  .filter((b) => b && b !== 'main');

if (mergedBranches.length === 0) {
  console.log('None');
} else {
  mergedBranches.forEach((b) => console.log(b));
}

/*
Find worktrees
*/

const worktrees = runGit(['worktree', 'list', '--porcelain'])
  .split('\n\n')
  .map((entry) => {
    const pathMatch = entry.match(/worktree (.+)/);
    const branchMatch = entry.match(/branch refs\/heads\/(.+)/);

    return {
      path: pathMatch?.[1],
      branch: branchMatch?.[1]
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
