import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const name = process.argv[2];

if (!name) {
  console.error('Usage: npm run task:start <task-name>');
  process.exit(1);
}

// Restrict branch/task names to a safe subset for shell and git
// - letters, numbers, ".", "_", "-", and "/"
// - must not start with "-" (avoids being parsed as a git option)
const SAFE_BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

if (!SAFE_BRANCH_PATTERN.test(name) || name.startsWith('-')) {
  console.error(
    'Invalid task name. Use only letters, numbers, ".", "_", "-", "/", and do not start with "-".'
  );
  process.exit(1);
}

const pathSegments = name.split('/');
if (pathSegments.some((segment) => !segment || segment === '.' || segment === '..')) {
  console.error('Invalid task name. Dot segments and empty path segments are not allowed.');
  process.exit(1);
}

const branch = name;
const worktreePath = path.posix.normalize(path.posix.join('worktrees', branch));

if (!worktreePath.startsWith('worktrees/')) {
  console.error('Invalid task name. Worktree path must stay within the worktrees directory.');
  process.exit(1);
}

// Ensure parent directories for the worktree path exist, even when branch contains "/"
const worktreeParentDir = worktreePath.split('/').slice(0, -1).join('/');
if (worktreeParentDir) {
  mkdirSync(worktreeParentDir, { recursive: true });
}

try {
  execSync('git fetch origin main', { stdio: 'inherit' });

  execSync(`git worktree add ${worktreePath} -b ${branch} origin/main`, {
    stdio: 'inherit'
  });
  if (process.platform === 'darwin') {
    execSync(`open -a Cursor ${worktreePath}`, { stdio: 'inherit' });
  } else {
    console.log(`Worktree created at ${worktreePath}. Open it in your editor of choice.`);
  }
} catch (error) {
  console.error('Failed to set up worktree for task:', branch);
  const code = typeof error.status === 'number' ? error.status : 1;
  process.exit(code);
}
