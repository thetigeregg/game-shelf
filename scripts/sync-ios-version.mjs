import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROD_BUNDLE_ID = 'io.github.thetigeregg.gameshelf';
const DEFAULT_PBXPROJ_PATH = resolve(process.cwd(), 'ios/App/App.xcodeproj/project.pbxproj');
const DEFAULT_PACKAGE_JSON_PATH = resolve(process.cwd(), 'package.json');

export function readPackageVersion(packageJsonPath = DEFAULT_PACKAGE_JSON_PATH) {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

  if (typeof packageJson.version !== 'string' || packageJson.version.trim().length === 0) {
    throw new Error(`Missing version in ${packageJsonPath}`);
  }

  return packageJson.version.trim();
}

export function updateProdTargetVersionsInPbxproj(
  content,
  { marketingVersion, buildNumber, prodBundleId = PROD_BUNDLE_ID } = {}
) {
  if (typeof marketingVersion !== 'string' || marketingVersion.trim().length === 0) {
    throw new Error('marketingVersion is required');
  }

  if (typeof buildNumber !== 'string' && typeof buildNumber !== 'number') {
    throw new Error('buildNumber is required');
  }

  const normalizedBuildNumber = String(buildNumber).trim();
  if (normalizedBuildNumber.length === 0) {
    throw new Error('buildNumber is required');
  }

  if (!/^\d+$/.test(normalizedBuildNumber) || Number(normalizedBuildNumber) < 1) {
    throw new Error(`buildNumber must be a positive integer, got "${normalizedBuildNumber}"`);
  }

  const blockRegex = /(\t\t\tbuildSettings = \{)([\s\S]*?)(\t\t\t\};)/g;
  let updatedBlocks = 0;

  const updated = content.replace(blockRegex, (match, open, body, close) => {
    if (!body.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${prodBundleId};`)) {
      return match;
    }

    updatedBlocks += 1;

    let updatedBody = body.replace(
      /^\t\t\t\tMARKETING_VERSION = .*;$/m,
      `\t\t\t\tMARKETING_VERSION = ${marketingVersion};`
    );
    updatedBody = updatedBody.replace(
      /^\t\t\t\tCURRENT_PROJECT_VERSION = .*;$/m,
      `\t\t\t\tCURRENT_PROJECT_VERSION = ${normalizedBuildNumber};`
    );

    return `${open}${updatedBody}${close}`;
  });

  if (updatedBlocks === 0) {
    throw new Error(`No App PROD build settings found for bundle id ${prodBundleId}`);
  }

  return updated;
}

export function syncIosProdVersion({
  marketingVersion,
  buildNumber,
  pbxprojPath = DEFAULT_PBXPROJ_PATH,
  writeFileSyncFn = writeFileSync,
  readFileSyncFn = readFileSync,
} = {}) {
  const resolvedMarketingVersion = marketingVersion ?? readPackageVersion();
  const content = readFileSyncFn(pbxprojPath, 'utf8');
  const updated = updateProdTargetVersionsInPbxproj(content, {
    marketingVersion: resolvedMarketingVersion,
    buildNumber,
  });

  writeFileSyncFn(pbxprojPath, updated, 'utf8');

  return {
    marketingVersion: resolvedMarketingVersion,
    buildNumber: String(buildNumber),
    pbxprojPath,
  };
}

export function parseSyncIosVersionArgs(argv) {
  const args = {
    marketingVersion: null,
    buildNumber: null,
    pbxprojPath: DEFAULT_PBXPROJ_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === '--marketing-version') {
      args.marketingVersion = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === '--build-number') {
      args.buildNumber = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === '--pbxproj') {
      const pbxprojArg = argv[index + 1];
      if (typeof pbxprojArg !== 'string' || pbxprojArg.trim().length === 0) {
        throw new Error('--pbxproj requires a path');
      }

      args.pbxprojPath = resolve(process.cwd(), pbxprojArg);
      index += 1;
    }
  }

  return args;
}

function main() {
  let args;
  try {
    args = parseSyncIosVersionArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[sync-ios-version] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  if (!args.buildNumber) {
    console.error('[sync-ios-version] --build-number is required');
    process.exit(1);
  }

  try {
    const result = syncIosProdVersion({
      marketingVersion: args.marketingVersion ?? undefined,
      buildNumber: args.buildNumber,
      pbxprojPath: args.pbxprojPath,
    });

    console.log(
      `[sync-ios-version] Updated App PROD to ${result.marketingVersion} (${result.buildNumber})`
    );
  } catch (error) {
    console.error(`[sync-ios-version] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main();
}
