import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const AUTO = process.argv.includes('--auto');
const DRY_RUN = process.argv.includes('--dry-run');
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;
const IGNORABLE_DIRECTORY_ENTRIES = new Set(['.DS_Store', '.localized', 'Thumbs.db']);

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

function getCommonRepoRoot() {
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      encoding: 'utf8',
      maxBuffer: DEFAULT_MAX_BUFFER,
    }).trim();

    if (commonDir) {
      return normalizePathForCompare(path.resolve(commonDir, '..'));
    }
  } catch {
    // Fallback to current worktree when common git dir detection fails.
  }

  return CURRENT_WORKTREE_PATH;
}

const COMMON_REPO_ROOT = getCommonRepoRoot();
const MANAGED_WORKTREES_ROOT = normalizePathForCompare(path.join(COMMON_REPO_ROOT, 'worktrees'));

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

function gitCommandSucceeds(args, options = {}) {
  try {
    execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: DEFAULT_MAX_BUFFER,
      stdio: 'ignore',
      ...options,
    });
    return true;
  } catch {
    return false;
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

export function parseWorktrees(worktreesOutput) {
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
    .filter((w) => w.path);
}

function isPathInside(parentPath, childPath) {
  const normalizedParent = normalizePathForCompare(parentPath);
  const normalizedChild = normalizePathForCompare(childPath);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

function getDisplayPath(targetPath) {
  return normalizePathForCompare(targetPath).replace(`${COMMON_REPO_ROOT}/`, '');
}

function listVisibleEntries(dirPath) {
  return readdirSync(dirPath).filter((entry) => !IGNORABLE_DIRECTORY_ENTRIES.has(entry));
}

function removeIgnorableEntries(dirPath) {
  for (const entry of IGNORABLE_DIRECTORY_ENTRIES) {
    const entryPath = path.join(dirPath, entry);
    if (existsSync(entryPath)) {
      rmSync(entryPath, { force: true, recursive: false });
    }
  }
}

function pruneEmptyManagedAncestors(removedPath, managedRoot = MANAGED_WORKTREES_ROOT) {
  let currentPath = normalizePathForCompare(path.dirname(removedPath));
  const normalizedManagedRoot = normalizePathForCompare(managedRoot);

  while (
    isPathInside(normalizedManagedRoot, currentPath) &&
    currentPath !== normalizedManagedRoot
  ) {
    const visibleEntries = listVisibleEntries(currentPath);
    if (visibleEntries.length > 0) {
      return;
    }

    removeIgnorableEntries(currentPath);
    rmSync(currentPath, { recursive: false, force: true });
    currentPath = normalizePathForCompare(path.dirname(currentPath));
  }
}

function getManagedWorktreeGitPointer(dirPath) {
  const gitPath = path.join(dirPath, '.git');
  if (!existsSync(gitPath)) {
    return null;
  }

  try {
    const gitFile = readFileSync(gitPath, 'utf8').trim();
    const match = gitFile.match(/^gitdir:\s*(.+)$/);
    if (!match) {
      return null;
    }

    return normalizePathForCompare(path.resolve(dirPath, match[1].trim()));
  } catch {
    return null;
  }
}

function looksLikeManagedWorktreeRoot(dirPath) {
  const gitPointer = getManagedWorktreeGitPointer(dirPath);
  if (!gitPointer) {
    return false;
  }

  return gitPointer.includes('/.git/worktrees/');
}

function toBranchFromManagedWorktreePath(managedWorktreesRoot, dirPath) {
  return path
    .relative(managedWorktreesRoot, dirPath)
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function findOrphanedManagedWorktreeDirs({
  managedWorktreesRoot = MANAGED_WORKTREES_ROOT,
  activeWorktreePaths = [],
}) {
  const normalizedManagedRoot = normalizePathForCompare(managedWorktreesRoot);
  if (!existsSync(normalizedManagedRoot)) {
    return [];
  }

  const activePathSet = new Set(
    activeWorktreePaths.map((worktreePath) => normalizePathForCompare(worktreePath))
  );
  const orphanedDirs = [];

  function visit(dirPath) {
    const normalizedDirPath = normalizePathForCompare(dirPath);

    if (activePathSet.has(normalizedDirPath)) {
      return;
    }

    if (looksLikeManagedWorktreeRoot(normalizedDirPath)) {
      orphanedDirs.push(normalizedDirPath);
      return;
    }

    for (const entry of readdirSync(normalizedDirPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      visit(path.join(normalizedDirPath, entry.name));
    }
  }

  visit(normalizedManagedRoot);
  return orphanedDirs;
}

function localBranchExists(branch) {
  return gitCommandSucceeds(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
}

export function removeOrphanedManagedWorktreeDirs({
  managedWorktreesRoot = MANAGED_WORKTREES_ROOT,
  activeWorktreePaths = [],
  branchExists = localBranchExists,
  removeDir = (dirPath) => rmSync(dirPath, { recursive: true, force: true }),
  pruneAncestors = pruneEmptyManagedAncestors,
  dryRun = false,
  log = console.log,
}) {
  const normalizedManagedRoot = normalizePathForCompare(managedWorktreesRoot);
  const orphanedDirs = findOrphanedManagedWorktreeDirs({
    managedWorktreesRoot: normalizedManagedRoot,
    activeWorktreePaths,
  });
  const summary = {
    removed: [],
    skippedExistingBranch: [],
  };

  orphanedDirs.forEach((dirPath) => {
    const branch = toBranchFromManagedWorktreePath(normalizedManagedRoot, dirPath);

    if (!branch || branch === '.') {
      return;
    }

    if (branchExists(branch)) {
      log(`Warning: orphaned directory still has a local branch: ${branch} → ${dirPath}`);
      summary.skippedExistingBranch.push({ branch, path: dirPath });
      return;
    }

    if (dryRun) {
      log(`[dry-run] Would remove orphaned worktree directory ${dirPath}`);
    } else {
      log(`Removing orphaned worktree directory ${dirPath}`);
      removeDir(dirPath);
      pruneAncestors(dirPath, normalizedManagedRoot);
    }

    summary.removed.push({ branch, path: dirPath });
  });

  return summary;
}

export function formatCleanupSummaryLine(label, worktrees) {
  if (worktrees.length === 0) {
    return `${label}: 0`;
  }

  const branches = worktrees.map((worktree) => worktree.branch).join(', ');
  return `${label}: ${worktrees.length} (${branches})`;
}

function getSummaryActionLabel({ dryRun, action, previewAction }) {
  return dryRun ? previewAction : action;
}

export function removeMergedWorktrees({
  mergedWorktrees,
  currentWorktreePath,
  currentBranch,
  normalizePath = normalizePathForCompare,
  checkWorktreeClean = isWorktreeClean,
  gitRunner = runGit,
  pruneAncestors = pruneEmptyManagedAncestors,
  dryRun = false,
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

    if (dryRun) {
      log(`[dry-run] Would remove worktree ${w.path}`);
      removedWorktree = true;
    } else {
      try {
        log(`Removing worktree ${w.path}`);
        gitRunner(['worktree', 'remove', '--', w.path], { stdio: 'inherit', exitOnError: false });
        removedWorktree = true;
      } catch {
        log(`Skipping worktree ${w.path}`);
        summary.skippedRemovalFailed.push(w);
      }
    }

    if (!removedWorktree) {
      return;
    }

    if (dryRun) {
      log(`[dry-run] Would delete branch ${w.branch}`);
      summary.removed.push(w);
      return;
    }

    try {
      log(`Deleting branch ${w.branch}`);
      gitRunner(['branch', '-D', '--', w.branch], { stdio: 'inherit', exitOnError: false });
      pruneAncestors(w.path);
      summary.removed.push(w);
    } catch {
      log(`Skipping branch ${w.branch}`);
      summary.skippedBranchDeleteFailed.push(w);
    }
  });

  return summary;
}

export function removeMergedBranchesWithoutWorktrees({
  mergedBranches,
  activeWorktreeBranches,
  currentBranch,
  gitRunner = runGit,
  dryRun = false,
  log = console.log,
}) {
  const activeBranches = new Set(activeWorktreeBranches);
  const summary = {
    removed: [],
    skippedCurrent: [],
    skippedActiveWorktree: [],
    skippedDeleteFailed: [],
  };

  mergedBranches.forEach((branch) => {
    if (branch === currentBranch) {
      log(`Skipping current branch: ${branch}`);
      summary.skippedCurrent.push({ branch });
      return;
    }

    if (activeBranches.has(branch)) {
      summary.skippedActiveWorktree.push({ branch });
      return;
    }

    if (dryRun) {
      log(`[dry-run] Would delete merged branch without worktree ${branch}`);
      summary.removed.push({ branch });
      return;
    }

    try {
      log(`Deleting merged branch without worktree ${branch}`);
      gitRunner(['branch', '-D', '--', branch], { stdio: 'inherit', exitOnError: false });
      summary.removed.push({ branch });
    } catch {
      log(`Skipping branch ${branch}`);
      summary.skippedDeleteFailed.push({ branch });
    }
  });

  return summary;
}

export function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Repository cleanup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (DRY_RUN) {
    console.log(
      'Dry run mode enabled. No fetch, prune, branch deletion, or filesystem removal will occur.\n'
    );
  }

  const status = runGit(['status', '--porcelain']).trim();
  if (status) {
    console.error(
      'Working tree is dirty. Please commit, stash, or discard your changes before running dev-cleanup.'
    );
    process.exit(1);
  }

  const currentBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();

  console.log('→ Fetching latest refs from origin');
  if (DRY_RUN) {
    console.log('[dry-run] Skipping fetch -- using current local refs');
  } else {
    runGit(['fetch', '--prune', 'origin'], { stdio: 'inherit' });
  }

  console.log('\n→ Pruning stale worktrees');
  if (DRY_RUN) {
    console.log('[dry-run] Skipping worktree prune');
  } else {
    runGit(['worktree', 'prune'], { stdio: 'inherit' });
  }

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

  const mergedWorktrees = worktrees.filter((w) => w.branch && mergedBranches.includes(w.branch));

  if (mergedWorktrees.length === 0) {
    console.log('None');
  } else {
    mergedWorktrees.forEach((w) => {
      console.log(`${w.branch} → ${w.path}`);
    });
  }

  console.log('\n→ Merged branches without an active worktree\n');

  const mergedBranchesWithoutWorktrees = mergedBranches.filter(
    (branch) => !worktrees.some((worktree) => worktree.branch === branch)
  );

  if (mergedBranchesWithoutWorktrees.length === 0) {
    console.log('None');
  } else {
    mergedBranchesWithoutWorktrees.forEach((branch) => {
      console.log(branch);
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
      dryRun: DRY_RUN,
    });

    const totalRemoved = removalSummary.removed.length;
    const totalSkipped =
      removalSummary.skippedCurrent.length +
      removalSummary.skippedDirty.length +
      removalSummary.skippedRemovalFailed.length +
      removalSummary.skippedBranchDeleteFailed.length;

    console.log('\n→ Cleanup summary\n');
    console.log(
      formatCleanupSummaryLine(
        getSummaryActionLabel({
          dryRun: DRY_RUN,
          action: 'Removed',
          previewAction: 'Would remove',
        }),
        removalSummary.removed
      )
    );
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

  if (AUTO) {
    const mergedBranchSummary = removeMergedBranchesWithoutWorktrees({
      mergedBranches: mergedBranchesWithoutWorktrees,
      activeWorktreeBranches: worktrees.map((worktree) => worktree.branch),
      currentBranch,
      dryRun: DRY_RUN,
    });

    console.log('\n→ Merged branches without worktrees cleanup\n');
    console.log(
      formatCleanupSummaryLine(
        getSummaryActionLabel({
          dryRun: DRY_RUN,
          action: 'Removed merged branches',
          previewAction: 'Would delete merged branches',
        }),
        mergedBranchSummary.removed
      )
    );
    console.log(
      formatCleanupSummaryLine('Skipped current branch', mergedBranchSummary.skippedCurrent)
    );
    console.log(
      formatCleanupSummaryLine(
        'Skipped active worktree branch',
        mergedBranchSummary.skippedActiveWorktree
      )
    );
    console.log(
      formatCleanupSummaryLine(
        'Skipped merged branch delete failed',
        mergedBranchSummary.skippedDeleteFailed
      )
    );

    const orphanedSummary = removeOrphanedManagedWorktreeDirs({
      activeWorktreePaths: worktrees.map((worktree) => worktree.path),
      dryRun: DRY_RUN,
    });

    console.log('\n→ Orphaned worktree directories\n');
    console.log(
      formatCleanupSummaryLine(
        getSummaryActionLabel({
          dryRun: DRY_RUN,
          action: 'Removed orphaned dirs',
          previewAction: 'Would remove orphaned dirs',
        }),
        orphanedSummary.removed
      )
    );
    console.log(
      formatCleanupSummaryLine(
        'Skipped orphaned dirs with local branch',
        orphanedSummary.skippedExistingBranch
      )
    );

    if (orphanedSummary.skippedExistingBranch.length > 0) {
      console.log(
        'Review skipped orphaned directories above. They still have local branches, which usually means Git metadata and the filesystem drifted out of sync.'
      );
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
