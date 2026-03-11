#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

function expandUserPath(value) {
  if (!value) {
    return value;
  }

  if (value === '~') {
    return os.homedir();
  }

  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

function normalizeContent(content) {
  return content.replace(/\r\n/g, '\n');
}

function parseEnvEntries(content) {
  const lines = normalizeContent(content).split('\n');
  const assignmentRegex = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
  const entries = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = assignmentRegex.exec(line);
    if (!match) {
      continue;
    }
    entries.push({
      key: match[1],
      value: match[2],
      index
    });
  }

  return entries;
}

function toLastEntryMap(entries) {
  const map = new Map();
  for (const entry of entries) {
    map.set(entry.key, entry);
  }
  return map;
}

function toFirstSeenOrderedKeys(entries) {
  const seen = new Set();
  const ordered = [];
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      continue;
    }
    seen.add(entry.key);
    ordered.push(entry.key);
  }
  return ordered;
}

function addAssignmentLine(sharedContent, key, value) {
  const normalized = normalizeContent(sharedContent);
  if (!normalized || normalized.trim().length === 0) {
    return `${key}=${value}\n`;
  }

  const trimmedEnd = normalized.replace(/\s*$/, '');
  return `${trimmedEnd}\n${key}=${value}\n`;
}

function removeAssignmentLines(sharedContent, key) {
  const assignmentRegex = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  const lines = normalizeContent(sharedContent).split('\n');
  const filtered = lines.filter((line) => !assignmentRegex.test(line));
  const body = filtered.join('\n').replace(/\s*$/, '');
  return body.length > 0 ? `${body}\n` : '';
}

function resolveArg(name, fallback) {
  const prefix = `${name}=`;
  const argWithValue = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (argWithValue) {
    return path.resolve(expandUserPath(argWithValue.slice(prefix.length)));
  }

  const index = process.argv.slice(2).findIndex((value) => value === name);
  if (index >= 0) {
    const value = process.argv.slice(2)[index + 1];
    if (value) {
      return path.resolve(expandUserPath(value));
    }
  }

  return path.resolve(expandUserPath(fallback));
}

function printSummary(exampleMap, sharedMap) {
  const missing = [...exampleMap.keys()].filter((key) => !sharedMap.has(key));
  const extra = [...sharedMap.keys()].filter((key) => !exampleMap.has(key));
  console.log('');
  console.log(`Missing in shared env: ${String(missing.length)}`);
  console.log(`Extra in shared env: ${String(extra.length)}`);
}

async function askChoice(rl) {
  console.log('');
  console.log('Choose an action:');
  console.log('  1) Add missing fields (from .env.example -> shared env)');
  console.log('  2) Delete extra fields (present in shared env but not in .env.example)');
  console.log('  3) Save and exit');
  console.log('  4) Exit without saving');
  const answer = (await askLine(rl, 'Select [1-4]: ')).trim();
  return answer;
}

function askLine(rl, prompt, prefill = '') {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
    if (prefill) {
      rl.write(prefill);
    }
  });
}

async function askYesNo(rl, prompt, defaultYes) {
  const suffix = defaultYes ? ' [Y/n]: ' : ' [y/N]: ';
  const answer = (await askLine(rl, `${prompt}${suffix}`)).trim().toLowerCase();
  if (!answer) {
    return defaultYes;
  }
  return answer === 'y' || answer === 'yes';
}

async function askValue(rl, key, defaultValue) {
  const answer = await askLine(rl, `Value for ${key}: `, defaultValue);
  if (answer.length === 0) {
    return defaultValue;
  }
  return answer;
}

async function runAddMissingFlow(rl, exampleOrderedKeys, exampleMap, sharedMap, sharedContent) {
  let nextContent = sharedContent;
  let changed = false;
  const missingOrderedKeys = exampleOrderedKeys.filter((key) => !sharedMap.has(key));

  if (missingOrderedKeys.length === 0) {
    console.log('');
    console.log('No missing fields found.');
    return { changed, sharedContent: nextContent };
  }

  console.log('');
  console.log(`Found ${String(missingOrderedKeys.length)} missing field(s).`);
  for (const key of missingOrderedKeys) {
    const exampleEntry = exampleMap.get(key);
    if (!exampleEntry) {
      continue;
    }
    const shouldAdd = await askYesNo(rl, `Add ${key}?`, true);
    if (!shouldAdd) {
      continue;
    }
    const selectedValue = await askValue(rl, key, exampleEntry.value);
    nextContent = addAssignmentLine(nextContent, key, selectedValue);
    sharedMap.set(key, { key, value: selectedValue, index: Number.MAX_SAFE_INTEGER });
    changed = true;
    console.log(`Added ${key}.`);
  }

  return { changed, sharedContent: nextContent };
}

