import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_FILE = '.pr-coverage-prompt.md';
const ARTIFACT_DIR = '.coverage-artifacts';

function runGh(args) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 20
    });
  } catch (err) {
    console.error('GitHub CLI command failed:', args.join(' '));
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    process.exit(1);
  }
}

function getRepoInfo() {
  const result = runGh(['repo', 'view', '--json', 'nameWithOwner']);
  const parsed = JSON.parse(result);
  const [owner, repo] = parsed.nameWithOwner.split('/');
  return { owner, repo };
}

function getPRFiles(prNumber) {
  const result = runGh(['pr', 'view', prNumber, '--json', 'files']);

  const parsed = JSON.parse(result);

  return parsed.files.map((f) => f.path);
}

function getWorkflowRunId(prNumber) {
  const result = runGh(['run', 'list', '--json', 'databaseId,headBranch,event', '--limit', '20']);

  const runs = JSON.parse(result);

  const prRun = runs.find((r) => r.event === 'pull_request');

  if (!prRun) {
    throw new Error('Could not find workflow run for PR');
  }

  return prRun.databaseId;
}

function downloadCoverageArtifacts(runId) {
  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR);
  }

  console.log('Downloading coverage artifacts...');

  runGh(['run', 'download', runId, '-n', 'coverage-reports', '-D', ARTIFACT_DIR]);
}

function parseLcov(file) {
  const content = fs.readFileSync(file, 'utf8');

  let currentFile = null;
  const uncovered = {};

  for (const line of content.split('\n')) {
    if (line.startsWith('SF:')) {
      currentFile = line.slice(3);
    }

    if (line.startsWith('DA:')) {
      const [lineNumber, hits] = line.slice(3).split(',');

      if (Number(hits) === 0) {
        if (!uncovered[currentFile]) {
          uncovered[currentFile] = [];
        }

        uncovered[currentFile].push(Number(lineNumber));
      }
    }
  }

  return uncovered;
}

function collectCoverage() {
  const uncovered = {};

  const files = fs.readdirSync(ARTIFACT_DIR);

  for (const file of files) {
    if (!file.endsWith('.info')) continue;

    const filePath = path.join(ARTIFACT_DIR, file);

    const parsed = parseLcov(filePath);

    for (const f in parsed) {
      if (!uncovered[f]) uncovered[f] = [];

      uncovered[f].push(...parsed[f]);
    }
  }

  return uncovered;
}

function intersectWithPRFiles(uncovered, prFiles) {
  const tasks = {};

  for (const file in uncovered) {
    const match = prFiles.find((f) => file.endsWith(f));

    if (!match) continue;

    tasks[match] = uncovered[file];
  }

  return tasks;
}

function buildPrompt(prNumber, tasks) {
  if (!Object.keys(tasks).length) {
    return `No uncovered lines detected for files modified in PR #${prNumber}.`;
  }

  let md = `
# Coverage Fix Tasks

Pull Request: #${prNumber}

Your task is to increase test coverage for the code modified in this PR.

Rules:

• Add tests instead of modifying production logic
• Cover uncovered branches where possible
• Follow existing test patterns
• Do not introduce unrelated refactors

---

`;

  let taskNumber = 1;

  for (const file in tasks) {
    const lines = tasks[file];

    md += `
## Task ${taskNumber}

File:
${file}

Uncovered lines:
${lines.join(', ')}

Required Action:

Write tests that execute the uncovered code paths listed above.

---

`;

    taskNumber++;
  }

  md += `

# Final Step

After writing the tests and verifying they pass:

Generate the Conventional Commit message for the changes.

Use standard Conventional Commit format.
`;

  return md;
}

function main() {
  const prNumber = process.argv[2];

  if (!prNumber) {
    console.error('Usage: npm run pr:coverage <PR_NUMBER>');
    process.exit(1);
  }

  const { owner, repo } = getRepoInfo();

  console.log(`Preparing coverage tasks for PR #${prNumber}`);

  const prFiles = getPRFiles(prNumber);

  const runId = getWorkflowRunId(prNumber);

  downloadCoverageArtifacts(runId);

  const uncovered = collectCoverage();

  const tasks = intersectWithPRFiles(uncovered, prFiles);

  const prompt = buildPrompt(prNumber, tasks);

  fs.writeFileSync(OUTPUT_FILE, prompt);

  console.log(`
Coverage prompt generated:

${OUTPUT_FILE}

Files needing coverage: ${Object.keys(tasks).length}
`);
}

main();
