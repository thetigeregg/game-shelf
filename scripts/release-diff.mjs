import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export function listChangedFiles({
  base,
  head,
  execFileSyncFn = execFileSync,
  cwd = process.cwd(),
}) {
  const args = base
    ? ['diff', '--name-only', `${base}..${head}`]
    : ['diff', '--name-only', `${head}^..${head}`];

  const output = execFileSyncFn('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function readManifestDiff({
  base,
  head,
  paths = ['package.json', 'package-lock.json'],
  execFileSyncFn = execFileSync,
  cwd = process.cwd(),
}) {
  const args = base
    ? ['diff', `${base}..${head}`, '--', ...paths]
    : ['diff', `${head}^..${head}`, '--', ...paths];

  try {
    return execFileSyncFn('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error) {
      return String(error.stdout ?? '');
    }

    throw error;
  }
}

export function listVersionTags({ execFileSyncFn = execFileSync, cwd = process.cwd() } = {}) {
  const output = execFileSyncFn('git', ['tag', '--list', 'v*', '--sort=-v:refname'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function resolvePreviousTag(
  currentTag,
  { execFileSyncFn = execFileSync, cwd = process.cwd() } = {}
) {
  if (typeof currentTag !== 'string' || currentTag.trim().length === 0) {
    return null;
  }

  const tags = listVersionTags({ execFileSyncFn, cwd });
  const index = tags.indexOf(currentTag);

  if (index < 0 || index >= tags.length - 1) {
    return null;
  }

  return tags[index + 1];
}

export function diffLines(manifestDiff) {
  if (typeof manifestDiff !== 'string' || manifestDiff.trim().length === 0) {
    return [];
  }

  return manifestDiff
    .split('\n')
    .filter((line) => line.startsWith('+') || line.startsWith('-'))
    .filter((line) => !line.startsWith('+++') && !line.startsWith('---'));
}

export function manifestDiffHasDependencyChanges(manifestDiff, pattern) {
  return diffLines(manifestDiff).some((line) => pattern.test(line));
}

export function manifestDiffHasNonVersionChanges(manifestDiff) {
  return diffLines(manifestDiff).some((line) => !/["']version["']/.test(line));
}

export function writeGithubOutput(outputPath, values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}
