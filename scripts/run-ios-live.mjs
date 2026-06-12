import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  createFrontendProxyConfig,
  createWorktreeContext,
  isPortReachable,
  loadDevxConfig,
  printWorktreeInfo,
} from '@thetigeregg/dev-cli';

import { buildCapRunArgs, loadRunIosEnv } from './ios-run-common.mjs';
import { resolveLanHost } from './lan-host.mjs';

const LIVE_RELOAD_VARIANT = 'local';
const LIVE_RELOAD_SERVE_CONFIGURATION = 'ios-live';
const LIVE_RELOAD_BIND_HOST = '0.0.0.0';
const LOCAL_ENVIRONMENT_FILE = 'src/environments/environment.local.ts';
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
  return [
    '--port',
    String(context.runtime.ports.FRONTEND_PORT),
    '--host',
    LIVE_RELOAD_BIND_HOST,
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
    variant: LIVE_RELOAD_VARIANT,
    env,
    extraArgs: ['--live-reload', '--host', lanHost, '--port', String(frontendPort), ...extraArgs],
  });
}

function assertLocalEnvironmentFile(cwd) {
  const localEnvironmentPath = path.resolve(cwd, LOCAL_ENVIRONMENT_FILE);
  if (existsSync(localEnvironmentPath)) {
    return localEnvironmentPath;
  }

  throw new Error(
    `Missing ${LOCAL_ENVIRONMENT_FILE}. Copy src/environments/environment.local.example.ts to ${LOCAL_ENVIRONMENT_FILE} before running live reload.`
  );
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

  printWorktreeInfo(context);
  log(`iOS live reload URL: http://${lanHost}:${frontendPort}`);
  log('Ensure the worktree Docker stack is running (npx devx worktree stack up).');

  assertLocalEnvironmentFile(cwd);
  assertWebBuildOutput(cwd);

  await runCommand('npx', ['cap', 'sync', 'ios'], { env: sharedEnv, cwd });

  const proxyPath = createFrontendProxyConfig(context);
  const frontendConfig = context.config.worktree.frontend ?? {};

  if (frontendConfig.prestartCommand) {
    await runCommand('npm', ['run', 'prestart'], { env: sharedEnv, cwd });
  }

  const serveCommand = frontendConfig.serveCommand ?? 'npx ng serve';
  const [serveBinary, ...servePrefixArgs] = serveCommand.split(' ');
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
    log(`Dev server ready on ${LIVE_RELOAD_BIND_HOST}:${frontendPort}. Deploying to device...`);

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
      devServer.on('close', resolve);
    });
  } finally {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);

    if (!devServer.killed) {
      devServer.kill('SIGTERM');
    }
  }
}

async function main() {
  const extraArgs = process.argv.slice(2);
  await runIosLive({ extraArgs });
}

const isDirectExecution =
  process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
