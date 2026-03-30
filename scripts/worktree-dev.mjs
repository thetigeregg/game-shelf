#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
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
  const maxExplicitOffset = MAX_PORT_OFFSET - 1;
  if (explicitOffset !== undefined) {
    const parsed = Number.parseInt(explicitOffset, 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= maxExplicitOffset) {
      return parsed;
    }
    console.error(
      `WORKTREE_PORT_OFFSET must be an integer between 0 and ${String(maxExplicitOffset)}`
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
  PWA_HOST_PORT: 8200 + portOffset,
  PWA_ROOT_CA_PORT: 8300 + portOffset,
  EDGE_HOST_PORT: 8080 + portOffset,
  API_HOST_PORT: 3000 + portOffset,
  POSTGRES_HOST_PORT: 5432 + portOffset,
  HLTB_HOST_PORT: 8788 + portOffset,
  METACRITIC_HOST_PORT: 8789 + portOffset,
  PSPRICES_HOST_PORT: 8790 + portOffset,
};

const localEnvPath = path.resolve(cwd, '.env');
const defaultSharedEnvFile = path.join(os.homedir(), '.config', 'game-shelf', 'worktree.env');
const simulatorCertDir = path.resolve(cwd, '.tmp', 'pwa-certs');
const simulatorCertFile =
  expandUserPath(process.env.WORKTREE_PWA_CERT_FILE && process.env.WORKTREE_PWA_CERT_FILE.trim()) ||
  path.join(simulatorCertDir, 'localhost.pem');
const simulatorKeyFile =
  expandUserPath(process.env.WORKTREE_PWA_KEY_FILE && process.env.WORKTREE_PWA_KEY_FILE.trim()) ||
  path.join(simulatorCertDir, 'localhost-key.pem');
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
  `http://localhost:${ports.EDGE_HOST_PORT}`,
].join(',');

const sharedEnv = {
  ...process.env,
  ...(secretsHostDir ? { SECRETS_HOST_DIR: secretsHostDir } : {}),
  COMPOSE_PROJECT_NAME: projectName,
  ...ports,
  CORS_ORIGIN: corsOrigin,
  MANUALS_PUBLIC_BASE_URL: `http://127.0.0.1:${ports.EDGE_HOST_PORT}/manuals`,
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
    stdio: 'inherit',
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
    encoding: 'utf8',
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

function hasBash() {
  const result = spawnSync('bash', ['-lc', 'true'], {
    cwd,
    env: sharedEnv,
    stdio: 'ignore',
  });
  return !result.error && result.status === 0;
}

function runNvmAwareShell(command, fallbackCommand, env = sharedEnv) {
  if (hasBash()) {
    run('bash', ['-lc', command], env);
    return;
  }

  console.log('Warning: bash is unavailable; falling back to sh for dependency install.');
  runShell(fallbackCommand, env);
}

function runShellCapture(command, env = sharedEnv) {
  return runCapture('sh', ['-lc', command], env);
}

function hasCommand(command) {
  const result = spawnSync(command, ['--help'], {
    cwd,
    env: sharedEnv,
    stdio: 'ignore',
  });
  return !result.error;
}

function getMkcertCaroot() {
  if (!hasCommand('mkcert')) {
    return '';
  }

  return runCapture('mkcert', ['-CAROOT'], sharedEnv).trim();
}

function listExternalIpv4Addresses() {
  const interfaces = os.networkInterfaces();
  const hosts = [];

  for (const entries of Object.values(interfaces)) {
    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        hosts.push(entry.address);
      }
    }
  }

  return [...new Set(hosts)];
}

function getSimulatorCertificateStatus() {
  const mkcertCaroot = getMkcertCaroot();
  const rootCaPath = mkcertCaroot ? path.join(mkcertCaroot, 'rootCA.pem') : '';

  return {
    mkcertAvailable: hasCommand('mkcert'),
    mkcertCaroot,
    rootCaPath,
    hasRootCa: Boolean(rootCaPath && existsSync(rootCaPath)),
    certPath: simulatorCertFile,
    keyPath: simulatorKeyFile,
    isConfigured: existsSync(simulatorCertFile) && existsSync(simulatorKeyFile),
  };
}

