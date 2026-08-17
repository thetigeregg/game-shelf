import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dolphinParser } from './parsers/dolphin.mjs';

// Adding a new platform/emulator is: one parser module + one entry here +
// one entry in config/emulation-compat-platform-map.json — nothing else changes.
const PARSER_REGISTRY = {
  dolphin: dolphinParser,
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const platformMapPath = path.resolve(moduleDir, '../../config/emulation-compat-platform-map.json');
const PLATFORM_MAP = JSON.parse(fs.readFileSync(platformMapPath, 'utf8'));

export function resolvePlatform(platformIgdbId) {
  const entry = PLATFORM_MAP[String(platformIgdbId)];
  if (!entry) {
    return null;
  }

  const parser = PARSER_REGISTRY[entry.emulator];
  if (!parser) {
    return null;
  }

  return {
    emulator: entry.emulator,
    displayName: entry.displayName,
    sourceUrl: entry.sourceUrl,
    platformSlug: String(entry.displayName ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ''),
    parser,
  };
}
