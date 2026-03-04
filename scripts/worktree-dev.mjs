#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cwd = process.cwd();
const args = process.argv.slice(2);
const composeArgs = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml'];
const MAX_PORT_OFFSET = 10000;

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
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_PORT_OFFSET) {
      return parsed;
    }
    console.error(
      `WORKTREE_PORT_OFFSET must be an integer between 0 and ${String(MAX_PORT_OFFSET)}`
    );
    process.exit(1);
  }

  const hashHex = createHash('sha256').update(repoPath).digest('hex');
  return Number.parseInt(hashHex.slice(0, 8), 16) % MAX_PORT_OFFSET;
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function configState(value) {
  return value ? '[configured]' : '(not set)';
}

function expandUserPath(value) {
  if (!value) {
    return value;
  }

  if (value === '~') {
    return os.homedir();
  }

  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
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

const localEnvPath = path.resolve(cwd, '.env');
const defaultSharedEnvFile = path.join(os.homedir(), '.config', 'game-shelf', 'worktree.env');
const sharedEnvFilePath =
  expandUserPath(process.env.WORKTREE_ENV_FILE && process.env.WORKTREE_ENV_FILE.trim()) ||
  defaultSharedEnvFile;

const defaultSharedSecretsDir = path.join(os.homedir(), '.config', 'game-shelf', 'nas-secrets');
const explicitSecretsHostDir = expandUserPath(
  process.env.SECRETS_HOST_DIR && process.env.SECRETS_HOST_DIR.trim()
);
const secretsHostDir =
  explicitSecretsHostDir || (existsSync(defaultSharedSecretsDir) ? defaultSharedSecretsDir : '');

const corsOrigin = [
  `http://127.0.0.1:${ports.FRONTEND_PORT}`,
  `http://localhost:${ports.FRONTEND_PORT}`,
  `http://127.0.0.1:${ports.EDGE_HOST_PORT}`,
  `http://localhost:${ports.EDGE_HOST_PORT}`
].join(',');

const sharedEnv = {
  ...process.env,
  ...(secretsHostDir ? { SECRETS_HOST_DIR: secretsHostDir } : {}),
  COMPOSE_PROJECT_NAME: projectName,
  ...ports,
  CORS_ORIGIN: corsOrigin,
  MANUALS_PUBLIC_BASE_URL: `http://127.0.0.1:${ports.EDGE_HOST_PORT}/manuals`
};

function defaultSeedPath() {
  const base =
    expandUserPath(process.env.DEV_DB_SEED_PATH) ||
    path.join(os.homedir(), '.cache', 'game-shelf', 'dev-db-seed', 'latest.sql.gz');
  return path.resolve(base);
}

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

function runCapture(command, commandArgs, env = sharedEnv) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(result.status);
  }

  return result.stdout ?? '';
}

function runShell(command, env = sharedEnv) {
  run('sh', ['-lc', command], env);
}

function runShellCapture(command, env = sharedEnv) {
  return runCapture('sh', ['-lc', command], env);
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
  if (secretsHostDir) {
    console.log(`Secrets dir: ${configState(secretsHostDir)}`);
  } else {
    console.log('Secrets dir: ./nas-secrets (worktree-local default)');
  }
  if (existsSync(localEnvPath)) {
    console.log('Env file: [present]');
  } else if (existsSync(sharedEnvFilePath)) {
    console.log('Env file: [missing; shared template configured]');
  } else {
    console.log('Env file: [missing; shared template not configured]');
  }
  console.log(`DB seed file: ${configState(defaultSeedPath())}`);
}

function ensureLocalEnvFromSharedTemplate() {
  if (existsSync(localEnvPath)) {
    return;
  }

  if (!existsSync(sharedEnvFilePath)) {
    return;
  }

  mkdirSync(path.dirname(localEnvPath), { recursive: true });
  copyFileSync(sharedEnvFilePath, localEnvPath);
  console.log('Bootstrapped .env from shared template');
}

function listMissingDependencyDirs() {
  const requiredNodeModules = [
    path.resolve(cwd, 'node_modules'),
    path.resolve(cwd, 'server', 'node_modules'),
    path.resolve(cwd, 'worker', 'node_modules'),
    path.resolve(cwd, 'hltb-scraper', 'node_modules'),
    path.resolve(cwd, 'metacritic-scraper', 'node_modules')
  ];

  return requiredNodeModules.filter((moduleDir) => !existsSync(moduleDir));
}

function ensureDependenciesInstalled(forceInstall = false) {
  const missing = listMissingDependencyDirs();

  if (!forceInstall && missing.length === 0) {
    return;
  }

  if (missing.length > 0) {
    console.log('Missing dependency directories detected:');
    for (const moduleDir of missing) {
      console.log(`  - ${moduleDir}`);
    }
  }

  console.log('Installing workspace dependencies via: npm run i:all');
  run('npm', ['run', 'i:all'], sharedEnv);
}

