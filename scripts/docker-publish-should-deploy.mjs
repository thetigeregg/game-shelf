import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  listChangedFiles,
  manifestDiffHasDependencyChanges,
  manifestDiffHasNonVersionChanges,
  readManifestDiff,
  writeGithubOutput,
} from './release-diff.mjs';

export const IMAGE_KEYS = ['edge', 'api', 'hltb', 'metacritic', 'psprices', 'backup'];

export const EDGE_EXACT_PATHS = new Set([
  'angular.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'ionic.config.json',
  'capacitor.config.ts',
]);

export const EDGE_WEB_DEPENDENCY_PATTERN = /@angular\/|@ionic\/|"ionicons"|"zone\.js"|"rxjs"/;

export const MANIFEST_PATHS_BY_IMAGE = {
  edge: ['package.json', 'package-lock.json'],
  api: ['server/package.json', 'server/package-lock.json'],
  hltb: ['hltb-scraper/package.json', 'hltb-scraper/package-lock.json'],
  metacritic: ['metacritic-scraper/package.json', 'metacritic-scraper/package-lock.json'],
  psprices: ['psprices-scraper/package.json', 'psprices-scraper/package-lock.json'],
};

export function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

export function isPackageManifestPath(filePath) {
  const normalized = normalizePath(filePath);
  return Object.values(MANIFEST_PATHS_BY_IMAGE).flat().includes(normalized);
}

export function matchesImagePath(imageKey, filePath) {
  const normalized = normalizePath(filePath);

  if (isPackageManifestPath(normalized)) {
    return false;
  }

  switch (imageKey) {
    case 'edge':
      return (
        normalized.startsWith('edge/') ||
        normalized.startsWith('src/') ||
        normalized.startsWith('config/') ||
        normalized.startsWith('scripts/') ||
        normalized.startsWith('metacritic-scraper/src/') ||
        EDGE_EXACT_PATHS.has(normalized)
      );
    case 'api':
      return (
        normalized.startsWith('server/') ||
        normalized.startsWith('worker/') ||
        normalized.startsWith('shared/')
      );
    case 'hltb':
      return normalized.startsWith('hltb-scraper/') || normalized.startsWith('shared/');
    case 'metacritic':
      return normalized.startsWith('metacritic-scraper/') || normalized.startsWith('shared/');
    case 'psprices':
      return normalized.startsWith('psprices-scraper/') || normalized.startsWith('shared/');
    case 'backup':
      return normalized.startsWith('backup/') || normalized.startsWith('scripts/backup/');
    default:
      return false;
  }
}

export function manifestDiffTriggersImage(imageKey, manifestDiff) {
  if (!manifestDiff || manifestDiff.trim().length === 0) {
    return false;
  }

  if (imageKey === 'edge') {
    return manifestDiffHasDependencyChanges(manifestDiff, EDGE_WEB_DEPENDENCY_PATTERN);
  }

  if (['api', 'hltb', 'metacritic', 'psprices'].includes(imageKey)) {
    return manifestDiffHasNonVersionChanges(manifestDiff);
  }

  return false;
}

export function evaluateDockerPublishDeploy({
  changedFiles = [],
  manifestDiffs = {},
  hasPreviousTag = true,
} = {}) {
  if (!hasPreviousTag) {
    return IMAGE_KEYS.reduce(
      (result, imageKey) => {
        result.images[imageKey] = {
          shouldPublish: true,
          matchedPaths: [],
        };
        return result;
      },
      {
        images: {},
        skippedImages: [],
        changedFiles,
      }
    );
  }

  const images = Object.fromEntries(
    IMAGE_KEYS.map((imageKey) => [imageKey, { shouldPublish: false, matchedPaths: [] }])
  );

  for (const filePath of changedFiles) {
    for (const imageKey of IMAGE_KEYS) {
      if (matchesImagePath(imageKey, filePath)) {
        images[imageKey].shouldPublish = true;
        images[imageKey].matchedPaths.push(normalizePath(filePath));
      }
    }
  }

  for (const imageKey of IMAGE_KEYS) {
    const manifestPaths = MANIFEST_PATHS_BY_IMAGE[imageKey];
    if (!manifestPaths) {
      continue;
    }

    const manifestChanged = changedFiles.some((filePath) =>
      manifestPaths.includes(normalizePath(filePath))
    );

    if (manifestChanged && manifestDiffTriggersImage(imageKey, manifestDiffs[imageKey] ?? '')) {
      images[imageKey].shouldPublish = true;

      for (const manifestPath of manifestPaths) {
        if (
          changedFiles.map(normalizePath).includes(manifestPath) &&
          !images[imageKey].matchedPaths.includes(manifestPath)
        ) {
          images[imageKey].matchedPaths.push(manifestPath);
        }
      }
    }
  }

  const skippedImages = IMAGE_KEYS.filter((imageKey) => !images[imageKey].shouldPublish);

  return {
    images,
    skippedImages,
    changedFiles,
  };
}

