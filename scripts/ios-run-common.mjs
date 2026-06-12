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

export const RUN_VARIANTS = ['local', 'prod', 'live'];

export function resolveVariant(variant) {
  const normalized = variant?.trim().toLowerCase();

  if (!normalized || !RUN_VARIANTS.includes(normalized)) {
    throw new Error(
      `Invalid iOS run variant "${variant ?? ''}". Expected "local", "prod", or "live".`
    );
  }

  return normalized;
}

export function resolveScheme(variant) {
  const resolved = resolveVariant(variant);
  if (resolved === 'live') {
    return VARIANTS.local.scheme;
  }

  return VARIANTS[resolved].scheme;
}

export function loadRunIosEnv(processEnv = process.env, options = {}) {
  return loadProjectEnv(processEnv, options);
}

export function buildCapRunArgs({ variant, env = process.env, extraArgs = [] }) {
  const resolved = resolveVariant(variant);
  const scheme = resolved === 'live' ? VARIANTS.local.scheme : VARIANTS[resolved].scheme;
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
