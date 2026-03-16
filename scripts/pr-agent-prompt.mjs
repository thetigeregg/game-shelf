import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUTPUT_FILE = '.pr-agent-prompt.md';
const WORKFLOW_NAME = 'CI PR Checks';

function runGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 50
  });
}

function getPR(prNumber) {
  return JSON.parse(runGh(['pr', 'view', prNumber, '--json', 'title,headRefOid']));
}

function getChangedFiles(prNumber) {
  const data = JSON.parse(runGh(['pr', 'view', prNumber, '--json', 'files']));

  return data.files?.map((f) => f.path) ?? [];
}

function getDiff(prNumber) {
  try {
    return runGh(['pr', 'diff', prNumber]);
  } catch {
    return '';
  }
}

function getReviewComments(prNumber) {
  const data = JSON.parse(runGh(['pr', 'view', prNumber, '--json', 'reviews']));

  if (!data.reviews) return [];

  return data.reviews
    .filter((r) => {
      if (!r.body) return false;

      const body = r.body.toLowerCase();
      const author = r.author?.login ?? '';

      if (author.includes('copilot')) return false;

      if (body.includes('low confidence')) return false;

      if (body.includes('comments suppressed')) return false;

      if (body.includes('<details>')) return false;

      return body.trim().length > 0;
    })
    .map((r) => ({
      author: r.author?.login ?? 'reviewer',
      body: r.body.trim()
    }));
}

function getLatestCIRun(commitSha) {
  const runs = JSON.parse(
    runGh([
      'run',
      'list',
      '--commit',
      commitSha,
      '--json',
      'databaseId,workflowName,status,conclusion',
      '--limit',
      '20'
    ])
  );

  return runs.find((r) => r.workflowName === WORKFLOW_NAME);
}

function getJobs(runId) {
  const result = JSON.parse(runGh(['run', 'view', runId, '--json', 'jobs']));

  return result.jobs ?? [];
}

function detectFailures(jobs) {
  const failures = [];

  for (const job of jobs) {
    if (!job.steps) continue;

    for (const step of job.steps) {
      if (step.conclusion === 'failure') {
        failures.push({
          job: job.name,
          step: step.name,
          jobId: job.databaseId
        });
      }
    }
  }

  return failures;
}

function getFailureLogs(runId, failures) {
  let logs = '';

  for (const failure of failures) {
    try {
      const jobLogs = runGh(['run', 'view', runId, '--job', failure.jobId, '--log']);

      logs += '\n\n===== JOB: ' + failure.job + ' =====\n\n';
      logs += jobLogs;
    } catch {}
  }

  return logs;
}

function extractErrorContext(logs) {
  if (!logs) return [];

  const lines = logs.split('\n');

  const patterns = [
    'FAIL',
    'Error:',
    'Coverage for',
    'does not meet',
    'eslint',
    'TS',
    'Test Suites:'
  ];

  const idx = lines.findIndex((line) => patterns.some((p) => line.includes(p)));

  if (idx === -1) return lines.slice(-40);

  const start = Math.max(0, idx - 25);
  const end = Math.min(lines.length, idx + 25);

  return lines.slice(start, end);
}

function detectCoverageIssues(logs) {
  const match = logs.match(/Coverage.*?(\d+)%.*?(\d+)%/i);

  if (!match) return null;

  return {
    actual: match[1],
    required: match[2]
  };
}

function buildPrompt({ prNumber, title, files, diff, failures, reviewComments, logs }) {
  const relevantLogs = extractErrorContext(logs);
  const coverage = detectCoverageIssues(logs);

  let md = `
# Pull Request Agent Task

Pull Request: #${prNumber}
Title: ${title}

Your goal is to resolve CI failures and review feedback.

---

# Changed Files
`;

  if (files.length) {
    for (const f of files) md += `• ${f}\n`;
  } else {
    md += 'No changed files detected.\n';
  }

  md += '\n---\n';

  if (failures.length) {
    md += `
# CI Failures
`;

    for (const f of failures) {
      md += `
Failing Job: ${f.job}
Failing Step: ${f.step}
`;
    }

    if (coverage) {
      md += `
Coverage Issue Detected

Actual Coverage: ${coverage.actual}%
Required Coverage: ${coverage.required}%
`;
    }

    if (relevantLogs.length) {
      md += `
Relevant CI Log Snippet

\`\`\`
${relevantLogs.join('\n')}
\`\`\`
`;
    }

    md += '\n---\n';
  }

  if (reviewComments.length) {
    md += `
# Review Feedback
`;

    for (const r of reviewComments) {
      md += `
Reviewer: ${r.author}

${r.body}

`;
    }

    md += '\n---\n';
  }

  md += `
# Pull Request Diff

Use this diff to understand the intended changes.

\`\`\`diff
${diff}
\`\`\`

---

# Instructions for the Agent

1. Fix CI failures
2. Address review comments
3. Modify only the relevant files
4. Ensure lint, tests, and coverage pass
5. Preserve project coding conventions

---

# Final Step

Generate the Conventional Commit message for the changes.
`;

  return md.trim() + '\n';
}

function main() {
  const prNumber = process.argv[2];

  if (!prNumber) {
    console.error('Usage: npm run pr:agent <PR_NUMBER>');
    process.exit(1);
  }

  console.log(`Generating agent prompt for PR #${prNumber}`);

  const pr = getPR(prNumber);

  const files = getChangedFiles(prNumber);
  const diff = getDiff(prNumber);
  const reviewComments = getReviewComments(prNumber);

  const run = getLatestCIRun(pr.headRefOid);

  let failures = [];
  let logs = '';

  if (run) {
    console.log(`Using workflow run: ${run.databaseId}`);

    const jobs = getJobs(run.databaseId);

    failures = detectFailures(jobs);

    if (failures.length) {
      logs = getFailureLogs(run.databaseId, failures);
    }
  }

  const prompt = buildPrompt({
    prNumber,
    title: pr.title,
    files,
    diff,
    failures,
    reviewComments,
    logs
  });

  fs.writeFileSync(OUTPUT_FILE, prompt);

  console.log(`
Agent prompt generated:

${OUTPUT_FILE}

CI failures: ${failures.length}
Review comments: ${reviewComments.length}
Files changed: ${files.length}
`);
}

main();
