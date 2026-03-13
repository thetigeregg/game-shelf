import { execSync } from 'node:child_process';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' });
}

function runPrint(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Repository cleanup');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('→ Checking out main');
runPrint('git checkout main');

console.log('\n→ Updating main');
runPrint('git pull origin main');

console.log('\n→ Pruning deleted remote branches');
runPrint('git fetch --prune');

console.log('\n→ Pruning stale worktrees');
runPrint('git worktree prune');

console.log('\n→ Active worktrees');
runPrint('git worktree list');

/*
Branches with missing remote
*/

console.log('\n→ Local branches with missing remote\n');

const branchInfo = run('git branch -vv');

const goneBranches = branchInfo
  .split('\n')
  .filter((line) => line.includes(': gone]'))
  .map((line) => line.trim().split(/\s+/)[0])
  .filter(Boolean);

if (goneBranches.length === 0) {
  console.log('None');
} else {
  goneBranches.forEach((b) => console.log(b));
}

/*
Branches merged into main
*/

console.log('\n→ Branches already merged into main\n');

const mergedBranches = run('git branch --merged main')
  .split('\n')
  .map((b) => b.replace('*', '').trim())
  .filter((b) => b && b !== 'main');

if (mergedBranches.length === 0) {
  console.log('None');
} else {
  mergedBranches.forEach((b) => console.log(b));
}

/*
Worktrees whose branches are already merged
*/

console.log('\n→ Worktrees whose branch is merged\n');

const worktrees = run('git worktree list --porcelain')
  .split('\n\n')
  .map((entry) => {
    const pathMatch = entry.match(/worktree (.+)/);
    const branchMatch = entry.match(/branch refs\/heads\/(.+)/);

    return {
      path: pathMatch?.[1],
      branch: branchMatch?.[1]
    };
  })
  .filter(Boolean);

const mergedWorktrees = worktrees.filter((w) => mergedBranches.includes(w.branch));

if (mergedWorktrees.length === 0) {
  console.log('None');
} else {
  mergedWorktrees.forEach((w) => {
    console.log(`${w.branch} → ${w.path}`);
  });
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
