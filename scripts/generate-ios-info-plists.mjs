import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import plist from 'plist';

export const SHARED_INFO_PLIST = 'ios/App/App/Info.shared.plist';

export const INFO_PLIST_VARIANTS = {
  dev: {
    overlay: 'ios/App/App/Info.dev.overlay.plist',
    output: 'ios/App/App/Info.dev.plist',
  },
  prod: {
    overlay: 'ios/App/App/Info.prod.overlay.plist',
    output: 'ios/App/App/Info.prod.plist',
  },
};

export const INFO_PLIST_KEY_ORDER = [
  'CAPACITOR_DEBUG',
  'CFBundleDevelopmentRegion',
  'CFBundleDisplayName',
  'CFBundleExecutable',
  'CFBundleIdentifier',
  'CFBundleInfoDictionaryVersion',
  'CFBundleName',
  'CFBundlePackageType',
  'CFBundleShortVersionString',
  'CFBundleVersion',
  'ITSAppUsesNonExemptEncryption',
  'LSRequiresIPhoneOS',
  'NSAppTransportSecurity',
  'UIBackgroundModes',
  'UILaunchStoryboardName',
  'UIMainStoryboardFile',
  'UIRequiredDeviceCapabilities',
  'UISupportedInterfaceOrientations',
  'UISupportedInterfaceOrientations~ipad',
  'UIViewControllerBasedStatusBarAppearance',
];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepMergePlist(base, overlay) {
  const merged = { ...base };

  for (const [key, overlayValue] of Object.entries(overlay)) {
    const baseValue = merged[key];

    if (isPlainObject(baseValue) && isPlainObject(overlayValue)) {
      merged[key] = deepMergePlist(baseValue, overlayValue);
      continue;
    }

    merged[key] = overlayValue;
  }

  return merged;
}

export function orderMergedPlistKeys(merged, keyOrder = INFO_PLIST_KEY_ORDER) {
  const mergedKeys = Object.keys(merged);
  const orderedKeys = [
    ...keyOrder.filter((key) => mergedKeys.includes(key)),
    ...mergedKeys.filter((key) => !keyOrder.includes(key)),
  ];

  return Object.fromEntries(orderedKeys.map((key) => [key, merged[key]]));
}

export function readPlistFile(filePath, readFileSyncFn = readFileSync) {
  const source = readFileSyncFn(filePath, 'utf8');
  const parsed = plist.parse(source);

  if (!isPlainObject(parsed)) {
    throw new Error(`Expected plist root dictionary at ${filePath}`);
  }

  return parsed;
}

export function buildInfoPlistXml(merged) {
  return `${plist.build(merged, { indent: '\t', offset: -1 })}\n`;
}

export function mergeInfoPlistVariant({ sharedPath, overlayPath, readFileSyncFn = readFileSync }) {
  const shared = readPlistFile(sharedPath, readFileSyncFn);
  const overlay = readPlistFile(overlayPath, readFileSyncFn);
  const merged = deepMergePlist(shared, overlay);

  return orderMergedPlistKeys(merged);
}

export function resolveInfoPlistPaths({ repoRoot, variant, variants = INFO_PLIST_VARIANTS }) {
  const config = variants[variant];

  if (!config) {
    throw new Error(`Unknown iOS Info.plist variant: ${variant}`);
  }

  return {
    variant,
    sharedPath: path.resolve(repoRoot, SHARED_INFO_PLIST),
    overlayPath: path.resolve(repoRoot, config.overlay),
    outputPath: path.resolve(repoRoot, config.output),
  };
}

export function generateIosInfoPlistVariant({
  repoRoot,
  variant,
  variants = INFO_PLIST_VARIANTS,
  readFileSyncFn = readFileSync,
  writeFileSyncFn = writeFileSync,
  write = true,
}) {
  const paths = resolveInfoPlistPaths({ repoRoot, variant, variants });
  const merged = mergeInfoPlistVariant({
    sharedPath: paths.sharedPath,
    overlayPath: paths.overlayPath,
    readFileSyncFn,
  });
  const xml = buildInfoPlistXml(merged);

  if (write) {
    writeFileSyncFn(paths.outputPath, xml, 'utf8');
  }

  return {
    ...paths,
    merged,
    xml,
  };
}

export function generateIosInfoPlists({
  repoRoot = process.cwd(),
  variants = INFO_PLIST_VARIANTS,
  readFileSyncFn = readFileSync,
  writeFileSyncFn = writeFileSync,
  write = true,
  check = false,
  log = console.log,
} = {}) {
  const results = [];
  const stale = [];

  for (const variant of Object.keys(variants)) {
    const result = generateIosInfoPlistVariant({
      repoRoot,
      variant,
      variants,
      readFileSyncFn,
      writeFileSyncFn,
      write: check ? false : write,
    });

    if (check) {
      const existing = readFileSyncFn(result.outputPath, 'utf8');
      if (existing !== result.xml) {
        stale.push(result);
      }
    } else if (write) {
      log(`[generate-ios-info-plists] Wrote ${path.relative(repoRoot, result.outputPath)}`);
    }

    results.push(result);
  }

  if (check && stale.length > 0) {
    const relativePaths = stale
      .map((entry) => path.relative(repoRoot, entry.outputPath))
      .join(', ');
    throw new Error(
      `Generated iOS Info.plist output is stale for: ${relativePaths}. Run npm run generate:ios-info-plists.`
    );
  }

  return { results, stale };
}

export function parseGenerateIosInfoPlistsArgs(argv) {
  return {
    check: argv.includes('--check'),
  };
}

async function main() {
  const args = parseGenerateIosInfoPlistsArgs(process.argv.slice(2));

  try {
    generateIosInfoPlists({ check: args.check });
  } catch (error) {
    console.error(`[generate-ios-info-plists] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  main();
}