function printInfo() {
  const certStatus = getSimulatorCertificateStatus();
  console.log(`Worktree path: ${cwd}`);
  console.log(`Compose project: ${projectName}`);
  console.log(`Port offset: ${portOffset}`);
  console.log('Ports:');
  console.log(`  frontend:   http://127.0.0.1:${ports.FRONTEND_PORT}`);
  console.log(`  pwa https:  https://127.0.0.1:${ports.PWA_HOST_PORT}`);
  console.log(`  edge:       http://127.0.0.1:${ports.EDGE_HOST_PORT}`);
  console.log(`  api:        http://127.0.0.1:${ports.API_HOST_PORT}`);
  console.log(`  postgres:   127.0.0.1:${ports.POSTGRES_HOST_PORT}`);
  console.log(`  hltb:       http://127.0.0.1:${ports.HLTB_HOST_PORT}`);
  console.log(`  metacritic: http://127.0.0.1:${ports.METACRITIC_HOST_PORT}`);
  console.log(`  psprices:   http://127.0.0.1:${ports.PSPRICES_HOST_PORT}`);
  console.log('Simulator URLs:');
  console.log(`  quick browser: http://localhost:${ports.FRONTEND_PORT}`);
  console.log(`  installed PWA: https://localhost:${ports.PWA_HOST_PORT}`);
  console.log(`  root ca file:  http://localhost:${ports.PWA_ROOT_CA_PORT}/rootCA.pem`);
  for (const host of listExternalIpv4Addresses()) {
    console.log(`  network host:  https://${host}:${ports.PWA_HOST_PORT}`);
  }
  console.log(
    `PWA certs: ${certStatus.isConfigured ? '[configured]' : '[missing]'} (${simulatorCertFile}, ${simulatorKeyFile})`
  );
  console.log(
    `mkcert root CA: ${
      certStatus.hasRootCa
        ? '[configured]'
        : certStatus.mkcertAvailable
          ? '[missing]'
          : '[mkcert unavailable]'
    }${certStatus.rootCaPath ? ` (${certStatus.rootCaPath})` : ''}`
  );
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

function ensureLocalEnvFromSharedTemplate(force = false) {
  const hadLocalEnv = existsSync(localEnvPath);
  if (!force && hadLocalEnv) {
    return;
  }

  if (!existsSync(sharedEnvFilePath)) {
    if (force) {
      console.error(`Shared env template not found: ${sharedEnvFilePath}`);
      process.exit(1);
    }
    return;
  }

  mkdirSync(path.dirname(localEnvPath), { recursive: true });
  copyFileSync(sharedEnvFilePath, localEnvPath);
  console.log(
    hadLocalEnv ? 'Replaced .env from shared template' : 'Bootstrapped .env from shared template'
  );
}

function listMissingDependencyDirs() {
  const dependencyPackages = [
    { packageDir: path.resolve(cwd), alwaysRequireNodeModules: true },
    { packageDir: path.resolve(cwd, 'server') },
    { packageDir: path.resolve(cwd, 'worker') },
    { packageDir: path.resolve(cwd, 'hltb-scraper') },
    { packageDir: path.resolve(cwd, 'metacritic-scraper') },
    { packageDir: path.resolve(cwd, 'psprices-scraper') },
  ];

  return dependencyPackages
    .filter((pkg) => pkg.alwaysRequireNodeModules || packageHasDependencies(pkg.packageDir))
    .map((pkg) => path.resolve(pkg.packageDir, 'node_modules'))
    .filter((moduleDir) => !existsSync(moduleDir));
}

function packageHasDependencies(packageDir) {
  const packageJsonPath = path.resolve(packageDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies'];

    return dependencyFields.some((fieldName) => {
      const value = packageJson[fieldName];
      return Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);
    });
  } catch {
    return true;
  }
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

  console.log('Installing workspace dependencies via: npm run ci:all');
  runNvmAwareShell(buildNvmAwareInstallCommand('ci:all'), 'npm run ci:all', sharedEnv);
}

