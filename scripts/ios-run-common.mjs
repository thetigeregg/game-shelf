import { loadProjectEnv } from './dotenv.mjs';

export const VARIANTS = {
  local: {
    scheme: 'App DEV',
    syncScript: 'sync:ios:local',
  },
  prod: {
    scheme: 'App PROD',
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

export function loadRunIosEnv(processEnv = process.env, options = {}) {
  return loadProjectEnv(processEnv, options);
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
