import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { signBundleFile } from './ios-live-update-common.mjs';

export {
  signBundleFile,
  signBundleBuffer,
  computeBundleChecksum,
} from './ios-live-update-common.mjs';

export function resolvePrivateKeyPem(options = {}) {
  const inline = options.privateKeyPem ?? process.env.IOS_LIVE_UPDATE_PRIVATE_KEY;
  if (typeof inline === 'string' && inline.trim().length > 0) {
    return inline.trim();
  }

  const keyPath = options.privateKeyPath ?? process.env.IOS_LIVE_UPDATE_PRIVATE_KEY_PATH;
  if (typeof keyPath === 'string' && keyPath.trim().length > 0) {
    return readFileSync(resolve(keyPath.trim()), 'utf8').trim();
  }

  throw new Error(
    'Missing signing key. Set IOS_LIVE_UPDATE_PRIVATE_KEY or IOS_LIVE_UPDATE_PRIVATE_KEY_PATH.'
  );
}

function parseArgs(argv) {
  const args = { bundlePath: null, privateKeyPath: null };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--private-key-path') {
      args.privateKeyPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (!value.startsWith('-') && args.bundlePath === null) {
      args.bundlePath = value;
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.bundlePath) {
    console.error(
      'Usage: node scripts/sign-ios-live-update-bundle.mjs <bundle.zip> [--private-key-path path]'
    );
    process.exit(1);
  }

  try {
    const privateKeyPem = resolvePrivateKeyPem({ privateKeyPath: args.privateKeyPath });
    const result = signBundleFile(resolve(args.bundlePath), privateKeyPem);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(
      `[sign-ios-live-update-bundle] ${error instanceof Error ? error.message : error}`
    );
    process.exit(1);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main();
}
