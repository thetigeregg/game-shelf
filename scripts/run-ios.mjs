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
const DEFAULT_LOCAL_ENVIRONMENT_FILE = 'src/environments/environment.local.ts';
const DEFAULT_WEB_BUILD_ROOT = 'www/browser';

export function resolveLiveReloadFrontendPaths(frontendConfig = {}) {
  const localEnvironmentFile =
    frontendConfig.localEnvironmentFile ?? DEFAULT_LOCAL_ENVIRONMENT_FILE;
  const localEnvironmentExampleFile =
    frontendConfig.localEnvironmentExampleFile ??
    localEnvironmentFile.replace(/\.ts$/, '.example.ts');
  const buildRoot = frontendConfig.buildRoot ?? DEFAULT_WEB_BUILD_ROOT;

  return { localEnvironmentFile, localEnvironmentExampleFile, buildRoot };
}

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
  {
    log = console.log,
    copyFile = copyFileSync,
    localEnvironmentFile = DEFAULT_LOCAL_ENVIRONMENT_FILE,
    localEnvironmentExampleFile = DEFAULT_LOCAL_ENVIRONMENT_FILE.replace(/\.ts$/, '.example.ts'),
  } = {}
) {
  const localEnvironmentPath = path.resolve(cwd, localEnvironmentFile);
  if (existsSync(localEnvironmentPath)) {
    return localEnvironmentPath;
  }

  const examplePath = path.resolve(cwd, localEnvironmentExampleFile);
  if (!existsSync(examplePath)) {
    throw new Error(
      `Missing ${localEnvironmentFile} and ${localEnvironmentExampleFile}. Create ${localEnvironmentFile} before running live reload.`
    );
  }

  copyFile(examplePath, localEnvironmentPath);
  log(`Created ${localEnvironmentFile} from ${localEnvironmentExampleFile}.`);
  return localEnvironmentPath;
}

function assertWebBuildOutput(cwd, buildRoot = DEFAULT_WEB_BUILD_ROOT) {
  const webBuildPath = path.resolve(cwd, buildRoot);
  if (existsSync(webBuildPath)) {
    return;
  }

  throw new Error(
    `Missing ${buildRoot}/. Run npm run sync:ios:local once to build web assets before live reload.`
  );
}

export function resolveConfiguredCommand(command) {
  if (Array.isArray(command)) {
    if (command.length === 0) {
      throw new Error('Configured command array must include a binary.');
    }

    return { shell: false, command: command[0], args: command.slice(1) };
  }

  if (typeof command !== 'string') {
    throw new Error('Configured command must be a non-empty string or a command array.');
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
    child.on('close', (code, signal) => {
      onChild?.(null);

      if (isShuttingDown()) {
        resolve();
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      if (code === null && signal) {
        reject(new Error(`${label} exited due to signal ${signal}`));
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
    shell: resolved.shell,
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

  return spawnDevServer(resolved.command, [...resolved.args, ...extraArgs], {
    ...options,
    shell: resolved.shell,
  });
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

export function formatDevServerReadyMessage({ frontendPort, bindHost }) {
  if (bindHost === '0.0.0.0') {
    return `Dev server ready on port ${frontendPort}. Deploying to device...`;
  }

  return `Dev server ready on port ${frontendPort} (bound to ${bindHost}). Deploying to device...`;
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

async function createLiveReloadContext(cwd = process.cwd(), processEnv = process.env) {
  const config = await loadDevxConfig({ cwd });
  return createWorktreeContext({ cwd, config, processEnv });
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
  const context = await createLiveReloadContext(cwd, env);
  const sharedEnv = context.createSharedEnv({ processEnv: env });
  const frontendPort = context.runtime.ports.FRONTEND_PORT;
  const lanHost = resolveLiveReloadHost(env);
  const frontendPaths = resolveLiveReloadFrontendPaths(context.config.worktree.frontend);

  log(`iOS live reload frontend port: ${frontendPort}`);
  log('Ensure the worktree Docker stack is running (npx devx worktree stack up).');
  log('Set IOS_LAN_HOST in .env if auto-detect fails; see npx devx worktree info for details.');

  ensureLocalEnvironmentFile(cwd, { log, ...frontendPaths });
  assertWebBuildOutput(cwd, frontendPaths.buildRoot);

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
    log(formatDevServerReadyMessage({ frontendPort, bindHost }));

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

  const missingLocalEnvironmentMatch = message.match(
    /^Missing (.+) and (.+)\. Create (.+) before running live reload\.$/
  );
  if (missingLocalEnvironmentMatch) {
    const [, localEnvironmentFile, localEnvironmentExampleFile] = missingLocalEnvironmentMatch;
    return [
      `Missing ${localEnvironmentFile} and ${localEnvironmentExampleFile}.`,
      `Create ${localEnvironmentFile} before running live reload.`,
    ];
  }

  const missingWebBuildMatch = message.match(/^Missing (.+)\/\. Run npm run sync:ios:local/);
  if (missingWebBuildMatch) {
    const [, buildRoot] = missingWebBuildMatch;
    return [
      `Missing ${buildRoot}/.`,
      'Run npm run sync:ios:local once to build web assets before live reload.',
    ];
  }

  if (message.startsWith('Timed out waiting for dev server')) {
    return [
      'Timed out waiting for the dev server to become reachable.',
      'Check ng serve output above for details.',
    ];
  }

  if (/ exited (with code \d+|due to signal \S+)$/.test(message)) {
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
