import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUTPUT_FILE = '.pr-review-prompt.md';

function runGh(args) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 10
    });
  } catch (error) {
    console.error(`Failed to run: gh ${args.join(' ')}`);

    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);

    process.exit(error.status ?? 1);
  }
}

function getPRComments(prNumber) {
  const json = runGh(['api', `repos/:owner/:repo/pulls/${prNumber}/comments`]);

  return JSON.parse(json);
}

function buildPrompt(prNumber, comments) {
  if (!comments.length) {
    return `
No PR review comments found for PR #${prNumber}.
`;
  }

  const sections = comments.map((c) => {
    const file = c.path ?? 'unknown';
    const line = c.line ?? c.original_line ?? '?';
    const user = c.user?.login ?? 'unknown';
    const body = c.body ?? '';
    const diff = c.diff_hunk ?? '';

    return `
## FILE: ${file}
LINE: ${line}

Reviewer: ${user}

Comment:
${body}

Diff Context:
\`\`\`diff
${diff}
\`\`\`

---
`;
  });

  return `
You are addressing GitHub PR review comments.

Apply fixes directly to the repository.

Requirements:

• Only modify code related to the comment
• Preserve existing style
• Do not introduce unrelated refactors
• If a comment is unclear, inspect the referenced file

Pull Request: #${prNumber}

Review comments:

${sections.join('\n')}
`;
}

function main() {
  const prNumber = process.argv[2];

  if (!prNumber) {
    console.error('Usage: npm run pr:review <PR_NUMBER>');
    process.exit(1);
  }

  const comments = getPRComments(prNumber);
  const prompt = buildPrompt(prNumber, comments);

  fs.writeFileSync(OUTPUT_FILE, prompt);

  console.log(`
PR review prompt generated:

${OUTPUT_FILE}

Open it in your VSCode agent and ask it to resolve the comments.
`);
}

main();