function runStack(action) {
  if (action === 'up') {
    run('docker', [
      ...composeArgs,
      'up',
      '-d',
      '--build',
      'postgres',
      'hltb-scraper',
      'metacritic-scraper',
      'api',
      'edge'
    ]);
    return;
  }

  if (action === 'up-seed') {
    runStack('up');
    dbSeedApply(false);
    return;
  }

  if (action === 'down') {
    run('docker', [...composeArgs, 'down']);
    return;
  }

  if (action === 'restart') {
    run('docker', [
      ...composeArgs,
      'restart',
      'edge',
      'api',
      'postgres',
      'hltb-scraper',
      'metacritic-scraper'
    ]);
    return;
  }

  if (action === 'logs') {
    run('docker', [
      ...composeArgs,
      'logs',
      '-f',
      'edge',
      'api',
      'postgres',
      'hltb-scraper',
      'metacritic-scraper'
    ]);
    return;
  }

  if (action === 'ps') {
    run('docker', [...composeArgs, 'ps']);
    return;
  }

  console.error('Unknown stack action. Use: up | up-seed | down | restart | logs | ps');
  process.exit(1);
}

function runFrontend() {
  const tempDir = path.resolve(cwd, '.tmp');
  mkdirSync(tempDir, { recursive: true });

  const proxyPath = path.join(tempDir, `proxy.worktree.${worktreeHint}.json`);
  const proxyConfig = {
    '/v1': {
      target: `http://127.0.0.1:${ports.API_HOST_PORT}`,
      secure: false,
      changeOrigin: true,
      logLevel: 'warn'
    },
    '/manuals': {
      target: `http://127.0.0.1:${ports.EDGE_HOST_PORT}`,
      secure: false,
      changeOrigin: true,
      logLevel: 'warn'
    }
  };

  writeFileSync(proxyPath, `${JSON.stringify(proxyConfig, null, 2)}\n`, 'utf8');

  run('npm', ['run', 'prestart'], sharedEnv);
  run(
    'npx',
    ['ng', 'serve', '--port', String(ports.FRONTEND_PORT), '--proxy-config', proxyPath],
    sharedEnv
  );
}

function ensurePostgresRunning() {
  run('docker', [...composeArgs, 'up', '-d', 'postgres']);
}

