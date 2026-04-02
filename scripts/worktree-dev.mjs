#!/usr/bin/env node

import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import {
  createWorktreeContext,
  ensureParentDirectories,
  ensureDependenciesInstalled,
  getSimulatorCertificateStatus,
  loadDevxConfig,
  printMissingCertificateInstructions,
  printWorktreeInfo,
  runComposeCommand,
  runFrontendDev,
  runPwaCommand,
  runWorktreeBootstrap,
} from '@thetigeregg/dev-cli';

const cwd = process.cwd();
const args = process.argv.slice(2);
const config = await loadDevxConfig({ cwd });
const context = await createWorktreeContext({ cwd, config });

export { ensureParentDirectories };

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

export function createSharedEnv({
  processEnv = process.env,
  manualsPublicBaseUrl = `http://127.0.0.1:${context.runtime.ports.EDGE_HOST_PORT}/manuals`,
} = {}) {
  return context.createSharedEnv({ processEnv, manualsPublicBaseUrl });
}

export function createPwaStackEnv(baseEnv = createSharedEnv()) {
  return {
    ...baseEnv,
    MANUALS_PUBLIC_BASE_URL: context.pwaManualsPublicBaseUrl,
  };
}

function setupPwaCertificates() {
  const certStatus = getSimulatorCertificateStatus(context);
  if (!certStatus.mkcertAvailable) {
    console.error('mkcert is required for the simulator PWA flow but was not found in PATH.');
    process.exit(1);
  }

  ensureParentDirectories([context.simulatorCertFile, context.simulatorKeyFile]);
  context.run('mkcert', ['-install'], context.createSharedEnv());
  context.run(
    'mkcert',
    [
      '-cert-file',
      context.simulatorCertFile,
      '-key-file',
      context.simulatorKeyFile,
      'localhost',
      '127.0.0.1',
      '::1',
    ],
    context.createSharedEnv()
  );

  const updatedStatus = getSimulatorCertificateStatus(context);
  console.log('Simulator PWA certificates are ready.');
  console.log(`Cert: ${updatedStatus.certPath}`);
  console.log(`Key:  ${updatedStatus.keyPath}`);
  if (updatedStatus.rootCaPath) {
    console.log(`mkcert root CA: ${updatedStatus.rootCaPath}`);
  }
  console.log(
    'If you need to install the mkcert root CA in iPhone Simulator, run: npm run dev:pwa:certs:serve-root'
  );
}

function reconcilePwaStackManualsBaseUrl() {
  console.log('Ensuring installed-PWA manual links stay on the local HTTPS origin.');
  console.log(
    'Recreating api and edge services if needed so MANUALS_PUBLIC_BASE_URL=/manuals is applied.'
  );
  context.run(
    'docker',
    [...context.composeArgs, 'up', '-d', 'api', 'edge'],
    createPwaStackEnv(context.createSharedEnv())
  );
}

export async function runPwa(
  command,
  {
    isPortReachableFn,
    reconcilePwaStackManualsBaseUrlFn = reconcilePwaStackManualsBaseUrl,
    buildPwaFn,
    runPwaServeFn,
    setupPwaCertificatesFn = setupPwaCertificates,
    getSimulatorCertificateStatusFn,
    printMissingCertificateInstructionsFn,
    servePwaRootCertificateFn,
    portsConfig,
    exitFn,
    logger,
  } = {}
) {
  const effectiveContext = portsConfig
    ? {
        ...context,
        runtime: {
          ...context.runtime,
          ports: {
            ...context.runtime.ports,
            ...portsConfig,
          },
        },
      }
    : context;

  return runPwaCommand(effectiveContext, command, {
    isPortReachableFn,
    reconcilePwaStackFn: reconcilePwaStackManualsBaseUrlFn
      ? () => reconcilePwaStackManualsBaseUrlFn()
      : undefined,
    buildPwaFn: buildPwaFn ? () => buildPwaFn() : undefined,
    runPwaServeFn: runPwaServeFn ? () => runPwaServeFn() : undefined,
    setupPwaCertificatesFn: setupPwaCertificatesFn ? () => setupPwaCertificatesFn() : undefined,
    getSimulatorCertificateStatusFn: getSimulatorCertificateStatusFn
      ? () => getSimulatorCertificateStatusFn()
      : undefined,
    printMissingCertificateInstructionsFn: printMissingCertificateInstructionsFn
      ? () => printMissingCertificateInstructionsFn()
      : () => printMissingCertificateInstructions(effectiveContext),
    servePwaRootCertificateFn: servePwaRootCertificateFn
      ? () => servePwaRootCertificateFn()
      : undefined,
    exitFn,
    logger,
  });
}

