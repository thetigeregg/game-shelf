import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(process.cwd(), '.env');
const OUTPUT_PATH = resolve(process.cwd(), 'src/assets/runtime-config.js');
const PACKAGE_JSON_PATH = resolve(process.cwd(), 'package.json');

function parseDotEnv(content) {
  const values = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    const unquoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;

    values[key] = unquoted;
  }

  return values;
}

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

let envValues = {};
let appVersion = '0.0.0';

try {
  const envContent = readFileSync(ENV_PATH, 'utf8');
  envValues = parseDotEnv(envContent);
} catch {
  envValues = {};
}

try {
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  if (typeof packageJson.version === 'string' && packageJson.version.trim().length > 0) {
    appVersion = packageJson.version.trim();
  }
} catch {
  appVersion = '0.0.0';
}

const showMgcImport = parseBoolean(envValues.FEATURE_MGC_IMPORT, false);
const e2eFixtures = parseBoolean(envValues.FEATURE_E2E_FIXTURES, false);

const output = `window.__GAME_SHELF_RUNTIME_CONFIG__ = Object.assign(
  {},
  window.__GAME_SHELF_RUNTIME_CONFIG__,
  {
    appVersion: ${JSON.stringify(appVersion)},
    featureFlags: {
      showMgcImport: ${showMgcImport},
      e2eFixtures: ${e2eFixtures},
    },
  },
);
`;

writeFileSync(OUTPUT_PATH, output, 'utf8');
