import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUTPUT_FILE = '.pr-summary-prompt.md';
const DIFF_RANGE = 'origin/main...HEAD';
const EXCLUDED_PATHS = [':(glob,exclude)**/package-lock.json', ':(glob,exclude)**/dist/**'];

function runGit(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 10,
    });
  } catch (error) {
    console.error(`Failed to run command: git ${args.join(' ')}`);

    if (error.stdout) {
      process.stdout.write(error.stdout);
    }
    if (error.stderr) {
      process.stderr.write(error.stderr);
    }

    const code = typeof error.status === 'number' ? error.status : 1;
    process.exit(code);
  }
}

function getDiff() {
  return runGit(['diff', DIFF_RANGE, '--', '.', ...EXCLUDED_PATHS]);
}

function getChangedFiles() {
  return runGit(['diff', '--name-only', DIFF_RANGE, '--', '.', ...EXCLUDED_PATHS]);
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

Open it in Agent and ask the agent to generate the PR description.
`);
}

main();
