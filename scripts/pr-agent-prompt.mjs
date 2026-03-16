import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUTPUT_FILE = '.pr-agent-prompt.md';

function runGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function getPR(prNumber) {
  return JSON.parse(runGh(['pr', 'view', prNumber, '--json', 'title']));
}

function getReviewThreads(prNumber) {
  const data = JSON.parse(runGh(['pr', 'view', prNumber, '--json', 'reviewThreads']));

  const unresolved = data.reviewThreads?.filter((t) => !t.isResolved) ?? [];

  return unresolved.map((t) => ({
    path: t.comments[0]?.path,
    body: t.comments[0]?.body
  }));
}

function getCIFailures(prNumber) {
  const pr = JSON.parse(runGh(['pr', 'view', prNumber, '--json', 'headRefOid']));

  const runs = JSON.parse(
    runGh([
      'run',
      'list',
      '--commit',
      pr.headRefOid,
      '--json',
      'databaseId,workflowName,conclusion',
      '--limit',
      '20'
    ])
  );

  const ciRun = runs.find((r) => r.workflowName === 'CI PR Checks');

  if (!ciRun) return [];

  const jobs = JSON.parse(runGh(['run', 'view', ciRun.databaseId, '--json', 'jobs'])).jobs;

  const failures = [];

  for (const job of jobs) {
    if (!job.steps) continue;

    for (const step of job.steps) {
      if (step.conclusion === 'failure') {
        failures.push({
          job: job.name,
          step: step.name
        });
      }
    }
  }

  return failures;
}

function buildPrompt(prNumber, title, ciFailures, reviewComments) {
  let md = `
# Pull Request Fix Tasks

Pull Request: #${prNumber}
Title: ${title}

Address the issues below so the PR can merge.

---
`;

  if (ciFailures.length) {
    md += `
# CI Failures
`;

    for (const f of ciFailures) {
      md += `
Failing Job: ${f.job}
Failing Step: ${f.step}
`;
    }

    md += '\n---\n';
  }

  if (reviewComments.length) {
    md += `
# PR Review Comments
`;

    for (const r of reviewComments) {
      md += `
File: ${r.path}

${r.body}

`;
    }

    md += '\n---\n';
  }

  md += `
# Final Step

Fix the issues above.

Then generate the Conventional Commit message for the changes.
`;

  return md;
}

function main() {
  const prNumber = process.argv[2];

  if (!prNumber) {
    console.error('Usage: npm run pr:agent <PR_NUMBER>');
    process.exit(1);
  }

  console.log(`Generating agent prompt for PR #${prNumber}`);

  const pr = getPR(prNumber);

  const ciFailures = getCIFailures(prNumber);
  const reviewComments = getReviewThreads(prNumber);

  const prompt = buildPrompt(prNumber, pr.title, ciFailures, reviewComments);

  fs.writeFileSync(OUTPUT_FILE, prompt);

  console.log(`
Agent prompt generated:

${OUTPUT_FILE}

CI failures: ${ciFailures.length}
Review comments: ${reviewComments.length}
`);
}

main();
