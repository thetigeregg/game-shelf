import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const NATIVE_SHELL_EXACT_PATHS = new Set([
  'capacitor.config.ts',
  'ionic.config.json',
  'angular.json',
  'scripts/write-environment-ios.mjs',
  'scripts/bootstrap-ios-firebase-plists.mjs',
  'scripts/generate-ios-info-plists.mjs',
  'scripts/sync-ios-version.mjs',
  'scripts/run-ios.mjs',
  'scripts/ios-run-common.mjs',
  '.github/workflows/ios-testflight.yml',
]);

export const PACKAGE_MANIFEST_PATHS = new Set(['package.json', 'package-lock.json']);

export const NATIVE_DEPENDENCY_PATTERN =
  /@capacitor(?:-[a-z0-9-]+)?\/|@capacitor-community\/|@capacitor-firebase\/|@ionic\/|"ionicons"/;

export function matchesNativeShellPath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    return false;
  }

  const normalized = filePath.replace(/\\/g, '/');

  if (PACKAGE_MANIFEST_PATHS.has(normalized)) {
    return false;
  }

  if (normalized.startsWith('ios/')) {
    return true;
  }

  return NATIVE_SHELL_EXACT_PATHS.has(normalized);
}

export function manifestDiffHasNativeDependencyChanges(manifestDiff) {
  if (typeof manifestDiff !== 'string' || manifestDiff.trim().length === 0) {
    return false;
  }

  return manifestDiff
    .split('\n')
    .filter((line) => line.startsWith('+') || line.startsWith('-'))
    .filter((line) => !line.startsWith('+++') && !line.startsWith('---'))
    .some((line) => NATIVE_DEPENDENCY_PATTERN.test(line));
}

export function evaluateTestFlightDeploy({
  changedFiles = [],
  manifestDiff = '',
  hasPreviousTag = true,
} = {}) {
  if (!hasPreviousTag) {
    return {
      shouldDeploy: true,
      matchedPaths: [],
      skippedReason: '',
      changedFiles,
    };
  }

  const matchedPaths = [];

  for (const filePath of changedFiles) {
    if (matchesNativeShellPath(filePath)) {
      matchedPaths.push(filePath);
    }
  }

  const manifestChanged = changedFiles.some((filePath) =>
    PACKAGE_MANIFEST_PATHS.has(filePath.replace(/\\/g, '/'))
  );

  if (manifestChanged && manifestDiffHasNativeDependencyChanges(manifestDiff)) {
    for (const manifestPath of PACKAGE_MANIFEST_PATHS) {
      if (changedFiles.includes(manifestPath) && !matchedPaths.includes(manifestPath)) {
        matchedPaths.push(manifestPath);
      }
    }
  }

  if (matchedPaths.length > 0) {
    return {
      shouldDeploy: true,
      matchedPaths,
      skippedReason: '',
      changedFiles,
    };
  }

  return {
    shouldDeploy: false,
    matchedPaths: [],
    skippedReason: 'No native-shell changes detected since the previous release tag.',
    changedFiles,
  };
}

export function listChangedFiles({
  base,
  head,
  execFileSyncFn = execFileSync,
  cwd = process.cwd(),
}) {
  const args = base ? ['diff', '--name-only', `${base}..${head}`] : ['diff', '--name-only', head];

  const output = execFileSyncFn('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function readManifestDiff({
  base,
  head,
  execFileSyncFn = execFileSync,
  cwd = process.cwd(),
}) {
  const args = base
    ? ['diff', `${base}..${head}`, '--', 'package.json', 'package-lock.json']
    : ['diff', head, '--', 'package.json', 'package-lock.json'];

  try {
    return execFileSyncFn('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error) {
      return String(error.stdout ?? '');
    }

    throw error;
  }
}

export function writeGithubOutput(outputPath, values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

export function parseIosTestFlightShouldDeployArgs(argv) {
  const args = {
    base: null,
    head: 'HEAD',
    githubOutput: null,
    changedFiles: null,
    manifestDiff: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === '--base') {
      args.base = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (value === '--head') {
      args.head = argv[index + 1] ?? 'HEAD';
      index += 1;
      continue;
    }

    if (value === '--github-output') {
      args.githubOutput = argv[index + 1] ?? null;
      index += 1;
    }
  }

  return args;
}

export function resolveTestFlightDeployDecision({
  base,
  head,
  execFileSyncFn = execFileSync,
  cwd = process.cwd(),
  changedFiles = null,
  manifestDiff = null,
} = {}) {
  const hasPreviousTag = typeof base === 'string' && base.trim().length > 0;
  const resolvedChangedFiles =
    changedFiles ??
    listChangedFiles({ base: hasPreviousTag ? base : null, head, execFileSyncFn, cwd });
  const resolvedManifestDiff =
    manifestDiff ??
    (hasPreviousTag
      ? readManifestDiff({ base, head, execFileSyncFn, cwd })
      : readManifestDiff({ base: null, head, execFileSyncFn, cwd }));

  return evaluateTestFlightDeploy({
    changedFiles: resolvedChangedFiles,
    manifestDiff: resolvedManifestDiff,
    hasPreviousTag,
  });
}

function main() {
  const args = parseIosTestFlightShouldDeployArgs(process.argv.slice(2));

  try {
    const decision = resolveTestFlightDeployDecision({
      base: args.base,
      head: args.head,
    });

    console.log(`[ios-testflight-should-deploy] should_deploy=${decision.shouldDeploy}`);
    console.log(`[ios-testflight-should-deploy] changed_files=${decision.changedFiles.length}`);

    if (decision.matchedPaths.length > 0) {
      console.log(
        `[ios-testflight-should-deploy] matched_paths=${decision.matchedPaths.join(',')}`
      );
    }

    if (!decision.shouldDeploy) {
      console.log(`[ios-testflight-should-deploy] skipped_reason=${decision.skippedReason}`);
    }

    if (args.githubOutput) {
      writeGithubOutput(args.githubOutput, {
        should_deploy: String(decision.shouldDeploy),
        matched_paths: decision.matchedPaths.join(','),
        skipped_reason: decision.skippedReason,
      });
    }

    if (!decision.shouldDeploy) {
      process.exitCode = 0;
    }
  } catch (error) {
    console.error(
      `[ios-testflight-should-deploy] ${error instanceof Error ? error.message : error}`
    );
    process.exit(1);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main();
}
