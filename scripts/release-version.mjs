#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');

function run(command) {
  return execSync(command, { stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
}

function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10)
  };
}

function bumpVersion(version, bumpType) {
  const parsed = parseSemver(version);

  if (bumpType === 'major') {
    return `${parsed.major + 1}.0.0`;
  }

  if (bumpType === 'minor') {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }

  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function getLatestTag() {
  const tags = run("git tag --list 'v*' --sort=-v:refname");
  if (!tags) {
    return null;
  }

  return tags.split('\n')[0] ?? null;
}

function getCommitMessages(range) {
  const log = run(`git log --format=%s%x1f%b%x1e ${range}`);
  if (!log) {
    return [];
  }

  return log
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject = '', body = ''] = entry.split('\x1f');
      return { subject: subject.trim(), body: body.trim() };
    });
}

function inferBumpType(commits) {
  for (const commit of commits) {
    const full = `${commit.subject}\n${commit.body}`;
    if (/BREAKING CHANGE:/i.test(full) || /^[a-z]+(?:\([^)]*\))?!:/i.test(commit.subject)) {
      return 'major';
    }
  }

  for (const commit of commits) {
    if (/^feat(?:\([^)]*\))?:\s/i.test(commit.subject)) {
      return 'minor';
    }
  }

  return 'patch';
}

function getCommitsForChangelog(range) {
  const log = run(`git log --format=%h%x1f%s ${range}`);
  if (!log) {
    return [];
  }

  return log
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha = '', subject = ''] = line.split('\x1f');
      return { sha: sha.trim(), subject: subject.trim() };
    })
    .filter((entry) => entry.subject && !entry.subject.startsWith('chore(release):'));
}

function updateChangelog(nextVersion, commits) {
  const today = new Date().toISOString().slice(0, 10);
  const releaseTitle = `## v${nextVersion} - ${today}`;
  const lines =
    commits.length > 0
      ? commits.map((commit) => `- ${commit.sha} ${commit.subject}`)
      : ['- Maintenance release'];
  const entry = `${releaseTitle}\n${lines.join('\n')}\n`;

  const changelogPath = 'CHANGELOG.md';
  const existing = existsSync(changelogPath)
    ? readFileSync(changelogPath, 'utf8').trim()
    : '# Changelog';
  const normalized = existing.length > 0 ? existing : '# Changelog';
  const next = `${normalized}\n\n${entry}\n`;

  if (!DRY_RUN) {
    writeFileSync(changelogPath, next);
  }
}

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    writeFileSync(outputPath, `${name}=${value}\n`, { flag: 'a' });
  }
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const currentVersion = pkg.version;
if (!currentVersion) {
  throw new Error('Root package.json is missing a version field.');
}

const latestTag = getLatestTag();
const range = latestTag ? `${latestTag}..HEAD` : 'HEAD';
const commits = getCommitMessages(range);
const bumpType = inferBumpType(commits);
const nextVersion = bumpVersion(currentVersion, bumpType);
const changelogCommits = getCommitsForChangelog(range);

if (!DRY_RUN) {
  run(`npm version ${nextVersion} --no-git-tag-version`);
  updateChangelog(nextVersion, changelogCommits);
}

const parsed = parseSemver(nextVersion);
const tag = `v${nextVersion}`;

setOutput('version', nextVersion);
setOutput('major', String(parsed.major));
setOutput('minor', String(parsed.minor));
setOutput('tag', tag);
setOutput('bump_type', bumpType);

process.stdout.write(`${nextVersion}\n`);
