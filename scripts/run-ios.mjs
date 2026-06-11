import { spawn } from 'node:child_process';

const VARIANTS = {
  local: {
    scheme: 'DEV',
    syncScript: 'sync:ios:local',
  },
  prod: {
    scheme: 'PROD',
    syncScript: 'sync:ios:prod',
  },
};

export function resolveVariant(variant) {
  const normalized = variant?.trim().toLowerCase();

  if (!normalized || !(normalized in VARIANTS)) {
    throw new Error(`Invalid iOS run variant "${variant ?? ''}". Expected "local" or "prod".`);
  }

  return normalized;
}

export function resolveScheme(variant) {
  return VARIANTS[resolveVariant(variant)].scheme;
}

export function buildCapRunArgs({ variant, env = process.env, extraArgs = [] }) {
  const { scheme } = VARIANTS[resolveVariant(variant)];
  const args = ['run', 'ios', '--no-sync', '--scheme', scheme];

  const targetId = env.IOS_TARGET_ID?.trim();
  const targetName = env.IOS_TARGET_NAME?.trim();

  if (targetId) {
    args.push('--target', targetId);
  } else if (targetName) {
    args.push('--target-name', targetName);
  }

  return [...args, ...extraArgs];
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

export async function runIos(variant, { env = process.env, extraArgs = [] } = {}) {
  const resolvedVariant = resolveVariant(variant);
  const { syncScript } = VARIANTS[resolvedVariant];

  await runCommand('npm', ['run', syncScript], { env });
  await runCommand(
    'npx',
    ['cap', ...buildCapRunArgs({ variant: resolvedVariant, env, extraArgs })],
    {
      env,
    }
  );
}

async function main() {
  const [variant, ...extraArgs] = process.argv.slice(2);

  if (!variant) {
    throw new Error('Usage: node scripts/run-ios.mjs <local|prod> [cap run args...]');
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