function buildNvmAwareInstallCommand(installScript = 'i:all') {
  return [
    'if [ -f .nvmrc ]',
    'then',
    '  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
    '  if [ -s "$NVM_DIR/nvm.sh" ]',
    '  then',
    '    . "$NVM_DIR/nvm.sh"',
    '    nvm use',
    '  else',
    '    echo "Warning: .nvmrc found but nvm.sh was not found; continuing with current Node."',
    '  fi',
    'fi',
    `npm run ${installScript}`,
  ].join('\n');
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
      'psprices-scraper',
      'api',
      'worker-general',
      'worker-recommendations',
      'edge',
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
      'worker-general',
      'worker-recommendations',
      'api',
      'postgres',
      'hltb-scraper',
      'metacritic-scraper',
      'psprices-scraper',
    ]);
    return;
  }

  if (action === 'logs') {
    run('docker', [
      ...composeArgs,
      'logs',
      '-f',
      'edge',
      'worker-general',
      'worker-recommendations',
      'api',
      'postgres',
      'hltb-scraper',
      'metacritic-scraper',
      'psprices-scraper',
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

function createFrontendProxyConfig() {
  const tempDir = path.resolve(cwd, '.tmp');
  mkdirSync(tempDir, { recursive: true });

  const proxyPath = path.join(tempDir, `proxy.worktree.${worktreeHint}.json`);
  const proxyConfig = {
    '/v1': {
      target: `http://127.0.0.1:${ports.API_HOST_PORT}`,
      secure: false,
      changeOrigin: true,
      logLevel: 'warn',
    },
    '/manuals': {
      target: `http://127.0.0.1:${ports.EDGE_HOST_PORT}`,
      secure: false,
      changeOrigin: true,
      logLevel: 'warn',
    },
  };

  writeFileSync(proxyPath, `${JSON.stringify(proxyConfig, null, 2)}\n`, 'utf8');
  return proxyPath;
}

function resolveAngularServeConfiguration() {
  const localEnvironmentPath = path.resolve(cwd, 'src', 'environments', 'environment.local.ts');

  if (existsSync(localEnvironmentPath)) {
    console.log('Using Angular local configuration (environment.local.ts)');
    return 'local';
  }

  console.log('Using Angular development configuration (environment.ts)');
  return 'development';
}

function runFrontend(options = {}) {
  const proxyPath = createFrontendProxyConfig();
  run('npm', ['run', 'prestart'], sharedEnv);
  const serveArgs = [
    'ng',
    'serve',
    '--port',
    String(ports.FRONTEND_PORT),
    '--host',
    options.host ?? '127.0.0.1',
    '--proxy-config',
    proxyPath,
  ];
  serveArgs.push('--configuration', resolveAngularServeConfiguration());

  if (options.external) {
    console.log('Simulator browser mode: dev server is available on all interfaces.');
    console.log(
      `Open Safari in iPhone Simulator at http://localhost:${String(ports.FRONTEND_PORT)}`
    );
  }

  run('npx', serveArgs, sharedEnv);
}

function buildPwa() {
  run('npm', ['run', 'prebuild'], sharedEnv);
  run('npx', ['ng', 'build', '--configuration', 'production'], sharedEnv);
}

function listBuildOutputEntries(buildRoot) {
  if (!existsSync(buildRoot)) {
    return [];
  }

  return readdirSync(buildRoot).sort();
}

async function isPortReachable(port, host = '127.0.0.1') {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.once('error', () => {
      resolve(false);
    });

    socket.setTimeout(750, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function printMissingCertificateInstructions() {
  const certStatus = getSimulatorCertificateStatus();

  if (!certStatus.mkcertAvailable) {
    console.error('PWA install path requires mkcert, but `mkcert` was not found in PATH.');
    console.error('Install mkcert first, then run `npm run dev:pwa:certs:setup`.');
    return;
  }

  console.error('PWA install path unavailable because HTTPS certificates are missing.');
  console.error(`Expected cert: ${simulatorCertFile}`);
  console.error(`Expected key:  ${simulatorKeyFile}`);
  console.error('Run `npm run dev:pwa:certs:setup` to create the required trusted localhost cert.');
  console.error(
    'If Safari in iPhone Simulator still warns that the site is not secure, run `npm run dev:pwa:certs:serve-root` and install/trust the mkcert root CA in the simulator.'
  );
}

function setupPwaCertificates() {
  const certStatus = getSimulatorCertificateStatus();
  if (!certStatus.mkcertAvailable) {
    console.error('mkcert is required for the simulator PWA flow but was not found in PATH.');
    process.exit(1);
  }

  mkdirSync(simulatorCertDir, { recursive: true });
  run('mkcert', ['-install'], sharedEnv);
  run(
    'mkcert',
    [
      '-cert-file',
      simulatorCertFile,
      '-key-file',
      simulatorKeyFile,
      'localhost',
      '127.0.0.1',
      '::1',
    ],
    sharedEnv
  );

  const updatedStatus = getSimulatorCertificateStatus();
  console.log('Simulator PWA certificates are ready.');
  console.log(`Cert: ${updatedStatus.certPath}`);
  console.log(`Key:  ${updatedStatus.keyPath}`);
  if (updatedStatus.rootCaPath) {
    console.log(`mkcert root CA: ${updatedStatus.rootCaPath}`);
  }
  console.log(
    `If you need to install the mkcert root CA in iPhone Simulator, run: npm run dev:pwa:certs:serve-root`
  );
}

function servePwaRootCertificate() {
  const certStatus = getSimulatorCertificateStatus();
  if (!certStatus.mkcertAvailable || !certStatus.hasRootCa || !certStatus.rootCaPath) {
    console.error('mkcert root CA is not available.');
    console.error('Run `npm run dev:pwa:certs:setup` first.');
    process.exit(1);
  }

  console.log(
    `Open http://localhost:${String(ports.PWA_ROOT_CA_PORT)}/rootCA.pem in iPhone Simulator Safari.`
  );
  console.log(
    'Then install the profile and enable full trust in Settings > General > About > Certificate Trust Settings.'
  );

  run('node', [
    path.resolve(cwd, 'scripts', 'pwa-root-ca-server.mjs'),
    '--host',
    '0.0.0.0',
    '--port',
    String(ports.PWA_ROOT_CA_PORT),
    '--file',
    certStatus.rootCaPath,
    '--route',
    '/rootCA.pem',
  ]);
}

function runPwaServe() {
  const certStatus = getSimulatorCertificateStatus();
  if (!certStatus.isConfigured) {
    printMissingCertificateInstructions();
    process.exit(1);
  }

  const buildRoot = path.resolve(cwd, 'www', 'browser');
  const indexPath = path.join(buildRoot, 'index.html');

  if (!existsSync(indexPath)) {
    console.error(`Built frontend not found at ${indexPath}`);
    console.error('Run `npm run dev:pwa:build` first or use `npm run dev:pwa:simulator`.');
    process.exit(1);
  }

  console.log('Installed PWA mode: serving production build over HTTPS for simulator testing.');
  console.log(
    `Open Safari in iPhone Simulator at https://localhost:${String(ports.PWA_HOST_PORT)}`
  );
  console.log('Then use Share -> Add to Home Screen to launch the standalone PWA.');

  run('node', [
    path.resolve(cwd, 'scripts', 'pwa-https-server.mjs'),
    '--host',
    '0.0.0.0',
    '--port',
    String(ports.PWA_HOST_PORT),
    '--cert',
    certStatus.certPath,
    '--key',
    certStatus.keyPath,
    '--root',
    buildRoot,
    '--proxy-origin',
    `http://127.0.0.1:${ports.EDGE_HOST_PORT}`,
  ]);
}

async function runPwa(command) {
  if (command === 'build') {
    buildPwa();
    const buildRoot = path.resolve(cwd, 'www', 'browser');
    console.log(`PWA build complete: ${buildRoot}`);
    console.log(`Build output entries: ${listBuildOutputEntries(buildRoot).join(', ')}`);
    return;
  }

  if (command === 'serve') {
    const edgeReachable = await isPortReachable(ports.EDGE_HOST_PORT);
    if (!edgeReachable) {
      console.error(
        `Backend stack not running: edge service is unavailable at http://127.0.0.1:${String(ports.EDGE_HOST_PORT)}`
      );
      console.error('Start it with `npm run dev:stack:up` before serving the simulator PWA.');
      process.exit(1);
    }

    runPwaServe();
    return;
  }

  if (command === 'simulator') {
    const edgeReachable = await isPortReachable(ports.EDGE_HOST_PORT);
    if (!edgeReachable) {
      console.error(
        `Backend stack not running: edge service is unavailable at http://127.0.0.1:${String(ports.EDGE_HOST_PORT)}`
      );
      console.error('Start it with `npm run dev:stack:up` before running the simulator PWA flow.');
      process.exit(1);
    }

    buildPwa();
    runPwaServe();
    return;
  }

  if (command === 'certs-setup') {
    setupPwaCertificates();
    return;
  }

  if (command === 'certs-check') {
    const certStatus = getSimulatorCertificateStatus();
    if (!certStatus.mkcertAvailable) {
      console.error('mkcert is required for the simulator PWA flow but was not found in PATH.');
      process.exit(1);
    }

    if (!certStatus.hasRootCa) {
      console.error('mkcert root CA was not found.');
      console.error('Run `npm run dev:pwa:certs:setup` first.');
      process.exit(1);
    }

    if (!certStatus.isConfigured) {
      printMissingCertificateInstructions();
      process.exit(1);
    }

    console.log('PWA HTTPS certificates are configured.');
    console.log(`Cert: ${certStatus.certPath}`);
    console.log(`Key:  ${certStatus.keyPath}`);
    console.log(`mkcert root CA: ${certStatus.rootCaPath}`);
    console.log(
      'For the cleanest Simulator PWA flow, ensure Safari does not show a security warning for this origin.'
    );
    console.log(
      `If needed, run \`npm run dev:pwa:certs:serve-root\` and open http://localhost:${String(ports.PWA_ROOT_CA_PORT)}/rootCA.pem in iPhone Simulator Safari.`
    );
    return;
  }

  if (command === 'certs-serve-root') {
    servePwaRootCertificate();
    return;
  }

  console.error(
    'Unknown pwa command. Use: build | serve | simulator | certs-setup | certs-check | certs-serve-root'
  );
  process.exit(1);
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
  reconcileGameSyncHistory();

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
      stdio: 'ignore',
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
  reconcileGameSyncHistory();
  console.log('Seed restore complete.');
}

function reconcileGameSyncHistory() {
  console.log('Reconciling game sync history with current games table');
  const reconcileCmd = `docker ${composeArgs.join(' ')} exec -T postgres sh -lc ${shellEscape(
    `user_file="\${POSTGRES_USER_FILE:-/run/secrets/postgres_user}"; user="$(tr -d '\\r\\n' < "$user_file")"; db="\${POSTGRES_DB:-gameshelf}"; psql -v ON_ERROR_STOP=1 -U "$user" -d "$db" -c "BEGIN; DELETE FROM sync_events WHERE entity_type = 'game'; INSERT INTO sync_events (entity_type, entity_key, operation, payload, server_timestamp) SELECT 'game', igdb_game_id || '::' || platform_igdb_id::text, 'upsert', payload, NOW() FROM games; COMMIT;"`
  )}`;

  runShell(reconcileCmd);
  console.log('Game sync history reconciliation complete.');
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

if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
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
    `  WORKTREE_PORT_OFFSET      Force a fixed per-worktree offset (0-${String(MAX_PORT_OFFSET - 1)})`
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

if (args[0] === 'info') {
  printInfo();
  process.exit(0);
}

if (args[0] === 'bootstrap') {
  const bootstrapArgs = args.slice(1);
  if (bootstrapArgs.includes('--help') || bootstrapArgs.includes('help')) {
    console.log('Usage: node scripts/worktree-dev.mjs bootstrap [--force]');
    console.log('');
    console.log('Options:');
    console.log('  --force   Overwrite existing .env from shared template');
    process.exit(0);
  }

  const options = parseOptions(bootstrapArgs);
  ensureLocalEnvFromSharedTemplate(options.force);
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

if (args[0] === 'simulator') {
  ensureLocalEnvFromSharedTemplate();
  printInfo();
  ensureDependenciesInstalled(false);
  runFrontend({ external: true, host: '0.0.0.0' });
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

if (args[0] === 'pwa') {
  if (!args[1]) {
    console.error(
      'Missing pwa action. Use: build | serve | simulator | certs-setup | certs-check | certs-serve-root'
    );
    process.exit(1);
  }
  ensureLocalEnvFromSharedTemplate();
  printInfo();
  ensureDependenciesInstalled(false);
  await runPwa(args[1]);
  process.exit(0);
}

console.error('Unknown command. Use --help for usage.');
process.exit(1);
