import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

import { createWorktreeContext, loadDevxConfig } from '@thetigeregg/dev-cli';

import { loadProjectEnv } from './dotenv.mjs';
import { composeLocalBackendOrigin, resolveLanHost } from './lan-host.mjs';
const EMULATORJS_CONSTANTS_PATH = resolve(
  process.cwd(),
  'src/app/core/config/emulatorjs.constants.ts'
);

const VARIANTS = {
  local: {
    outputPath: resolve(process.cwd(), 'src/environments/environment.ios.local.ts'),
    production: false,
    emulatorJsDebug: true,
    envKeys: ['IOS_BACKEND_ORIGIN_LOCAL', 'BACKEND_ORIGIN'],
  },
  prod: {
    outputPath: resolve(process.cwd(), 'src/environments/environment.ios.prod.ts'),
    production: true,
    emulatorJsDebug: false,
    envKeys: ['IOS_BACKEND_ORIGIN_PROD', 'BACKEND_ORIGIN'],
  },
};

export { parseDotEnv } from './dotenv.mjs';

export function normalizeBackendOrigin(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().replace(/\/+$/, '');

  if (trimmed.length === 0) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return null;
  }

  if (parsed.pathname !== '/' && parsed.pathname.length > 0) {
    return null;
  }

  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    return null;
  }

  return `${parsed.protocol}//${parsed.host}`;
}

export function parseOriginPort(origin) {
  if (typeof origin !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(origin);
    if (parsed.port) {
      const port = Number.parseInt(parsed.port, 10);
      return Number.isInteger(port) ? port : null;
    }

    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return null;
  }
}

export async function resolveWorktreeEdgePort(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadDevxConfig({ cwd });
  const context = await createWorktreeContext({ cwd, config });
  return context.runtime.ports.EDGE_HOST_PORT;
}

export function resolveLocalBackendOrigin(envValues, options = {}) {
  const explicit = normalizeBackendOrigin(envValues.IOS_BACKEND_ORIGIN_LOCAL);
  const edgePort = options.edgePort;
  const logWarning = options.logWarning ?? (() => {});

  if (explicit !== null) {
    if (edgePort != null) {
      const explicitPort = parseOriginPort(explicit);
      if (explicitPort !== null && explicitPort !== edgePort) {
        logWarning(
          `[write-environment-ios] IOS_BACKEND_ORIGIN_LOCAL uses port ${explicitPort}, but this worktree edge port is ${edgePort}.`
        );
      }
    }

    return explicit;
  }

  if (edgePort != null) {
    const lanHost = resolveLanHost(envValues, options);
    const composed = composeLocalBackendOrigin(lanHost, edgePort);
    if (composed !== null) {
      return composed;
    }
  }

  return normalizeBackendOrigin(envValues.BACKEND_ORIGIN);
}

export function resolveBackendOrigin(variant, envValues, options = {}) {
  const config = VARIANTS[variant];
  if (!config) {
    throw new Error(`Unknown iOS environment variant: ${variant}`);
  }

  if (variant === 'local') {
    return resolveLocalBackendOrigin(envValues, options);
  }

  for (const key of config.envKeys) {
    const candidate = normalizeBackendOrigin(envValues[key]);
    if (candidate !== null) {
      return candidate;
    }
  }

  return null;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  const n = value.trim().toLowerCase();
  if (n === '1' || n === 'true' || n === 'yes' || n === 'on') return true;
  if (n === '0' || n === 'false' || n === 'no' || n === 'off') return false;
  return fallback;
}

