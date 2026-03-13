import { execSync } from 'node:child_process';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
}

function runPrint(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Repository cleanup');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

/*
Checkout main
*/
console.log('→ Checking out main');
// runPrint('git checkout main');

/*
Update main
*/
console.log('\n→ Updating main');
// runPrint('git pull origin main');

/*
Prune remote branches
*/
console.log('\n→ Pruning deleted remote branches');
runPrint('git fetch --prune');

/*
Prune stale worktrees
*/
console.log('\n→ Pruning stale worktrees');
runPrint('git worktree prune');

/*
Show active worktrees
*/
console.log('\n→ Active worktrees');
runPrint('git worktree list');

/*
Find local branches whose remote is gone
*/
console.log('\n→ Local branches with missing remote\n');

const branches = run('git branch -vv');

const staleBranches = branches
  .split('\n')
  .filter((line) => line.includes(': gone]'))
  .map((line) => line.trim().split(/\s+/)[0])
  .filter(Boolean);

if (staleBranches.length === 0) {
  console.log('None');
} else {
  for (const b of staleBranches) {
    console.log(b);
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
