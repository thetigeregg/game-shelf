import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadProjectEnv } from './dotenv.mjs';
import {
  buildIosLiveUpdateBundleId,
  buildIosLiveUpdateManifest,
  normalizeBackendOrigin,
} from './ios-live-update-common.mjs';
import { readPackageVersion } from './sync-ios-version.mjs';
import { resolvePrivateKeyPem, signBundleFile } from './sign-ios-live-update-bundle.mjs';
import { writeEnvironmentIos } from './write-environment-ios.mjs';

export const DEFAULT_WEB_DIR = resolve(process.cwd(), 'www/browser');
export const DEFAULT_OUTPUT_ROOT = resolve(process.cwd(), 'ota/ios');

export function resolveNativeBuildNumber(envValues = process.env) {
  const candidate =
    envValues.IOS_OTA_NATIVE_BUILD_NUMBER ??
    envValues.IOS_BUILD_NUMBER ??
    envValues.IOS_LIVE_UPDATE_NATIVE_BUILD_NUMBER;

  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }

  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return String(candidate);
  }

  throw new Error(
    'Missing native build number. Set IOS_OTA_NATIVE_BUILD_NUMBER (or IOS_BUILD_NUMBER) for OTA artifact generation.'
  );
}

export function resolveBackendOriginForOta(envValues = process.env) {
  const candidate =
    envValues.IOS_BACKEND_ORIGIN_PROD ?? envValues.IOS_BACKEND_ORIGIN ?? envValues.BACKEND_ORIGIN;

  return normalizeBackendOrigin(candidate);
}

export function buildOtaArtifactPaths({ outputRoot, nativeBuildNumber, bundleId }) {
  const buildDir = resolve(outputRoot, String(nativeBuildNumber));
  const zipPath = resolve(buildDir, `${bundleId}.zip`);
  const manifestPath = resolve(buildDir, 'manifest.json');
  const headersPath = resolve(buildDir, `${bundleId}.headers.json`);

  return { buildDir, zipPath, manifestPath, headersPath };
}

export function zipDirectory(sourceDir, zipPath, execFileSyncFn = execFileSync) {
  mkdirSync(dirname(zipPath), { recursive: true });
  rmSync(zipPath, { force: true });

  execFileSyncFn('zip', ['-qr', zipPath, '.'], {
    cwd: sourceDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export async function buildIosLiveUpdateArtifacts(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const outputRoot = options.outputRoot ?? DEFAULT_OUTPUT_ROOT;
  const webDir = options.webDir ?? DEFAULT_WEB_DIR;
  const execFileSyncFn = options.execFileSyncFn ?? execFileSync;
  const writeFile = options.writeFileSyncFn ?? writeFileSync;
  const envValues = options.envValues ?? loadProjectEnv(options.processEnv ?? process.env);

  if (options.writeEnvironment !== false) {
    await writeEnvironmentIos('prod', {
      cwd,
      processEnv: options.processEnv ?? process.env,
      envPath: options.envPath,
    });
  }

  if (options.buildIosProd !== false) {
    execFileSyncFn('npm', ['run', 'build:ios:prod'], {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...envValues },
    });
  }

  const semver = options.semver ?? readPackageVersion(resolve(cwd, 'package.json'));
  const nativeBuildNumber = options.nativeBuildNumber ?? resolveNativeBuildNumber(envValues);
  const backendOrigin = options.backendOrigin ?? resolveBackendOriginForOta(envValues);
  const bundleId = options.bundleId ?? buildIosLiveUpdateBundleId(semver, nativeBuildNumber);
  const { buildDir, zipPath, manifestPath, headersPath } = buildOtaArtifactPaths({
    outputRoot: resolve(cwd, outputRoot),
    nativeBuildNumber,
    bundleId,
  });

  zipDirectory(webDir, zipPath, execFileSyncFn);

  const privateKeyPem = options.privateKeyPem ?? resolvePrivateKeyPem(options);
  const { checksum, signature, sizeBytes } = signBundleFile(zipPath, privateKeyPem, readFileSync);

  const manifest = buildIosLiveUpdateManifest({
    bundleId,
    semver,
    nativeBuildNumber,
    backendOrigin,
    checksum,
    signature,
  });

  if (options.write !== false) {
    mkdirSync(buildDir, { recursive: true });
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    writeFile(headersPath, `${JSON.stringify({ checksum, signature }, null, 2)}\n`, 'utf8');
  }

  return {
    bundleId,
    semver,
    nativeBuildNumber,
    backendOrigin,
    buildDir,
    zipPath,
    manifestPath,
    headersPath,
    manifest,
    checksum,
    signature,
    sizeBytes,
  };
}

function parseArgs(argv) {
  const args = {
    outputRoot: DEFAULT_OUTPUT_ROOT,
    skipBuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--output-root') {
      args.outputRoot = argv[index + 1] ?? DEFAULT_OUTPUT_ROOT;
      index += 1;
      continue;
    }

    if (value === '--skip-build') {
      args.skipBuild = true;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    const result = await buildIosLiveUpdateArtifacts({
      outputRoot: resolve(args.outputRoot),
      buildIosProd: !args.skipBuild,
    });

    console.info(`[build-ios-live-update-artifacts] bundleId=${result.bundleId}`);
    console.info(`[build-ios-live-update-artifacts] manifest=${result.manifestPath}`);
    console.info(`[build-ios-live-update-artifacts] zip=${result.zipPath}`);
  } catch (error) {
    console.error(
      `[build-ios-live-update-artifacts] ${error instanceof Error ? error.message : error}`
    );
    process.exit(1);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main();
}
