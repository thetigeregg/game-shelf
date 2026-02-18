import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(process.cwd(), '.env');
const OUTPUT_PATH = resolve(process.cwd(), 'src/assets/runtime-config.js');

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

try {
  const envContent = readFileSync(ENV_PATH, 'utf8');
  envValues = parseDotEnv(envContent);
} catch {
  envValues = {};
}

const showMgcImport = parseBoolean(envValues.FEATURE_MGC_IMPORT, false);

const output = `window.__GAME_SHELF_RUNTIME_CONFIG__ = Object.assign(
  {},
  window.__GAME_SHELF_RUNTIME_CONFIG__,
  {
    featureFlags: {
      showMgcImport: ${showMgcImport},
    },
  },
);
`;

writeFileSync(OUTPUT_PATH, output, 'utf8');
