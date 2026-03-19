#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const ncuCommand = resolve(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'ncu.cmd' : 'ncu'
);

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

function getExitCode(error) {
  if (error && typeof error === 'object') {
    if ('status' in error && typeof error.status === 'number') {
      return error.status;
    }

    if ('code' in error && typeof error.code === 'number') {
      return error.code;
    }
  }

  return 1;
}

function run(command, args, cwd) {
  const commandString = formatCommand(command, args);

  try {
    execFileSync(command, args, { cwd, stdio: 'inherit' });
  } catch (error) {
    if (error && typeof error === 'object') {
      error.commandString = commandString;
    }

    throw error;
  }
}

for (const project of projects) {
  const projectDir = resolve(repoRoot, project.path);

  console.log(`\n==============================`);
  console.log(`📦 Updating ${project.name}`);
  console.log(`==============================`);

  try {
    run(ncuCommand, ['-i'], projectDir);
    run(npmCommand, ['install'], projectDir);
  } catch (error) {
    const commandString =
      error &&
      typeof error === 'object' &&
      'commandString' in error &&
      typeof error.commandString === 'string'
        ? error.commandString
        : error && typeof error === 'object' && 'path' in error && typeof error.path === 'string'
          ? formatCommand(
              error.path,
              Array.isArray(error.spawnargs) ? error.spawnargs.slice(1) : []
            )
          : 'unknown command';
    const message = error instanceof Error ? error.message : String(error);

    console.error(`❌ Failed in ${project.name}`);
    console.error(`Command failed: ${commandString}`);
    console.error(message);
    process.exit(getExitCode(error));
  }
}

console.log('\n✅ All projects updated successfully');
