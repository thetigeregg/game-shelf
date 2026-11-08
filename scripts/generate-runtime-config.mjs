import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadProjectEnv } from './dotenv.mjs';

const OUTPUT_PATH = resolve(process.cwd(), 'src/assets/runtime-config.js');
const PACKAGE_JSON_PATH = resolve(process.cwd(), 'package.json');

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return fallback;
}

function parsePsPricesRegionPath(value, fallback = 'region-ch') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z0-9-]+$/.test(normalized) ? normalized : fallback;
}

let appVersion = '0.0.0';

try {
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  if (typeof packageJson.version === 'string' && packageJson.version.trim().length > 0) {
    appVersion = packageJson.version.trim();
  }
} catch {
  appVersion = '0.0.0';
}

const envValues = loadProjectEnv();

const showMgcImport = parseBoolean(envValues.FEATURE_MGC_IMPORT, false);
const e2eFixtures = parseBoolean(envValues.FEATURE_E2E_FIXTURES, false);
const tasEnabled = parseBoolean(envValues.FEATURE_TAS, false);
const requireAuth = parseBoolean(envValues.REQUIRE_AUTH, true);
const psPricesRegionPath = parsePsPricesRegionPath(envValues.PSPRICES_REGION_PATH);

const output = `globalThis.__GAME_SHELF_RUNTIME_CONFIG__ = Object.assign(
  {},
  globalThis.__GAME_SHELF_RUNTIME_CONFIG__,
  {
    appVersion: ${JSON.stringify(appVersion)},
    psPricesRegionPath: ${JSON.stringify(psPricesRegionPath)},
    featureFlags: {
      showMgcImport: ${showMgcImport},
      e2eFixtures: ${e2eFixtures},
      tasEnabled: ${tasEnabled},
      requireAuth: ${requireAuth},
    },
  },
);
`;

writeFileSync(OUTPUT_PATH, output, 'utf8');
