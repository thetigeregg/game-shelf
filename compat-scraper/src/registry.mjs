import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dolphinParser } from './parsers/dolphin.mjs';
import { pcsx2Parser } from './parsers/pcsx2.mjs';
import { xemuParser } from './parsers/xemu.mjs';
import { xeniaParser } from './parsers/xenia.mjs';
import { rpcs3Parser } from './parsers/rpcs3.mjs';
import { cemuParser } from './parsers/cemu.mjs';
import { vita3kParser } from './parsers/vita3k.mjs';
import { azaharParser } from './parsers/azahar.mjs';

// Adding a new platform/emulator is: one parser module + one entry here +
// one entry in config/emulation-compat-platform-map.json — nothing else changes.
const PARSER_REGISTRY = {
  dolphin: dolphinParser,
  pcsx2: pcsx2Parser,
  xemu: xemuParser,
  xenia: xeniaParser,
  rpcs3: rpcs3Parser,
  cemu: cemuParser,
  vita3k: vita3kParser,
  azahar: azaharParser,
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