export function parseDockerPublishShouldDeployArgs(argv) {
  const args = {
    base: null,
    head: 'HEAD',
    githubOutput: null,
    forceAll: false,
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

    if (value === '--force-all') {
      args.forceAll = true;
    }
  }

  return args;
}

export function resolveDockerPublishDeployDecision({
  base,
  head,
  forceAll = false,
  execFileSyncFn = execFileSync,
  cwd = process.cwd(),
  changedFiles = null,
  manifestDiffs = null,
} = {}) {
  if (forceAll) {
    return evaluateDockerPublishDeploy({
      changedFiles: changedFiles ?? [],
      hasPreviousTag: false,
    });
  }

  const hasPreviousTag = typeof base === 'string' && base.trim().length > 0;
  const resolvedChangedFiles =
    changedFiles ??
    listChangedFiles({ base: hasPreviousTag ? base : null, head, execFileSyncFn, cwd });

  const resolvedManifestDiffs = manifestDiffs ?? {};
  if (!manifestDiffs) {
    for (const [imageKey, paths] of Object.entries(MANIFEST_PATHS_BY_IMAGE)) {
      resolvedManifestDiffs[imageKey] = readManifestDiff({
        base: hasPreviousTag ? base : null,
        head,
        paths,
        execFileSyncFn,
        cwd,
      });
    }
  }

  return evaluateDockerPublishDeploy({
    changedFiles: resolvedChangedFiles,
    manifestDiffs: resolvedManifestDiffs,
    hasPreviousTag,
  });
}

export function formatGithubOutput(decision) {
  const output = {};

  for (const imageKey of IMAGE_KEYS) {
    output[`publish_${imageKey}`] = String(decision.images[imageKey].shouldPublish);
    output[`matched_paths_${imageKey}`] = decision.images[imageKey].matchedPaths.join(',');
  }

  output.skipped_images = decision.skippedImages.join(',');

  return output;
}

function main() {
  const args = parseDockerPublishShouldDeployArgs(process.argv.slice(2));

  try {
    const decision = resolveDockerPublishDeployDecision({
      base: args.base,
      head: args.head,
      forceAll: args.forceAll,
    });

    for (const imageKey of IMAGE_KEYS) {
      const imageDecision = decision.images[imageKey];
      console.log(
        `[docker-publish-should-deploy] publish_${imageKey}=${imageDecision.shouldPublish}`
      );

      if (imageDecision.matchedPaths.length > 0) {
        console.log(
          `[docker-publish-should-deploy] matched_paths_${imageKey}=${imageDecision.matchedPaths.join(',')}`
        );
      }
    }

    if (decision.skippedImages.length > 0) {
      console.log(
        `[docker-publish-should-deploy] skipped_images=${decision.skippedImages.join(',')}`
      );
    }

    console.log(`[docker-publish-should-deploy] changed_files=${decision.changedFiles.length}`);

    if (args.githubOutput) {
      writeGithubOutput(args.githubOutput, formatGithubOutput(decision));
    }
  } catch (error) {
    console.error(
      `[docker-publish-should-deploy] ${error instanceof Error ? error.message : error}`
    );
    process.exit(1);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main();
}
