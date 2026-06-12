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

export function resolveConfiguredCommand(command) {
  if (Array.isArray(command)) {
    if (command.length === 0) {
      throw new Error('Configured command array must include a binary.');
    }

    return { shell: false, command: command[0], args: command.slice(1) };
  }

  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error('Configured command must not be empty.');
  }

  return { shell: true, command: trimmed, args: [] };
}

export function appendShellArgs(command, args) {
  if (args.length === 0) {
    return command;
  }

  const quoted = args.map((arg) => {
    if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) {
      return arg;
    }

    return `'${arg.replace(/'/g, `'\\''`)}'`;
  });

  return `${command} ${quoted.join(' ')}`;
}

function spawnChildProcess(command, args, options = {}) {
  const {
    onChild: _onChild,
    isShuttingDown: _isShuttingDown,
    label: _label,
    ...spawnOptions
  } = options;

  return spawn(command, args, {
    stdio: 'inherit',
    shell: spawnOptions.shell ?? process.platform === 'win32',
    ...spawnOptions,
  });
}

function runCommand(command, args, options = {}) {
  const { onChild, isShuttingDown = () => false, label = command } = options;

  return new Promise((resolve, reject) => {
    const child = spawnChildProcess(command, args, options);

    onChild?.(child);

    child.on('error', (error) => {
      onChild?.(null);
      reject(error);
    });
    child.on('close', (code) => {
      onChild?.(null);

      if (isShuttingDown()) {
        resolve();
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

function runConfiguredCommand(configuredCommand, extraArgs = [], options = {}) {
  const resolved = resolveConfiguredCommand(configuredCommand);

  if (resolved.shell) {
    const fullCommand = appendShellArgs(resolved.command, extraArgs);
    return runCommand(fullCommand, [], { ...options, shell: true, label: fullCommand });
  }

  return runCommand(resolved.command, [...resolved.args, ...extraArgs], {
    ...options,
    label: resolved.command,
  });
}

function spawnDevServer(command, args, options = {}) {
  const child = spawnChildProcess(command, args, options);

  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('spawn', () => resolve(child));
  });
}

function spawnConfiguredDevServer(configuredCommand, extraArgs = [], options = {}) {
  const resolved = resolveConfiguredCommand(configuredCommand);

  if (resolved.shell) {
    const fullCommand = appendShellArgs(resolved.command, extraArgs);
    return spawnDevServer(fullCommand, [], { ...options, shell: true });
  }

  return spawnDevServer(resolved.command, [...resolved.args, ...extraArgs], options);
}

export function resolveDevServerProbeHosts(bindHost, lanHost) {
  const hosts = new Set();

  if (bindHost && bindHost !== '0.0.0.0') {
    hosts.add(bindHost);
  } else {
    hosts.add('127.0.0.1');
  }

  if (lanHost && lanHost !== '127.0.0.1' && lanHost !== bindHost) {
    hosts.add(lanHost);
  }

  return [...hosts];
}

export function formatDevServerReadyMessage({ lanHost, frontendPort, bindHost }) {
  if (bindHost === '0.0.0.0') {
    return `Dev server ready at ${lanHost}:${frontendPort}. Deploying to device...`;
  }

  return `Dev server ready at ${lanHost}:${frontendPort} (bound to ${bindHost}). Deploying to device...`;
}

async function waitForDevServer(
  port,
  {
    hosts = ['127.0.0.1'],
    maxAttempts = 60,
    delayMs = 500,
    isPortReachableFn = isPortReachable,
  } = {}
) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    for (const host of hosts) {
      if (await isPortReachableFn(port, host)) {
        return;
      }
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

export class RunIosInterruptedError extends Error {
  constructor(signal = 'SIGINT') {
    super(`iOS live reload interrupted by ${signal}`);
    this.name = 'RunIosInterruptedError';
    this.signal = signal;
  }
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

  let shuttingDown = false;
  let interruptedSignal = null;
  let activeChild = null;
  let devServer = null;

  const commandOptions = {
    env: sharedEnv,
    cwd,
    isShuttingDown: () => shuttingDown,
    onChild: (child) => {
      activeChild = child;
    },
  };

  const assertNotInterrupted = () => {
    if (shuttingDown) {
      throw new RunIosInterruptedError(interruptedSignal ?? 'SIGINT');
    }
  };

  const shutdown = (signal) => {
    if (shuttingDown) {
      process.exit(signal === 'SIGINT' ? 130 : 143);
      return;
    }

    shuttingDown = true;
    interruptedSignal = signal;
    log(`\nStopping iOS live reload (${signal})...`);

    if (activeChild && !activeChild.killed) {
      activeChild.kill('SIGTERM');
    }

    if (devServer && !devServer.killed) {
      devServer.kill('SIGTERM');
    }
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  try {
    await runCommand('npx', ['cap', 'sync', 'ios'], commandOptions);
    assertNotInterrupted();

    const proxyPath = createFrontendProxyConfig(context);
    const frontendConfig = context.config.worktree.frontend ?? {};

    if (frontendConfig.prestartCommand) {
      await runConfiguredCommand(frontendConfig.prestartCommand, [], commandOptions);
      assertNotInterrupted();
    }

    const bindHost = context.config.worktree.frontend?.externalHost ?? '0.0.0.0';
    const serveArgs = buildNgServeArgs(context, proxyPath);

    devServer = await spawnConfiguredDevServer(
      frontendConfig.serveCommand ?? 'npx ng serve',
      serveArgs,
      {
        env: sharedEnv,
        cwd,
      }
    );

    await waitForDevServer(frontendPort, {
      hosts: resolveDevServerProbeHosts(bindHost, lanHost),
    });
    assertNotInterrupted();
    log(formatDevServerReadyMessage({ lanHost, frontendPort, bindHost }));

    await runCommand(
      'npx',
      ['cap', ...buildCapLiveReloadArgs({ env, frontendPort, lanHost, extraArgs })],
      commandOptions
    );
    assertNotInterrupted();

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

    if (shuttingDown) {
      throw new RunIosInterruptedError(interruptedSignal ?? 'SIGINT');
    }
  } finally {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);

    if (devServer && !devServer.killed) {
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

export function describeRunIosFailure(error) {
  if (!(error instanceof Error)) {
    return ['run-ios failed.'];
  }

  const { message } = error;

  if (message.startsWith('Usage: node scripts/run-ios.mjs')) {
    return ['Usage: node scripts/run-ios.mjs <local|prod|live> [cap run args...]'];
  }

  if (message.startsWith('Invalid iOS run variant')) {
    return ['Invalid iOS run variant. Expected "local", "prod", or "live".'];
  }

  if (message.startsWith('Unable to resolve LAN host')) {
    return [
      'Unable to resolve LAN host for live reload.',
      'Set IOS_LAN_HOST in .env to your Mac Wi-Fi IP address.',
    ];
  }

  if (message.startsWith('Missing src/environments/environment.local.ts')) {
    return [
      `Missing ${LOCAL_ENVIRONMENT_FILE} and ${LOCAL_ENVIRONMENT_EXAMPLE_FILE}.`,
      `Create ${LOCAL_ENVIRONMENT_FILE} before running live reload.`,
    ];
  }

  if (message.startsWith(`Missing ${WEB_BUILD_ROOT}/`)) {
    return [
      `Missing ${WEB_BUILD_ROOT}/.`,
      'Run npm run sync:ios:local once to build web assets before live reload.',
    ];
  }

  if (message.startsWith('Timed out waiting for dev server')) {
    return [
      'Timed out waiting for the dev server to become reachable.',
      'Check ng serve output above for details.',
    ];
  }

  if (/^(npm|npx) exited with code \d+$/.test(message)) {
    return ['iOS run command failed. See command output above for details.'];
  }

  if (error.name === 'RunIosInterruptedError') {
    return ['iOS live reload interrupted.'];
  }

  return ['run-ios failed. See output above for details.'];
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
    for (const line of describeRunIosFailure(error)) {
      console.error(line);
    }

    if (error?.name === 'RunIosInterruptedError') {
      process.exit(error.signal === 'SIGTERM' ? 143 : 130);
    }

    process.exit(1);
  });
}
