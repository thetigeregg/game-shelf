import { spawn } from 'node:child_process';

import { VARIANTS, buildCapRunArgs, loadRunIosEnv, resolveVariant } from './ios-run-common.mjs';

export {
  VARIANTS,
  buildCapRunArgs,
  loadRunIosEnv,
  resolveScheme,
  resolveVariant,
} from './ios-run-common.mjs';

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

export async function runIos(variant, { env = loadRunIosEnv(), extraArgs = [] } = {}) {
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
