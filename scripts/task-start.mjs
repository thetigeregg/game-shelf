import { execSync } from 'node:child_process';

const name = process.argv[2];

if (!name) {
  console.error('Usage: npm run task:start <task-name>');
  process.exit(1);
}

const branch = name;

execSync('git fetch origin main', { stdio: 'inherit' });

execSync(`git worktree add worktrees/${branch} -b ${branch} origin/main`, { stdio: 'inherit' });

execSync(`open -a Cursor worktrees/${branch}`, { stdio: 'inherit' });
