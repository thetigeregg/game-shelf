#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const SHOULD_FIX = process.argv.includes('--fix');

export const PROJECTS = [
  { name: 'root', path: '.' },
  { name: 'server', path: 'server' },
  { name: 'worker', path: 'worker' },
  { name: 'hltb-scraper', path: 'hltb-scraper' },
  { name: 'metacritic-scraper', path: 'metacritic-scraper' },
  { name: 'psprices-scraper', path: 'psprices-scraper' },
];

export function formatCommand(command, args) {
  return [command, ...args].join(' ');
}

export function getExitCode(result) {
  if (typeof result.status === 'number') {
    return result.status;
  }

  return 1;
}

export function buildAuditArgs(projectPath, shouldFix = false, repoRoot = REPO_ROOT) {
  const auditArgs = shouldFix ? ['audit', 'fix'] : ['audit'];

  if (projectPath === '.') {
    return auditArgs;
  }

  return ['--prefix', resolve(repoRoot, projectPath), ...auditArgs];
}

export function runAudit(
  project,
  {
    repoRoot = REPO_ROOT,
    npmCommand = NPM_COMMAND,
    shouldFix = false,
    spawn = spawnSync,
    log = console.log,
    errorLog = console.error,
  } = {}
) {
  const args = buildAuditArgs(project.path, shouldFix, repoRoot);

  log(`\n==============================`);
  log(`🔎 Auditing ${project.name}`);
  log(`==============================`);
  log(`Running: ${formatCommand(npmCommand, args)}`);

  const result = spawn(npmCommand, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    errorLog(`❌ ${project.name} failed to run`);
    errorLog(result.error.message);

    return {
      name: project.name,
      exitCode: 1,
    };
  }

  const exitCode = getExitCode(result);

  if (exitCode === 0) {
    log(`✅ ${project.name} audit${shouldFix ? ' fix' : ''} completed`);
  } else {
    errorLog(`⚠️ ${project.name} audit${shouldFix ? ' fix' : ''} exited with code ${exitCode}`);
  }

  return {
    name: project.name,
    exitCode,
  };
}

export function runAudits({
  projects = PROJECTS,
  repoRoot = REPO_ROOT,
  npmCommand = NPM_COMMAND,
  shouldFix = false,
  spawn = spawnSync,
  log = console.log,
  errorLog = console.error,
} = {}) {
  const failures = [];

  for (const project of projects) {
    const result = runAudit(project, {
      repoRoot,
      npmCommand,
      shouldFix,
      spawn,
      log,
      errorLog,
    });

    if (result.exitCode !== 0) {
      failures.push(result);
    }
  }

  if (failures.length === 0) {
    log(`\n✅ All audit${shouldFix ? ' fixes' : 's'} completed successfully`);
    return {
      failures,
      exitCode: 0,
    };
  }

  errorLog(`\n⚠️ Audit${shouldFix ? ' fixes' : 's'} completed with remaining failures:`);

  for (const failure of failures) {
    errorLog(`- ${failure.name} (exit code ${failure.exitCode})`);
  }

  return {
    failures,
    exitCode: 1,
  };
}

export function isEntrypoint({ argv1 = process.argv[1], moduleUrl = import.meta.url } = {}) {
  if (!argv1) {
    return false;
  }

  // Resolve the invoked path before comparing so relative CLI calls still match.
  return pathToFileURL(resolve(argv1)).href === moduleUrl;
}

if (isEntrypoint()) {
  process.exit(runAudits({ shouldFix: SHOULD_FIX }).exitCode);
}
