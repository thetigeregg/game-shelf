import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { matchesImagePath } from './docker-publish-should-deploy.mjs';
import { matchesNativeShellPath } from './ios-testflight-should-deploy.mjs';
import { listChangedFiles, readManifestDiff, writeGithubOutput } from './release-diff.mjs';

export function evaluateIosLiveUpdateDeploy({
  changedFiles = [],
  hasPreviousTag = true,
  nativeShellChanged = false,
  force = false,
} = {}) {
  if (force) {
    return {
      shouldDeploy: !nativeShellChanged,
      matchedPaths: ['force'],
      skippedReason: nativeShellChanged
        ? 'Native-shell release ships via TestFlight; skip OTA when native changed.'
        : '',
      changedFiles,
    };
  }

  if (!hasPreviousTag) {
    return {
      shouldDeploy: !nativeShellChanged,
      matchedPaths: [],
      skippedReason: nativeShellChanged
        ? 'Native-shell release ships via TestFlight; skip OTA on first tag when native changed.'
        : '',
      changedFiles,
    };
  }

  if (nativeShellChanged) {
    return {
      shouldDeploy: false,
      matchedPaths: [],
      skippedReason:
        'Native-shell changes ship embedded via TestFlight on this tag; OTA is skipped to avoid build-number mismatch.',
      changedFiles,
    };
  }

  const matchedPaths = [];

  for (const filePath of changedFiles) {
    if (matchesImagePath('edge', filePath)) {
      matchedPaths.push(filePath);
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
    skippedReason: 'No iOS live-update (edge web) changes detected since the previous release tag.',
    changedFiles,
  };
}

export function parseIosLiveUpdateShouldDeployArgs(argv) {
  const args = {
    base: null,
    head: 'HEAD',
    githubOutput: null,
    nativeShellChanged: false,
    force: false,
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
      continue;
    }

    if (value === '--native-shell-changed') {
      args.nativeShellChanged = true;
      continue;
    }

    if (value === '--force') {
      args.force = true;
    }
  }

  return args;
}

export function resolveIosLiveUpdateDeployDecision({
  base,
  head,
  execFileSyncFn = execFileSync,
  cwd = process.cwd(),
  changedFiles = null,
  nativeShellChanged = false,
  force = false,
} = {}) {
  if (force) {
    return evaluateIosLiveUpdateDeploy({
      changedFiles: changedFiles ?? [],
      hasPreviousTag: true,
      nativeShellChanged,
      force: true,
    });
  }

  const hasPreviousTag = typeof base === 'string' && base.trim().length > 0;
  const resolvedChangedFiles =
    changedFiles ??
    listChangedFiles({ base: hasPreviousTag ? base : null, head, execFileSyncFn, cwd });

  return evaluateIosLiveUpdateDeploy({
    changedFiles: resolvedChangedFiles,
    hasPreviousTag,
    nativeShellChanged,
  });
}

export function nativeShellChangedFromFiles(changedFiles) {
  return changedFiles.some((filePath) => matchesNativeShellPath(filePath));
}

function main() {
  const args = parseIosLiveUpdateShouldDeployArgs(process.argv.slice(2));

  try {
    const decision = resolveIosLiveUpdateDeployDecision({
      base: args.base,
      head: args.head,
      nativeShellChanged: args.nativeShellChanged,
      force: args.force,
    });

    console.log(`[ios-live-update-should-deploy] should_deploy=${decision.shouldDeploy}`);
    console.log(`[ios-live-update-should-deploy] changed_files=${decision.changedFiles.length}`);

    if (decision.matchedPaths.length > 0) {
      console.log(
        `[ios-live-update-should-deploy] matched_paths=${decision.matchedPaths.join(',')}`
      );
    }

    if (!decision.shouldDeploy && decision.skippedReason) {
      console.log(`[ios-live-update-should-deploy] skipped_reason=${decision.skippedReason}`);
    }

    if (args.githubOutput) {
      writeGithubOutput(args.githubOutput, {
        should_deploy: String(decision.shouldDeploy),
        matched_paths: decision.matchedPaths.join(','),
        skipped_reason: decision.skippedReason,
      });
    }
  } catch (error) {
    console.error(
      `[ios-live-update-should-deploy] ${error instanceof Error ? error.message : error}`
    );
    process.exit(1);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main();
}
