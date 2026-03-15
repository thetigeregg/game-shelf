function buildPrompt(prNumber, review, ci) {
  let md = `
# Pull Request Fix Tasks

Pull Request: #${prNumber}

Your goal is to resolve all issues preventing this PR from merging.

Fix in this order:

1. CI failures
2. PR review comments

Avoid unrelated refactors.

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

Finally:

Generate the Conventional Commit message for the changes.
`;

  return md;
}