function isCurrentDbEmpty() {
  const query = `docker ${composeArgs.join(' ')} exec -T postgres sh -lc ${shellEscape(
    `user_file="\${POSTGRES_USER_FILE:-/run/secrets/postgres_user}"; user="$(tr -d '\\r\\n' < "$user_file")"; db="\${POSTGRES_DB:-gameshelf}"; psql -Atq -U "$user" -d "$db" -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"`
  )}`;
  const output = runShellCapture(query).trim();
  const count = Number.parseInt(output || '0', 10);
  if (!Number.isInteger(count)) {
    console.error(`Unable to determine table count from postgres output: ${output}`);
    process.exit(1);
  }
  return count === 0;
}

function dbSeedRefresh() {
  const seedPath = defaultSeedPath();
  const tempSqlPath = `${seedPath}.tmp.sql`;
  const tempGzipPath = `${seedPath}.tmp.gz`;
  mkdirSync(path.dirname(seedPath), { recursive: true });

  ensurePostgresRunning();

  console.log('Refreshing DB seed from current worktree postgres');
  const dumpCommand = `docker ${composeArgs.join(' ')} exec -T postgres sh -lc ${shellEscape(
    `user_file="\${POSTGRES_USER_FILE:-/run/secrets/postgres_user}"; user="$(tr -d '\\r\\n' < "$user_file")"; db="\${POSTGRES_DB:-gameshelf}"; pg_dump --clean --if-exists --no-owner --no-privileges -U "$user" -d "$db"`
  )} > ${shellEscape(tempSqlPath)}`;
  runShell(dumpCommand);

  const sqlSizeBytes = statSync(tempSqlPath).size;
  if (sqlSizeBytes < 1024) {
    runShell(`rm -f ${shellEscape(tempSqlPath)}`);
    console.error(
      `Seed refresh aborted: dump looks too small (${String(sqlSizeBytes)} bytes). Existing seed preserved.`
    );
    process.exit(1);
  }

  const dumpLooksValid = spawnSync(
    'sh',
    ['-lc', `grep -Eq "^(CREATE TABLE|COPY )" ${shellEscape(tempSqlPath)}`],
    {
      cwd,
      env: sharedEnv,
      stdio: 'ignore'
    }
  );
  if (dumpLooksValid.status !== 0) {
    runShell(`rm -f ${shellEscape(tempSqlPath)}`);
    console.error(
      'Seed refresh aborted: dump did not include expected schema/data statements. Existing seed preserved.'
    );
    process.exit(1);
  }

  runShell(`gzip -c ${shellEscape(tempSqlPath)} > ${shellEscape(tempGzipPath)}`);
  runShell(`mv ${shellEscape(tempGzipPath)} ${shellEscape(seedPath)}`);
  runShell(`rm -f ${shellEscape(tempSqlPath)}`);
  console.log('Seed refresh complete.');
}

function dbSeedRestoreFromFile(seedPath) {
  if (!existsSync(seedPath)) {
    console.error(`Seed file not found: ${seedPath}`);
    process.exit(1);
  }

  const sourceCmd = seedPath.endsWith('.gz')
    ? `gzip -dc ${shellEscape(seedPath)}`
    : `cat ${shellEscape(seedPath)}`;

  const restoreCmd = `docker ${composeArgs.join(' ')} exec -T postgres sh -lc ${shellEscape(
    `user_file="\${POSTGRES_USER_FILE:-/run/secrets/postgres_user}"; user="$(tr -d '\\r\\n' < "$user_file")"; db="\${POSTGRES_DB:-gameshelf}"; psql -v ON_ERROR_STOP=1 -U "$user" -d "$db"`
  )}`;

  runShell(`${sourceCmd} | ${restoreCmd}`);
}

function dbSeedApply(force) {
  const seedPath = defaultSeedPath();
  ensurePostgresRunning();

  if (!force && !isCurrentDbEmpty()) {
    console.log(
      'Current worktree DB is not empty. Skipping seed restore. Use --force to overwrite.'
    );
    return;
  }

  console.log('Restoring DB seed into current worktree postgres');
  dbSeedRestoreFromFile(seedPath);
  console.log('Seed restore complete.');
}

function runDb(command, opts) {
  if (command === 'seed-refresh') {
    dbSeedRefresh();
    return;
  }

  if (command === 'seed-apply') {
    dbSeedApply(Boolean(opts.force));
    return;
  }

  if (command === 'seed-apply-force') {
    dbSeedApply(true);
    return;
  }

  console.error('Unknown db command. Use: seed-refresh | seed-apply | seed-apply-force');
  process.exit(1);
}

function parseOptions(values) {
  const options = {
    force: false
  };

  for (const value of values) {
    if (value === '--force') {
      options.force = true;
      continue;
    }

    console.error(`Unknown option: ${value}`);
    process.exit(1);
  }

  return options;
}

if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
  console.log('Usage: node scripts/worktree-dev.mjs <info|bootstrap|frontend|stack|db> [action]');
  console.log('');
  console.log('Commands:');
  console.log('  info                      Show derived project name, ports, and seed path');
  console.log('  bootstrap                 Bootstrap .env and install deps if missing');
  console.log('  frontend                  Run Angular dev server for this worktree');
  console.log('  stack up                  Start worktree-isolated docker stack');
  console.log('  stack up-seed             Start stack and seed DB only when empty');
  console.log('  stack down                Stop/remove worktree-isolated docker stack');
  console.log('  stack restart             Restart worktree-isolated services');
  console.log('  stack logs                Follow stack logs');
  console.log('  stack ps                  Show stack status');
  console.log(
    '  db seed-refresh           Create/update shared seed dump from current worktree DB'
  );
  console.log('  db seed-apply [--force]   Restore shared seed dump into current worktree DB');
  console.log('');
  console.log('Optional env vars:');
  console.log(
    `  WORKTREE_PORT_OFFSET      Force a fixed per-worktree offset (0-${String(MAX_PORT_OFFSET)})`
  );
  console.log('  WORKTREE_ENV_FILE         Shared template used to auto-bootstrap .env');
  console.log('  DEV_DB_SEED_PATH          Override shared seed file path');
  process.exit(0);
}

if (args[0] === 'info') {
  printInfo();
  process.exit(0);
}

if (args[0] === 'bootstrap') {
  ensureLocalEnvFromSharedTemplate();
  printInfo();
  ensureDependenciesInstalled(false);
  process.exit(0);
}

if (args[0] === 'frontend') {
  ensureLocalEnvFromSharedTemplate();
  printInfo();
  ensureDependenciesInstalled(false);
  runFrontend();
  process.exit(0);
}

if (args[0] === 'stack') {
  if (!args[1]) {
    console.error('Missing stack action. Use: up | up-seed | down | restart | logs | ps');
    process.exit(1);
  }
  ensureLocalEnvFromSharedTemplate();
  printInfo();
  runStack(args[1]);
  process.exit(0);
}

if (args[0] === 'db') {
  if (!args[1]) {
    console.error('Missing db action. Use: seed-refresh | seed-apply | seed-apply-force');
    process.exit(1);
  }
  ensureLocalEnvFromSharedTemplate();
  printInfo();
  runDb(args[1], parseOptions(args.slice(2)));
  process.exit(0);
}

console.error('Unknown command. Use --help for usage.');
process.exit(1);
