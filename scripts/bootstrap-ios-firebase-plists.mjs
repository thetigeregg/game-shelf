import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadDevxConfig } from '@thetigeregg/dev-cli';

export const DEFAULT_SHARED_DIR = '~/.config/game-shelf/ios';

export const DEFAULT_FIREBASE_PLISTS = {
  dev: {
    sharedFile: 'GoogleService-Info.dev.plist',
    destination: 'ios/App/App/Firebase/Dev/GoogleService-Info.plist',
  },
  prod: {
    sharedFile: 'GoogleService-Info.prod.plist',
    destination: 'ios/App/App/Firebase/Prod/GoogleService-Info.plist',
  },
};

export function expandUserPath(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }

  return path.resolve(value);
}

export function resolveSharedFirebaseDir(processEnv = process.env, options = {}) {
  const override = processEnv.WORKTREE_IOS_FIREBASE_DIR?.trim();
  if (override) {
    return expandUserPath(override);
  }

  const configured = options.sharedDir ?? DEFAULT_SHARED_DIR;
  return expandUserPath(configured);
}

export const ENV_FIREBASE_PLIST_KEYS = {
  dev: 'IOS_FIREBASE_DEV_PLIST_PATH',
  prod: 'IOS_FIREBASE_PROD_PLIST_PATH',
};

export function resolveEnvFirebasePlistSources(processEnv = process.env) {
  const sources = {};

  for (const [variant, envKey] of Object.entries(ENV_FIREBASE_PLIST_KEYS)) {
    const configuredPath = processEnv[envKey]?.trim();
    if (configuredPath) {
      sources[variant] = expandUserPath(configuredPath);
    }
  }

  return sources;
}

export function resolveFirebasePlistMappings({
  sharedDir,
  repoRoot,
  plists = DEFAULT_FIREBASE_PLISTS,
  envSources = {},
  variants = null,
}) {
  const selectedVariants =
    variants ??
    Object.keys(plists).filter((variant) => {
      if (envSources[variant]) {
        return true;
      }

      return Object.keys(envSources).length === 0;
    });

  return selectedVariants.map((variant) => {
    const config = plists[variant];
    if (!config) {
      throw new Error(
        `Unknown Firebase plist variant "${variant}". Expected one of: ${Object.keys(plists).join(', ')}`
      );
    }

    const envSourcePath = envSources[variant] ?? null;

    return {
      variant,
      sharedFile: config.sharedFile,
      destination: config.destination,
      sharedPath: envSourcePath ?? path.join(sharedDir, config.sharedFile),
      destinationPath: path.resolve(repoRoot, config.destination),
      source: envSourcePath ? 'env' : 'shared',
    };
  });
}