async function runDeleteExtraFlow(rl, exampleMap, sharedMap, sharedContent) {
  let nextContent = sharedContent;
  let changed = false;
  const extraKeys = [...sharedMap.keys()].filter((key) => !exampleMap.has(key));

  if (extraKeys.length === 0) {
    console.log('');
    console.log('No extra fields found.');
    return { changed, sharedContent: nextContent };
  }

  console.log('');
  console.log(`Found ${String(extraKeys.length)} extra field(s).`);
  for (const key of extraKeys) {
    const sharedEntry = sharedMap.get(key);
    const displayValue = sharedEntry ? sharedEntry.value : '';
    const shouldDelete = await askYesNo(
      rl,
      `Delete ${key}${displayValue ? `=${displayValue}` : ''}?`,
      false
    );
    if (!shouldDelete) {
      continue;
    }
    nextContent = removeAssignmentLines(nextContent, key);
    sharedMap.delete(key);
    changed = true;
    console.log(`Deleted ${key}.`);
  }

  return { changed, sharedContent: nextContent };
}

function rewriteToExampleTemplate(exampleContent, sharedMap) {
  const assignmentRegex = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/;
  const lines = normalizeContent(exampleContent).split('\n');
  const rewritten = lines.map((line) => {
    const match = assignmentRegex.exec(line);
    if (!match) {
      return line;
    }

    const indentation = match[1];
    const key = match[2];
    const separator = match[3];
    const exampleValue = match[4];
    const sharedEntry = sharedMap.get(key);
    const value = sharedEntry ? sharedEntry.value : exampleValue;
    return `${indentation}${key}${separator}${value}`;
  });

  const body = rewritten.join('\n').replace(/\s*$/, '');
  return body.length > 0 ? `${body}\n` : '';
}

async function main() {
  if (!input.isTTY || !output.isTTY) {
    console.error('This script is interactive and must be run in a TTY.');
    process.exit(1);
  }

  const defaultSharedEnvFile = path.join(os.homedir(), '.config', 'game-shelf', 'worktree.env');
  const sharedPath = resolveArg(
    '--shared',
    process.env.WORKTREE_ENV_FILE && process.env.WORKTREE_ENV_FILE.trim()
      ? process.env.WORKTREE_ENV_FILE
      : defaultSharedEnvFile
  );
  const examplePath = resolveArg('--example', path.resolve(process.cwd(), '.env.example'));

  if (!existsSync(examplePath)) {
    console.error(`Example env file not found: ${examplePath}`);
    process.exit(1);
  }

  const exampleContent = readFileSync(examplePath, 'utf8');
  const exampleEntries = parseEnvEntries(exampleContent);
  const exampleMap = toLastEntryMap(exampleEntries);
  const exampleOrderedKeys = toFirstSeenOrderedKeys(exampleEntries);

  let sharedContent = existsSync(sharedPath) ? readFileSync(sharedPath, 'utf8') : '';
  let dirty = false;

  const rl = readline.createInterface({ input, output });

  try {
    console.log('Worktree Env Reconciler');
    console.log(`Example file: ${examplePath}`);
    console.log(`Shared file:  ${sharedPath}${existsSync(sharedPath) ? '' : ' (will be created)'}`);

    while (true) {
      const sharedEntries = parseEnvEntries(sharedContent);
      const sharedMap = toLastEntryMap(sharedEntries);
      printSummary(exampleMap, sharedMap);

      const choice = await askChoice(rl);
      if (choice === '1') {
        const result = await runAddMissingFlow(
          rl,
          exampleOrderedKeys,
          exampleMap,
          sharedMap,
          sharedContent
        );
        if (result.changed) {
          sharedContent = result.sharedContent;
          dirty = true;
        }
        continue;
      }

      if (choice === '2') {
        const result = await runDeleteExtraFlow(rl, exampleMap, sharedMap, sharedContent);
        if (result.changed) {
          sharedContent = result.sharedContent;
          dirty = true;
        }
        continue;
      }

      if (choice === '3') {
        const latestSharedMap = toLastEntryMap(parseEnvEntries(sharedContent));
        const normalizedContent = rewriteToExampleTemplate(exampleContent, latestSharedMap);
        mkdirSync(path.dirname(sharedPath), { recursive: true });
        writeFileSync(sharedPath, normalizeContent(normalizedContent), 'utf8');
        console.log(`Saved updates to ${sharedPath}`);
        return;
      }

      if (choice === '4') {
        if (!dirty || (await askYesNo(rl, 'Discard unsaved changes and exit?', false))) {
          console.log('Exited without saving.');
          return;
        }
        continue;
      }

      console.log('Invalid selection. Choose 1, 2, 3, or 4.');
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