function runStack(action) {
  if (action === 'up-seed') {
    runComposeCommand(context, 'up');
    dbSeedApply(false);
    return;
  }

  try {
    runComposeCommand(context, action);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

function ensurePostgresRunning() {
  context.run('docker', [...context.composeArgs, 'up', '-d', 'postgres']);
}

function isCurrentDbEmpty() {
  const query = `docker ${context.composeArgs.join(' ')} exec -T postgres sh -lc ${shellEscape(
    `user_file="\${POSTGRES_USER_FILE:-/run/secrets/postgres_user}"; user="$(tr -d '\\r\\n' < "$user_file")"; db="\${POSTGRES_DB:-gameshelf}"; psql -Atq -U "$user" -d "$db" -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"`
  )}`;
  const output = context.runShellCapture(query, context.createSharedEnv()).trim();
  const count = Number.parseInt(output || '0', 10);
  if (!Number.isInteger(count)) {
    console.error(`Unable to determine table count from postgres output: ${output}`);
    process.exit(1);
  }
  return count === 0;
}

function reconcileGameSyncHistory() {
  console.log('Reconciling game sync history with current games table');
  const reconcileCmd = `docker ${context.composeArgs.join(' ')} exec -T postgres sh -lc ${shellEscape(
    `user_file="\${POSTGRES_USER_FILE:-/run/secrets/postgres_user}"; user="$(tr -d '\\r\\n' < "$user_file")"; db="\${POSTGRES_DB:-gameshelf}"; psql -v ON_ERROR_STOP=1 -U "$user" -d "$db" -c "BEGIN; DELETE FROM sync_events WHERE entity_type = 'game'; INSERT INTO sync_events (entity_type, entity_key, operation, payload, server_timestamp) SELECT 'game', igdb_game_id || '::' || platform_igdb_id::text, 'upsert', payload, NOW() FROM games; COMMIT;"`
  )}`;

  context.runShell(reconcileCmd, context.createSharedEnv());
  console.log('Game sync history reconciliation complete.');
}

function dbSeedRefresh() {
  const seedPath = context.defaultSeedPath();
  const tempSqlPath = `${seedPath}.tmp.sql`;
  const tempGzipPath = `${seedPath}.tmp.gz`;
  mkdirSync(path.dirname(seedPath), { recursive: true });

  ensurePostgresRunning();
  reconcileGameSyncHistory();

  console.log('Refreshing DB seed from current worktree postgres');
  const dumpCommand = `docker ${context.composeArgs.join(' ')} exec -T postgres sh -lc ${shellEscape(
    `user_file="\${POSTGRES_USER_FILE:-/run/secrets/postgres_user}"; user="$(tr -d '\\r\\n' < "$user_file")"; db="\${POSTGRES_DB:-gameshelf}"; pg_dump --clean --if-exists --no-owner --no-privileges -U "$user" -d "$db"`
  )} > ${shellEscape(tempSqlPath)}`;
  context.runShell(dumpCommand, context.createSharedEnv());

  const sqlSizeBytes = statSync(tempSqlPath).size;
  if (sqlSizeBytes < 1024) {
    context.runShell(`rm -f ${shellEscape(tempSqlPath)}`, context.createSharedEnv());
    console.error(
      `Seed refresh aborted: dump looks too small (${String(sqlSizeBytes)} bytes). Existing seed preserved.`
    );
    process.exit(1);
  }

  const dumpLooksValid = spawnSync(
    'sh',
    ['-lc', `grep -Eq "^(CREATE TABLE|COPY )" ${shellEscape(tempSqlPath)}`],
    {
      cwd: context.cwd,
      env: context.createSharedEnv(),
      stdio: 'ignore',
    }
  );
  if (dumpLooksValid.status !== 0) {
    context.runShell(`rm -f ${shellEscape(tempSqlPath)}`, context.createSharedEnv());
    console.error(
      'Seed refresh aborted: dump did not include expected schema/data statements. Existing seed preserved.'
    );
    process.exit(1);
  }

  context.runShell(
    `gzip -c ${shellEscape(tempSqlPath)} > ${shellEscape(tempGzipPath)}`,
    context.createSharedEnv()
  );
  context.runShell(
    `mv ${shellEscape(tempGzipPath)} ${shellEscape(seedPath)}`,
    context.createSharedEnv()
  );
  context.runShell(`rm -f ${shellEscape(tempSqlPath)}`, context.createSharedEnv());
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

  const restoreCmd = `docker ${context.composeArgs.join(' ')} exec -T postgres sh -lc ${shellEscape(
    `user_file="\${POSTGRES_USER_FILE:-/run/secrets/postgres_user}"; user="$(tr -d '\\r\\n' < "$user_file")"; db="\${POSTGRES_DB:-gameshelf}"; psql -v ON_ERROR_STOP=1 -U "$user" -d "$db"`
  )}`;

  context.runShell(`${sourceCmd} | ${restoreCmd}`, context.createSharedEnv());
}

function dbSeedApply(force) {
  const seedPath = context.defaultSeedPath();
  ensurePostgresRunning();

  if (!force && !isCurrentDbEmpty()) {
    console.log(
      'Current worktree DB is not empty. Skipping seed restore. Use --force to overwrite.'
    );
    return;
  }

  console.log('Restoring DB seed into current worktree postgres');
  dbSeedRestoreFromFile(seedPath);
  reconcileGameSyncHistory();
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

  if (command === 'sync-rebuild') {
    ensurePostgresRunning();
    reconcileGameSyncHistory();
    return;
  }

  console.error(
    'Unknown db command. Use: seed-refresh | seed-apply | seed-apply-force | sync-rebuild'
  );
  process.exit(1);
}

function parseOptions(values) {
  const options = {
    force: false,
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

export function isEntrypoint({ argv1 = process.argv[1], moduleUrl = import.meta.url } = {}) {
  if (!argv1) {
    return false;
  }

  return pathToFileURL(path.resolve(argv1)).href === moduleUrl;
}

export async function runWorktreeDev(argv) {
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help') {
    console.log(
      'Usage: node scripts/worktree-dev.mjs <info|bootstrap|frontend|simulator|pwa|stack|db> [action]'
    );
    console.log('');
    console.log('Commands:');
    console.log('  info                      Show derived project name, ports, and seed path');
    console.log(
      '  bootstrap [--force]       Bootstrap .env (overwrite existing with --force) and install deps if missing'
    );
    console.log('  frontend                  Run Angular dev server for this worktree');
    console.log(
      '  simulator                 Run Angular dev server on all interfaces for Safari in Simulator'
    );
    console.log(
      '  pwa build                 Build production frontend for installed-PWA simulator testing'
    );
    console.log(
      '  pwa serve                 Serve built frontend over HTTPS with /api and /manuals proxying'
    );
    console.log('  pwa simulator             Build and serve installed-PWA simulator flow');
    console.log(
      '  pwa certs-setup           Generate required mkcert localhost certs for simulator PWA serving'
    );
    console.log(
      '  pwa certs-check           Validate local HTTPS cert/key files for simulator PWA serving'
    );
    console.log(
      '  pwa certs-serve-root      Serve the mkcert root CA so Simulator can install and trust it'
    );
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
    console.log('  db sync-rebuild           Rebuild game sync events from current games table');
    console.log('');
    console.log('Optional env vars:');
    console.log(
      `  WORKTREE_PORT_OFFSET      Force a fixed per-worktree offset (0-${String((config.worktree.runtime?.maxPortOffset ?? 10000) - 1)})`
    );
    console.log('  WORKTREE_ENV_FILE         Shared template used to auto-bootstrap .env');
    console.log('  DEV_DB_SEED_PATH          Override shared seed file path');
    console.log(
      '  WORKTREE_PWA_CERT_FILE    Override local HTTPS cert path for simulator PWA serving'
    );
    console.log(
      '  WORKTREE_PWA_KEY_FILE     Override local HTTPS key path for simulator PWA serving'
    );
    process.exit(0);
  }

  if (argv[0] === 'info') {
    printWorktreeInfo(context);
    process.exit(0);
  }

  if (argv[0] === 'bootstrap') {
    const bootstrapArgs = argv.slice(1);
    if (bootstrapArgs.includes('--help') || bootstrapArgs.includes('help')) {
      console.log('Usage: node scripts/worktree-dev.mjs bootstrap [--force]');
      console.log('');
      console.log('Options:');
      console.log('  --force   Overwrite existing .env from shared template');
      process.exit(0);
    }

    runWorktreeBootstrap(context, parseOptions(bootstrapArgs));
    process.exit(0);
  }

  if (argv[0] === 'frontend') {
    context.createSharedEnv();
    printWorktreeInfo(context);
    ensureDependenciesInstalled(context, false);
    runFrontendDev(context);
    process.exit(0);
  }

  if (argv[0] === 'simulator') {
    printWorktreeInfo(context);
    ensureDependenciesInstalled(context, false);
    runFrontendDev(context, {
      external: true,
      host: config.worktree.frontend?.externalHost ?? '0.0.0.0',
    });
    process.exit(0);
  }

  if (argv[0] === 'stack') {
    if (!argv[1]) {
      console.error('Missing stack action. Use: up | up-seed | down | restart | logs | ps');
      process.exit(1);
    }
    printWorktreeInfo(context);
    runStack(argv[1]);
    process.exit(0);
  }

  if (argv[0] === 'db') {
    if (!argv[1]) {
      console.error('Missing db action. Use: seed-refresh | seed-apply | seed-apply-force');
      process.exit(1);
    }
    printWorktreeInfo(context);
    runDb(argv[1], parseOptions(argv.slice(2)));
    process.exit(0);
  }

  if (argv[0] === 'pwa') {
    if (!argv[1]) {
      console.error(
        'Missing pwa action. Use: build | serve | simulator | certs-setup | certs-check | certs-serve-root'
      );
      process.exit(1);
    }
    printWorktreeInfo(context);
    ensureDependenciesInstalled(context, false);
    await runPwa(argv[1]);
    process.exit(0);
  }

  console.error('Unknown command. Use --help for usage.');
  process.exit(1);
}

if (isEntrypoint()) {
  await runWorktreeDev(args);
}
