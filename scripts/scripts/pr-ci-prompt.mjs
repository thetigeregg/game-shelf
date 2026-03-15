import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_FILE = '.pr-ci-prompt.md';
const LOG_DIR = '.ci-logs';

function runGh(args) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 50
    });
  } catch (err) {
    console.error('GitHub CLI command failed:', args.join(' '));
    process.exit(1);
  }
}

function getLatestRunForPR(prNumber) {
  const result = runGh([
    'run',
    'list',
    '--json',
    'databaseId,displayTitle,event,headBranch,conclusion',
    '--limit',
    '20'
  ]);

  const runs = JSON.parse(result);

  const prRun = runs.find((r) => r.displayTitle.includes(`#${prNumber}`));

  if (!prRun) {
    throw new Error('Could not find CI run for this PR.');
  }

  return prRun.databaseId;
}

function downloadLogs(runId) {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR);
  }

  console.log('Downloading CI logs...');

  runGh(['run', 'download', runId, '--log', '-D', LOG_DIR]);
}

function extractErrors(content) {
  const lines = content.split('\n');

  const errors = [];

  for (const line of lines) {
    if (
      line.includes('ERROR') ||
      line.includes('Error:') ||
      line.includes('FAIL') ||
      line.includes('failed') ||
      line.includes('TS') ||
      line.includes('eslint')
    ) {
      errors.push(line);
    }
  }

  return errors.slice(0, 200);
}

function collectFailures() {
  const files = fs.readdirSync(LOG_DIR);

  const failures = [];

  for (const file of files) {
    const full = path.join(LOG_DIR, file);

    const content = fs.readFileSync(full, 'utf8');

    const errors = extractErrors(content);

    if (errors.length) {
      failures.push({
        file,
        errors
      });
    }
  }

  return failures;
}

function buildPrompt(prNumber, failures) {
  if (!failures.length) {
    return `No CI failures detected in logs for PR #${prNumber}.`;
  }

  let md = `
# CI Failure Fix Tasks

Pull Request: #${prNumber}

Your job is to resolve CI failures.

Rules:

• Fix the root cause of the errors
• Do not suppress errors unless appropriate
• Preserve project conventions
• Avoid unrelated refactors

---

`;

  let task = 1;

  for (const f of failures) {
    md += `
## Task ${task}

CI Job Log:
${f.file}

Relevant Error Output:

\`\`\`
${f.errors.join('\n')}
\`\`\`

Required Action:

Identify the root cause of these failures and update the code to fix them.

---

`;

    task++;
  }

  md += `
# Final Step

After fixing the issues:

1. Ensure the build passes locally if possible
2. Generate the Conventional Commit message for the changes
`;

  return md;
}

function main() {
  const prNumber = process.argv[2];

  if (!prNumber) {
    console.error('Usage: npm run pr:ci <PR_NUMBER>');
    process.exit(1);
  }

  console.log(`Preparing CI failure tasks for PR #${prNumber}`);

  const runId = getLatestRunForPR(prNumber);

  downloadLogs(runId);

  const failures = collectFailures();

  const prompt = buildPrompt(prNumber, failures);

  fs.writeFileSync(OUTPUT_FILE, prompt);

  console.log(`
CI prompt generated:

${OUTPUT_FILE}

Failures detected: ${failures.length}
`);
}

main();
