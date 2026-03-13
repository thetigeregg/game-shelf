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

  console.log('\nFetching latest main...\n');
  run('git fetch origin main --prune');

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
