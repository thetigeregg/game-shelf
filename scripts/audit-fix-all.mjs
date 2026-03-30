#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shouldFix = process.argv.includes('--fix');

const projects = [
  { name: 'root', path: '.' },
  { name: 'server', path: 'server' },
  { name: 'worker', path: 'worker' },
  { name: 'hltb-scraper', path: 'hltb-scraper' },
  { name: 'metacritic-scraper', path: 'metacritic-scraper' },
  { name: 'psprices-scraper', path: 'psprices-scraper' },
];

function formatCommand(command, args) {
  return [command, ...args].join(' ');
}

function getExitCode(result) {
  if (typeof result.status === 'number') {
    return result.status;
  }

  return 1;
}

function runAudit(project) {
  const projectDir = resolve(repoRoot, project.path);
  const auditArgs = shouldFix ? ['audit', 'fix'] : ['audit'];
  const args = project.path === '.' ? auditArgs : ['--prefix', projectDir, ...auditArgs];

  console.log(`\n==============================`);
  console.log(`🔎 Auditing ${project.name}`);
  console.log(`==============================`);
  console.log(`Running: ${formatCommand(npmCommand, args)}`);

  const result = spawnSync(npmCommand, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`❌ ${project.name} failed to run`);
    console.error(result.error.message);

    return {
      name: project.name,
      exitCode: 1,
    };
  }

  const exitCode = getExitCode(result);

  if (exitCode === 0) {
    console.log(`✅ ${project.name} audit${shouldFix ? ' fix' : ''} completed`);
  } else {
    console.error(
      `⚠️ ${project.name} audit${shouldFix ? ' fix' : ''} exited with code ${exitCode}`
    );
  }

  return {
    name: project.name,
    exitCode,
  };
}

const failures = [];

for (const project of projects) {
  const result = runAudit(project);

  if (result.exitCode !== 0) {
    failures.push(result);
  }
}

if (failures.length === 0) {
  console.log(`\n✅ All audit${shouldFix ? ' fixes' : ''} completed successfully`);
  process.exit(0);
}

console.error(`\n⚠️ Audit${shouldFix ? ' fix' : ''} completed with remaining failures:`);

for (const failure of failures) {
  console.error(`- ${failure.name} (exit code ${failure.exitCode})`);
}

process.exit(1);
