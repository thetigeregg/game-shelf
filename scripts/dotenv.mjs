import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_ENV_PATH = resolve(process.cwd(), '.env');

export function parseDotEnv(content) {
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

export function loadProjectEnv(processEnv = process.env, options = {}) {
  let dotenvValues = options.dotenvValues;

  if (dotenvValues === undefined) {
    const envPath = options.envPath ?? DEFAULT_ENV_PATH;

    try {
      const readFile = options.readFileSync ?? readFileSync;
      dotenvValues = parseDotEnv(readFile(envPath, 'utf8'));
    } catch {
      dotenvValues = {};
    }
  }

  return {
    ...dotenvValues,
    ...processEnv,
  };
}
