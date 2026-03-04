#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cwd = process.cwd();
const args = process.argv.slice(2);

function sanitize(value, maxLength = 63) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, maxLength);
}

function detectWorktreeHint(repoPath) {
  const segments = repoPath.split(path.sep).filter(Boolean);
  const worktreesIndex = segments.lastIndexOf('worktrees');
  if (worktreesIndex >= 0 && segments[worktreesIndex + 1]) {
    return segments[worktreesIndex + 1];
  }
  return path.basename(repoPath);
}

function computeOffset(repoPath) {
  const explicitOffset = process.env.WORKTREE_PORT_OFFSET;
  if (explicitOffset !== undefined) {
    const parsed = Number.parseInt(explicitOffset, 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 2000) {
      return parsed;
    }
    console.error('WORKTREE_PORT_OFFSET must be an integer between 0 and 2000');
    process.exit(1);
  }

  const hashHex = createHash('sha256').update(repoPath).digest('hex');
  return Number.parseInt(hashHex.slice(0, 4), 16) % 200;
}

const worktreeHint = sanitize(detectWorktreeHint(cwd), 24) || 'default';
const portOffset = computeOffset(cwd);
const projectHash = createHash('sha256').update(cwd).digest('hex').slice(0, 6);
const projectName = sanitize(`gameshelf-${worktreeHint}-${projectHash}`) || 'gameshelf-default';

const ports = {
  FRONTEND_PORT: 8100 + portOffset,
  EDGE_HOST_PORT: 8080 + portOffset,
  API_HOST_PORT: 3000 + portOffset,
  POSTGRES_HOST_PORT: 5432 + portOffset,
  HLTB_HOST_PORT: 8788 + portOffset,
  METACRITIC_HOST_PORT: 8789 + portOffset
};

const corsOrigin = [
  `http://127.0.0.1:${ports.FRONTEND_PORT}`,
  `http://localhost:${ports.FRONTEND_PORT}`,
  `http://127.0.0.1:${ports.EDGE_HOST_PORT}`,
  `http://localhost:${ports.EDGE_HOST_PORT}`
].join(',');

const sharedEnv = {
  ...process.env,
  COMPOSE_PROJECT_NAME: projectName,
  ...ports,
  CORS_ORIGIN: corsOrigin,
  MANUALS_PUBLIC_BASE_URL: `http://127.0.0.1:${ports.EDGE_HOST_PORT}/manuals`
};

function run(command, commandArgs, env = sharedEnv) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    stdio: 'inherit'
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

function printInfo() {
  console.log(`Worktree path: ${cwd}`);
  console.log(`Compose project: ${projectName}`);
  console.log(`Port offset: ${portOffset}`);
  console.log('Ports:');
  console.log(`  frontend:   http://127.0.0.1:${ports.FRONTEND_PORT}`);
  console.log(`  edge:       http://127.0.0.1:${ports.EDGE_HOST_PORT}`);
  console.log(`  api:        http://127.0.0.1:${ports.API_HOST_PORT}`);
  console.log(`  postgres:   127.0.0.1:${ports.POSTGRES_HOST_PORT}`);
  console.log(`  hltb:       http://127.0.0.1:${ports.HLTB_HOST_PORT}`);
  console.log(`  metacritic: http://127.0.0.1:${ports.METACRITIC_HOST_PORT}`);
}

function runStack(action) {
  const composeArgs = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml'];

  if (action === 'up') {
    run('docker', [...composeArgs, 'up', '-d', '--build', 'postgres', 'hltb-scraper', 'metacritic-scraper', 'api', 'edge']);
    return;
  }

  if (action === 'down') {
    run('docker', [...composeArgs, 'down']);
    return;
  }

  if (action === 'restart') {
    run('docker', [...composeArgs, 'restart', 'edge', 'api', 'postgres', 'hltb-scraper', 'metacritic-scraper']);
    return;
  }

  if (action === 'logs') {
    run('docker', [...composeArgs, 'logs', '-f', 'edge', 'api', 'postgres', 'hltb-scraper', 'metacritic-scraper']);
    return;
  }

  if (action === 'ps') {
    run('docker', [...composeArgs, 'ps']);
    return;
  }

  console.error('Unknown stack action. Use: up | down | restart | logs | ps');
  process.exit(1);
}

function runFrontend() {
  const tempDir = path.resolve(cwd, '.tmp');
  mkdirSync(tempDir, { recursive: true });

  const proxyPath = path.join(tempDir, `proxy.worktree.${worktreeHint}.json`);
  const proxyConfig = {
    '/manuals': {
      target: `http://127.0.0.1:${ports.EDGE_HOST_PORT}`,
      secure: false,
      changeOrigin: true,
      logLevel: 'warn'
    }
  };

  writeFileSync(proxyPath, `${JSON.stringify(proxyConfig, null, 2)}\n`, 'utf8');

  run('npm', ['run', 'prestart'], sharedEnv);
  run('npx', ['ng', 'serve', '--port', String(ports.FRONTEND_PORT), '--proxy-config', proxyPath], sharedEnv);
}

if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
  console.log('Usage: node scripts/worktree-dev.mjs <info|frontend|stack> [action]');
  console.log('');
  console.log('Commands:');
  console.log('  info                 Show derived project name and ports');
  console.log('  frontend             Run Angular dev server for this worktree');
  console.log('  stack up             Start worktree-isolated docker stack');
  console.log('  stack down           Stop/remove worktree-isolated docker stack');
  console.log('  stack restart        Restart worktree-isolated services');
  console.log('  stack logs           Follow stack logs');
  console.log('  stack ps             Show stack status');
  process.exit(0);
}

if (args[0] === 'info') {
  printInfo();
  process.exit(0);
}

if (args[0] === 'frontend') {
  printInfo();
  runFrontend();
  process.exit(0);
}

if (args[0] === 'stack') {
  if (!args[1]) {
    console.error('Missing stack action. Use: up | down | restart | logs | ps');
    process.exit(1);
  }
  printInfo();
  runStack(args[1]);
  process.exit(0);
}

console.error('Unknown command. Use --help for usage.');
process.exit(1);
