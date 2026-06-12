import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  createFrontendProxyConfig,
  createWorktreeContext,
  isPortReachable,
  loadDevxConfig,
} from '@thetigeregg/dev-cli';

import { VARIANTS, buildCapRunArgs, loadRunIosEnv, resolveVariant } from './ios-run-common.mjs';
import { resolveLanHost } from './lan-host.mjs';

export {
  VARIANTS,
  RUN_VARIANTS,
  buildCapRunArgs,
  loadRunIosEnv,
  resolveScheme,
  resolveVariant,
} from './ios-run-common.mjs';

const LIVE_RELOAD_SERVE_CONFIGURATION = 'ios-live';
const LOCAL_ENVIRONMENT_FILE = 'src/environments/environment.local.ts';
const LOCAL_ENVIRONMENT_EXAMPLE_FILE = 'src/environments/environment.local.example.ts';
const WEB_BUILD_ROOT = 'www/browser';

export function resolveLiveReloadHost(envValues = {}, options = {}) {
  const host = resolveLanHost(envValues, options);
  if (!host) {
    throw new Error(
      'Unable to resolve LAN host for live reload. Set IOS_LAN_HOST in .env to your Mac Wi-Fi IP address.'
    );
  }

  return host;
}

export function buildNgServeArgs(context, proxyPath) {
  const bindHost = context.config.worktree.frontend?.externalHost ?? '0.0.0.0';

  return [
    '--port',
    String(context.runtime.ports.FRONTEND_PORT),
    '--host',
    bindHost,
    '--proxy-config',
    proxyPath,
    '--configuration',
    LIVE_RELOAD_SERVE_CONFIGURATION,
  ];
}

export function buildCapLiveReloadArgs({
  env = process.env,
  frontendPort,
  lanHost,
  extraArgs = [],
}) {
  return buildCapRunArgs({
    variant: 'live',
    env,
    extraArgs: ['--live-reload', '--host', lanHost, '--port', String(frontendPort), ...extraArgs],
  });
}

export function ensureLocalEnvironmentFile(
  cwd,
  { log = console.log, copyFile = copyFileSync } = {}
) {
  const localEnvironmentPath = path.resolve(cwd, LOCAL_ENVIRONMENT_FILE);
  if (existsSync(localEnvironmentPath)) {
    return localEnvironmentPath;
  }

  const examplePath = path.resolve(cwd, LOCAL_ENVIRONMENT_EXAMPLE_FILE);
  if (!existsSync(examplePath)) {
    throw new Error(
      `Missing ${LOCAL_ENVIRONMENT_FILE} and ${LOCAL_ENVIRONMENT_EXAMPLE_FILE}. Create ${LOCAL_ENVIRONMENT_FILE} before running live reload.`
    );
  }

  copyFile(examplePath, localEnvironmentPath);
  log(`Created ${LOCAL_ENVIRONMENT_FILE} from ${LOCAL_ENVIRONMENT_EXAMPLE_FILE}.`);
  return localEnvironmentPath;
}

function assertWebBuildOutput(cwd) {
  const webBuildPath = path.resolve(cwd, WEB_BUILD_ROOT);
  if (existsSync(webBuildPath)) {
    return;
  }

  throw new Error(
    `Missing ${WEB_BUILD_ROOT}/. Run npm run sync:ios:local once to build web assets before live reload.`
  );
}

function parseShellCommand(command) {
  const [binary, ...args] = command.trim().split(/\s+/);
  return { binary, args };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function spawnDevServer(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });

  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('spawn', () => resolve(child));
  });
}

async function waitForDevServer(port, { maxAttempts = 60, delayMs = 500 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await isPortReachable(port, '127.0.0.1')) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  throw new Error(`Timed out waiting for dev server on port ${port}.`);
}

async function createLiveReloadContext(cwd = process.cwd()) {
  const config = await loadDevxConfig({ cwd });
  return createWorktreeContext({ cwd, config });
}

export async function runIosLive({
  cwd = process.cwd(),
  env = loadRunIosEnv(),
  extraArgs = [],
  log = console.log,
} = {}) {
  const context = await createLiveReloadContext(cwd);
  const sharedEnv = context.createSharedEnv({ processEnv: env });
  const frontendPort = context.runtime.ports.FRONTEND_PORT;
  const lanHost = resolveLiveReloadHost(env);

  log(`iOS live reload frontend port: ${frontendPort}`);
  log('Ensure the worktree Docker stack is running (npx devx worktree stack up).');
  log('Set IOS_LAN_HOST in .env if auto-detect fails; see npx devx worktree info for details.');

  ensureLocalEnvironmentFile(cwd, { log });
  assertWebBuildOutput(cwd);

  await runCommand('npx', ['cap', 'sync', 'ios'], { env: sharedEnv, cwd });

  const proxyPath = createFrontendProxyConfig(context);
  const frontendConfig = context.config.worktree.frontend ?? {};

  if (frontendConfig.prestartCommand) {
    const { binary, args } = parseShellCommand(frontendConfig.prestartCommand);
    await runCommand(binary, args, { env: sharedEnv, cwd });
  }

  const { binary: serveBinary, args: servePrefixArgs } = parseShellCommand(
    frontendConfig.serveCommand ?? 'npx ng serve'
  );
  const bindHost = context.config.worktree.frontend?.externalHost ?? '0.0.0.0';
  const serveArgs = [...servePrefixArgs, ...buildNgServeArgs(context, proxyPath)];

  const devServer = await spawnDevServer(serveBinary, serveArgs, {
    env: sharedEnv,
    cwd,
  });

  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    log(`\nStopping iOS live reload (${signal})...`);

    if (!devServer.killed) {
      devServer.kill('SIGTERM');
    }
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  try {
    await waitForDevServer(frontendPort);
    log(`Dev server ready on ${bindHost}:${frontendPort}. Deploying to device...`);

    await runCommand(
      'npx',
      ['cap', ...buildCapLiveReloadArgs({ env, frontendPort, lanHost, extraArgs })],
      { env: sharedEnv, cwd }
    );

    log('');
    log('App deployed with live reload enabled.');
    log('Development server will continue running until manually stopped.');
    log('Use Ctrl+C to quit.');

    await new Promise((resolve) => {
      if (devServer.exitCode !== null) {
        resolve();
        return;
      }

      devServer.once('close', resolve);
    });
  } finally {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);

    if (!devServer.killed) {
      devServer.kill('SIGTERM');
    }
  }
}

export async function runIos(
  variant,
  { cwd = process.cwd(), env = loadRunIosEnv(), extraArgs = [] } = {}
) {
  const resolvedVariant = resolveVariant(variant);

  if (resolvedVariant === 'live') {
    await runIosLive({ cwd, env, extraArgs });
    return;
  }

  const { syncScript } = VARIANTS[resolvedVariant];

  await runCommand('npm', ['run', syncScript], { env, cwd });
  await runCommand(
    'npx',
    ['cap', ...buildCapRunArgs({ variant: resolvedVariant, env, extraArgs })],
    { env, cwd }
  );
}

async function main() {
  const [variant, ...extraArgs] = process.argv.slice(2);

  if (!variant) {
    throw new Error('Usage: node scripts/run-ios.mjs <local|prod|live> [cap run args...]');
  }

  await runIos(variant, { extraArgs });
}

const isDirectExecution =
  process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
