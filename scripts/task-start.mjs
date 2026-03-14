import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const name = process.argv[2];

if (!name) {
  console.error('Usage: npm run task:start <task-name>');
  process.exit(1);
}

// Restrict branch/task names to a safe subset for shell and git
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

/*
Auto-prefix branches with feat/ unless a type is already supplied.

Examples:

task:start search        -> feat/search
task:start fix/login     -> fix/login
task:start chore/update  -> chore/update
*/

const branch = name.includes('/') ? name : `feat/${name}`;

const worktreePath = path.posix.normalize(path.posix.join('worktrees', branch));

if (!worktreePath.startsWith('worktrees/')) {
  console.error('Invalid task name. Worktree path must stay within the worktrees directory.');
  process.exit(1);
}

// Ensure parent directories exist
const worktreeParentDir = worktreePath.split('/').slice(0, -1).join('/');
if (worktreeParentDir) {
  mkdirSync(worktreeParentDir, { recursive: true });
}

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function commandExists(command) {
  try {
    execSync(`command -v ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getWorktreePathForBranch(branchName) {
  const output = execSync('git worktree list --porcelain', {
    encoding: 'utf8'
  });
  const targetRef = `refs/heads/${branchName}`;
  const blocks = output
    .trim()
    .split('\n\n')
    .map((block) => block.split('\n'));

  for (const block of blocks) {
    const worktreeLine = block.find((line) => line.startsWith('worktree '));
    const branchLine = block.find((line) => line.startsWith('branch '));
    if (!worktreeLine || !branchLine) {
      continue;
    }
    const worktreeDir = worktreeLine.slice('worktree '.length);
    const branchRef = branchLine.slice('branch '.length);
    if (branchRef === targetRef) {
      return worktreeDir;
    }
  }

  return null;
}

try {
  /*
  Prevent starting a task with a dirty repo
  */
  const statusOutput = execSync('git status --porcelain', {
    encoding: 'utf8'
  }).trim();
  if (statusOutput) {
    console.error('\nWorking directory has uncommitted changes.');
    console.error('Commit or stash before starting a new task.\n');
    process.exit(1);
  }

  console.log('\nFetching latest origin/main...\n');
  run('git fetch origin main --prune');

  const hasLocalMain = (() => {
    try {
      execSync('git show-ref --verify --quiet refs/heads/main', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  if (!hasLocalMain) {
    console.log('\nCreating local main from origin/main...\n');
    run('git branch main origin/main');
  } else {
    console.log('\nFast-forwarding local main to origin/main...\n');
    try {
      run('git merge-base --is-ancestor main origin/main');
    } catch {
      console.error('\nLocal main has diverged from origin/main.');
      console.error(
        'Reconcile your local main with origin/main (e.g. rebase, reset, or merge) before starting a new task.'
      );
      console.error(
        'For example, to discard local divergence you can run: git branch -f main origin/main\n'
      );
      process.exit(1);
    }

    const mainWorktreePath = getWorktreePathForBranch('main');
    if (mainWorktreePath) {
      run('git merge --ff-only origin/main', {
        cwd: mainWorktreePath
      });
    } else {
      run('git branch -f main origin/main');
    }
  }

  console.log(`\nCreating worktree for branch: ${branch}\n`);

  run(`git worktree add ${worktreePath} -b ${branch} main`);

  /*
  Bootstrap dependencies for the new worktree
  */
  console.log('\nBootstrapping worktree environment...\n');

  try {
    run(`node scripts/worktree-dev.mjs bootstrap`, {
      cwd: worktreePath
    });
  } catch (error) {
    console.error('\nBootstrap script failed.');
    console.error(
      `Run "node scripts/worktree-dev.mjs bootstrap" inside ${worktreePath} and retry.\n`
    );
    const code = typeof error.status === 'number' ? error.status : 1;
    process.exit(code);
  }

  /*
  Open VS Code automatically
  */
  if (process.platform === 'darwin' && commandExists('code')) {
    console.log('\nOpening VS Code...\n');
    try {
      run(`code "${worktreePath}"`);
    } catch {
      console.warn('\nCould not open VS Code automatically.\n');
      console.warn(`Open the worktree manually: ${worktreePath}\n`);
    }
  } else {
    console.log(`\nOpen the worktree in your editor: ${worktreePath}\n`);
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Task started successfully

Branch:
  ${branch}

Worktree:
  ${worktreePath}

Next steps:

  cd ${worktreePath}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
} catch (error) {
  console.error('Failed to set up worktree for task:', branch);
  const code = typeof error.status === 'number' ? error.status : 1;
  process.exit(code);
}
