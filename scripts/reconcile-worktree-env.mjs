#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs';
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

function formatTimestampForFilename(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function parseEnvEntries(content, options = {}) {
  const includeCommentedAssignments = Boolean(options.includeCommentedAssignments);
  const lines = normalizeContent(content).split('\n');
  const assignmentRegex = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
  const entries = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith('#')) {
      if (!includeCommentedAssignments) {
        continue;
      }
      const uncommented = trimmed.replace(/^#\s*/, '');
      const commentedMatch = assignmentRegex.exec(uncommented);
      if (!commentedMatch) {
        continue;
      }
      entries.push({
        key: commentedMatch[1],
        value: commentedMatch[2]
      });
      continue;
    }
    const match = assignmentRegex.exec(line);
    if (!match) {
      continue;
    }
    entries.push({
      key: match[1],
      value: match[2]
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

function printSummary(exampleMap, allowedExampleMap, sharedMap) {
  const missing = [...exampleMap.keys()].filter((key) => !sharedMap.has(key));
  const extra = [...sharedMap.keys()].filter((key) => !allowedExampleMap.has(key));
  console.log('');
  console.log(`Missing in shared env: ${String(missing.length)}`);
  console.log(`Extra in shared env: ${String(extra.length)}`);
}

async function askChoice(rl) {
  console.log('');
  console.log('Choose an action:');
  console.log('  1) Add missing fields (from .env.example -> shared env)');
  console.log(
    '  2) Save (normalize to .env.example layout, add missing keys using example values, and activate commented keys) and exit'
  );
  console.log('  3) Exit without saving');
  const answer = (await askLine(rl, 'Select [1-3]: ')).trim();
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
  const hasDefault = typeof defaultValue === 'string' && defaultValue.length > 0;
  const promptSuffix = hasDefault ? ' (Enter for default, "-" for empty)' : '';
  const answer = await askLine(rl, `Value for ${key}${promptSuffix}: `, defaultValue);
  if (answer.length === 0 && hasDefault) {
    return defaultValue;
  }
  if (answer === '-' && hasDefault) {
    return '';
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
    sharedMap.set(key, { key, value: selectedValue });
    changed = true;
    console.log(`Added ${key}.`);
  }

  return { changed, sharedContent: nextContent };
}

function rewriteToExampleTemplate(exampleContent, sharedMap) {
  const assignmentRegex = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/;
  const commentedAssignmentRegex = /^(\s*)#\s*([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/;
  const lines = normalizeContent(exampleContent).split('\n');
  const rewritten = lines.map((line) => {
    const match = assignmentRegex.exec(line);
    if (match) {
      const indentation = match[1];
      const key = match[2];
      const separator = match[3];
      const exampleValue = match[4];
      const sharedEntry = sharedMap.get(key);
      const value = sharedEntry ? sharedEntry.value : exampleValue;
      return `${indentation}${key}${separator}${value}`;
    }

    const commentedMatch = commentedAssignmentRegex.exec(line);
    if (!commentedMatch) {
      return line;
    }

    const indentation = commentedMatch[1];
    const key = commentedMatch[2];
    const separator = commentedMatch[3];
    const sharedEntry = sharedMap.get(key);
    if (!sharedEntry) {
      return line;
    }
    return `${indentation}${key}${separator}${sharedEntry.value}`;
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
  const allowedExampleEntries = parseEnvEntries(exampleContent, {
    includeCommentedAssignments: true
  });
  const exampleMap = toLastEntryMap(exampleEntries);
  const allowedExampleMap = toLastEntryMap(allowedExampleEntries);
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
      printSummary(exampleMap, allowedExampleMap, sharedMap);

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
        const latestSharedMap = toLastEntryMap(parseEnvEntries(sharedContent));
        const extraKeys = [...latestSharedMap.keys()].filter((key) => !allowedExampleMap.has(key));
        if (extraKeys.length > 0) {
          const shouldContinue = await askYesNo(
            rl,
            `Save will remove ${String(extraKeys.length)} extra key(s) not in .env.example and keep optional commented example keys active when already set. Continue?`,
            false
          );
          if (!shouldContinue) {
            continue;
          }
        }
        const normalizedContent = rewriteToExampleTemplate(exampleContent, latestSharedMap);
        mkdirSync(path.dirname(sharedPath), { recursive: true });
        if (existsSync(sharedPath)) {
          const backupPath = `${sharedPath}.bak.${formatTimestampForFilename()}`;
          copyFileSync(sharedPath, backupPath);
          console.log(`Backup created: ${backupPath}`);
        }
        const tempPath = `${sharedPath}.tmp`;
        writeFileSync(tempPath, normalizeContent(normalizedContent), 'utf8');
        renameSync(tempPath, sharedPath);
        console.log(`Saved updates to ${sharedPath}`);
        return;
      }

      if (choice === '3') {
        if (!dirty || (await askYesNo(rl, 'Discard unsaved changes and exit?', false))) {
          console.log('Exited without saving.');
          return;
        }
        continue;
      }

      console.log('Invalid selection. Choose 1, 2, or 3.');
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