function escapeTsString(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function readEmulatorJsConstants() {
  const source = readFileSync(EMULATORJS_CONSTANTS_PATH, 'utf8');
  const transformed = source.replace(/^\s*export\s+const\s+/gm, 'const ');
  const context = { result: null };
  const vmSource = `${transformed}
result = {
  pathToData: EMULATORJS_DEFAULT_PATH_TO_DATA,
  loaderIntegrity: EMULATORJS_PINNED_LOADER_INTEGRITY,
};`;

  vm.runInNewContext(vmSource, context);
  const result = context.result;

  if (
    !result ||
    typeof result.pathToData !== 'string' ||
    result.pathToData.length === 0 ||
    typeof result.loaderIntegrity !== 'string' ||
    result.loaderIntegrity.length === 0
  ) {
    throw new Error('Failed to read EmulatorJS constants');
  }

  return result;
}

export function buildEnvironmentIosSource(variant, envValues, options = {}) {
  const config = VARIANTS[variant];
  const backendOrigin =
    options.resolvedBackendOrigin !== undefined
      ? options.resolvedBackendOrigin
      : resolveBackendOrigin(variant, envValues, options);

  if (backendOrigin === null) {
    const keys =
      variant === 'local'
        ? 'IOS_BACKEND_ORIGIN_LOCAL, IOS_LAN_HOST, or BACKEND_ORIGIN'
        : config.envKeys.join(' or ');
    throw new Error(
      `Missing or invalid backend origin for ios-${variant}. Set ${keys} in .env or the shell environment.`
    );
  }

  const requireAuth = parseBoolean(envValues.REQUIRE_AUTH, true);
  const tasEnabled = parseBoolean(envValues.FEATURE_TAS, false);

  return `import {
  EMULATORJS_DEFAULT_PATH_TO_DATA,
  EMULATORJS_PINNED_LOADER_INTEGRITY,
} from '../app/core/config/emulatorjs.constants';

// Generated by scripts/write-environment-ios.mjs — do not edit.
// Re-run npm run build:ios:${variant} after changing backend origin env vars.

const BACKEND_ORIGIN = '${escapeTsString(backendOrigin)}';

export const environment = {
  production: ${config.production},
  gameApiBaseUrl: \`\${BACKEND_ORIGIN}/api\`,
  manualsBaseUrl: \`\${BACKEND_ORIGIN}/manuals\`,
  romsBaseUrl: \`\${BACKEND_ORIGIN}/roms\`,
  biosBaseUrl: \`\${BACKEND_ORIGIN}/bios\`,
  emulatorJsPathToData: EMULATORJS_DEFAULT_PATH_TO_DATA,
  emulatorJsLoaderIntegrity: EMULATORJS_PINNED_LOADER_INTEGRITY,
  emulatorJsDebug: ${config.emulatorJsDebug},
  featureFlags: {
    showMgcImport: false,
    e2eFixtures: false,
    recommendationsExploreEnabled: true,
    tasEnabled: ${tasEnabled},
    requireAuth: ${requireAuth},
  },
};
`;
}

export async function writeEnvironmentIos(variant, options = {}) {
  const config = VARIANTS[variant];
  if (!config) {
    throw new Error(`Unknown iOS environment variant: ${variant}`);
  }

  const envValues = loadProjectEnv(options.processEnv ?? process.env, {
    envPath: options.envPath,
    dotenvValues: options.dotenvValues,
    readFileSync: options.readFileSync,
  });

  const resolveOptions = {
    ...options,
    logWarning: options.logWarning ?? ((message) => console.warn(message)),
  };

  if (variant === 'local') {
    resolveOptions.edgePort =
      options.edgePort ?? (await resolveWorktreeEdgePort({ cwd: options.cwd }));
  }

  readEmulatorJsConstants();
  const backendOrigin = resolveBackendOrigin(variant, envValues, resolveOptions);
  const source = buildEnvironmentIosSource(variant, envValues, {
    ...resolveOptions,
    resolvedBackendOrigin: backendOrigin,
  });

  if (options.write !== false) {
    writeFileSync(config.outputPath, source, 'utf8');
  }

  return {
    outputPath: config.outputPath,
    backendOrigin,
    source,
  };
}

async function main() {
  const variant = process.argv[2];

  if (variant !== 'local' && variant !== 'prod') {
    console.error('Usage: node scripts/write-environment-ios.mjs <local|prod>');
    process.exit(1);
  }

  try {
    const result = await writeEnvironmentIos(variant);
    console.info(`[write-environment-ios] Wrote ${result.outputPath}`);
  } catch (error) {
    console.error(`[write-environment-ios] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