function shellQuotePath(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

export function formatMissingFirebasePlistMessage(missing, sharedDir) {
  const missingFiles = missing.map((entry) => entry.sharedFile).join(', ');
  const quotedSharedDir = shellQuotePath(sharedDir);
  return [
    `Missing shared Firebase plist(s): ${missingFiles}`,
    `Expected directory: ${sharedDir}`,
    'One-time setup:',
    `  mkdir -p ${quotedSharedDir}`,
    '  # Download from Firebase Console and save as:',
    ...missing.map(
      (entry) =>
        `  #   ${shellQuotePath(path.join(sharedDir, entry.sharedFile))} (${entry.variant})`
    ),
    'Override with WORKTREE_IOS_FIREBASE_DIR if needed.',
    'See docs/ios-multi-environment.md for bundle IDs and Firebase project setup.',
  ];
}

export function formatFirebasePlistStatusLines({
  sharedDir,
  repoRoot,
  plists = DEFAULT_FIREBASE_PLISTS,
  existsSyncFn = existsSync,
}) {
  const mappings = resolveFirebasePlistMappings({ sharedDir, repoRoot, plists });
  const lines = [`Firebase shared dir: ${sharedDir}`];

  for (const mapping of mappings) {
    const sharedState = existsSyncFn(mapping.sharedPath) ? 'present' : 'missing';
    const destinationState = existsSyncFn(mapping.destinationPath) ? 'present' : 'missing';
    lines.push(
      `  ${mapping.variant}: shared [${sharedState}] -> ${mapping.destination} [${destinationState}]`
    );
  }

  return lines;
}

export function bootstrapIosFirebasePlists({
  sharedDir,
  repoRoot = process.cwd(),
  plists = DEFAULT_FIREBASE_PLISTS,
  envSources = {},
  variants = null,
  force = false,
  failOnMissing = false,
  requireEnvSources = false,
  existsSyncFn = existsSync,
  mkdirSyncFn = mkdirSync,
  copyFileSyncFn = copyFileSync,
  log = console.log,
  warn = console.warn,
} = {}) {
  if (requireEnvSources && !envSources.prod) {
    throw new Error(
      `Missing ${ENV_FIREBASE_PLIST_KEYS.prod}. Set it to the prod Firebase plist path for CI builds.`
    );
  }

  if (!sharedDir && Object.keys(envSources).length === 0) {
    throw new Error('Shared Firebase plist directory is not configured.');
  }

  const mappings = resolveFirebasePlistMappings({
    sharedDir,
    repoRoot,
    plists,
    envSources,
    variants,
  });
  const result = { copied: [], skipped: [], missing: [] };

  for (const mapping of mappings) {
    const sharedExists = existsSyncFn(mapping.sharedPath);
    const destinationExists = existsSyncFn(mapping.destinationPath);

    if (!sharedExists) {
      result.missing.push(mapping);
      continue;
    }

    if (destinationExists && !force) {
      result.skipped.push(mapping);
      continue;
    }

    mkdirSyncFn(path.dirname(mapping.destinationPath), { recursive: true });
    copyFileSyncFn(mapping.sharedPath, mapping.destinationPath);
    result.copied.push({ ...mapping, replaced: destinationExists });
  }

  if (result.missing.length > 0) {
    const message = formatMissingFirebasePlistMessage(result.missing, sharedDir).join('\n');

    if (failOnMissing) {
      throw new Error(message);
    }

    warn(`[bootstrap-ios-firebase-plists] ${message}`);
  }

  for (const mapping of result.copied) {
    const action = mapping.replaced ? 'Replaced' : 'Bootstrapped';
    const sourceLabel = mapping.source === 'env' ? 'env override' : 'shared template';
    log(`[bootstrap-ios-firebase-plists] ${action} ${mapping.destination} from ${sourceLabel}`);
  }

  return result;
}

export async function loadFirebaseBootstrapOptions({
  cwd = process.cwd(),
  config,
  processEnv = process.env,
} = {}) {
  const resolvedConfig = config ?? (await loadDevxConfig({ cwd }));
  const firebaseConfig = resolvedConfig.worktree?.ios?.firebase ?? {};

  return {
    sharedDir: resolveSharedFirebaseDir(processEnv, {
      sharedDir: firebaseConfig.sharedDir ?? DEFAULT_SHARED_DIR,
    }),
    repoRoot: resolvedConfig.repoRoot ?? cwd,
    plists: firebaseConfig.plists ?? DEFAULT_FIREBASE_PLISTS,
    envSources: resolveEnvFirebasePlistSources(processEnv),
  };
}

export async function bootstrapIosFirebasePlistsFromConfig(options = {}) {
  const bootstrapOptions = await loadFirebaseBootstrapOptions(options);

  return bootstrapIosFirebasePlists({
    ...bootstrapOptions,
    force: options.force ?? false,
    failOnMissing: options.failOnMissing ?? false,
    requireEnvSources: options.requireEnvSources ?? false,
    variants: options.variants ?? null,
    existsSyncFn: options.existsSyncFn,
    mkdirSyncFn: options.mkdirSyncFn,
    copyFileSyncFn: options.copyFileSyncFn,
    log: options.log,
    warn: options.warn,
  });
}

export function parseBootstrapFirebasePlistArgs(argv) {
  return {
    force: argv.includes('--force'),
    failOnMissing: argv.includes('--required'),
    fromEnv: argv.includes('--from-env'),
  };
}

async function main() {
  const args = parseBootstrapFirebasePlistArgs(process.argv.slice(2));

  try {
    await bootstrapIosFirebasePlistsFromConfig({
      force: args.force,
      failOnMissing: args.failOnMissing,
      requireEnvSources: args.fromEnv,
    });
  } catch (error) {
    console.error(
      `[bootstrap-ios-firebase-plists] ${error instanceof Error ? error.message : error}`
    );
    process.exit(1);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  main();
}
