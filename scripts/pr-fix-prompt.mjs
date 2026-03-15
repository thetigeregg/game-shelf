import fs from 'node:fs';

const OUTPUT_FILE = '.pr-fix-prompt.md';

function readFileIfExists(path) {
  try {
    if (fs.existsSync(path)) {
      const content = fs.readFileSync(path, 'utf8').trim();
      return content.length ? content : null;
    }
  } catch {}
  return null;
}

function buildPrompt(prNumber, review, ci) {
  let md = `
# Pull Request Fix Tasks

Pull Request: #${prNumber}

Your goal is to resolve all issues preventing this PR from merging.

Fix in this order:

1. CI failures
2. PR review comments

Do not introduce unrelated refactors.

---
`;

  if (ci) {
    md += `
# CI Failures

${ci}

---
`;
  }

  if (review) {
    md += `
# PR Review Comments

${review}

---
`;
  }

  md += `
# Final Validation

After applying fixes:

• All CI checks must pass
• All review comments must be addressed
• Frontend build must succeed
• Linting must pass with no errors
• Frontend tests must pass with no failures
• Backend tests must pass with no failures

Finally:

Generate the Conventional Commit message for the changes.
`;

  return md.trim() + '\n';
}

function main() {
  const prNumber = process.argv[2];

  if (!prNumber) {
    console.error('Usage: npm run pr:fix <PR_NUMBER>');
    process.exit(1);
  }

  const review = readFileIfExists('.pr-review-prompt.md');
  const ci = readFileIfExists('.pr-ci-prompt.md');

  if (!review && !ci) {
    console.error('No input prompts found (.pr-review-prompt.md or .pr-ci-prompt.md).');
    process.exit(1);
  }

  const prompt = buildPrompt(prNumber, review, ci);

  fs.writeFileSync(OUTPUT_FILE, prompt);

  console.log(`
Unified PR fix prompt generated:

${OUTPUT_FILE}

Included sections:
- CI: ${ci ? 'yes' : 'no'}
- Review: ${review ? 'yes' : 'no'}
`);
}

main();
