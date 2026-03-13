import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_FILE = '.pr-summary-prompt.md';

function run(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
    maxBuffer: 1024 * 1024 * 10
  });
}

function getDiff() {
  return run("git diff origin/main...HEAD -- . ':(exclude)package-lock.json' ':(exclude)dist'");
}

function getChangedFiles() {
  return run('git diff --name-only origin/main...HEAD');
}

function buildPrompt(diff, files) {
  return `
Generate a pull request description.

Use the repository template located at:

.github/pull_request_template.md

Requirements:

- Title must follow Conventional Commits
- Base the explanation strictly on the git diff
- Do NOT invent behavior or features
- Fill every section of the PR template
- Be technically precise and concise

Changed files:

${files}

Git diff:

${diff}
`;
}

function main() {
  const diff = getDiff();

  if (!diff.trim()) {
    console.log('No changes detected vs origin/main.');
    process.exit(0);
  }

  const files = getChangedFiles();
  const prompt = buildPrompt(diff, files);

  fs.writeFileSync(OUTPUT_FILE, prompt);

  console.log(`
PR summary prompt generated:

${OUTPUT_FILE}

Open it in Cursor and ask the agent to generate the PR description.
`);
}

main();
