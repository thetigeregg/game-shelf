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

function getPRData(prNumber) {
  const data = JSON.parse(
    runGh(['pr', 'view', prNumber, '--json', 'title,headRefOid,files,comments,reviews'])
  );

  return {
    title: data.title,
    headSha: data.headRefOid,
    files: data.files?.map((f) => f.path) ?? [],
    comments: data.comments ?? [],
    reviews: data.reviews ?? []
  };
}

function filterReviewComments(comments, reviews) {
  const results = [];

  for (const c of comments) {
    if (!c.body) continue;

    const body = c.body.toLowerCase();
    const author = c.author?.login ?? '';

    if (author.includes('copilot')) continue;
    if (author.includes('github-actions')) continue;

    if (body.includes('low confidence')) continue;
    if (body.includes('comments suppressed')) continue;
    if (body.includes('<details>')) continue;

    results.push({
      author: c.author?.login ?? 'reviewer',
      file: c.path ?? '',
      line: c.line ?? '',
      body: c.body.trim()
    });
  }

  for (const r of reviews) {
    if (!r.body) continue;

    const body = r.body.trim();
    if (!body) continue;

    results.push({
      author: r.author?.login ?? 'reviewer',
      file: '',
      line: '',
      body
    });
  }

  return results;
}

function getDiff(prNumber) {
  try {
    return runGh(['pr', 'diff', prNumber]);
  } catch {
    return '';
  }
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

function extractRelevantLogs(logs) {
  if (!logs) return [];

  const lines = logs.split('\n');

  const patterns = [
    'FAIL',
    'Error:',
    'Coverage for',
    'does not meet',
    'Test Suites:',
    'eslint',
    'TS'
  ];

  const idx = lines.findIndex((line) => patterns.some((p) => line.includes(p)));

  if (idx === -1) return lines.slice(-40);

  const start = Math.max(0, idx - 25);
  const end = Math.min(lines.length, idx + 25);

  return lines.slice(start, end);
}

function buildPrompt({ prNumber, title, files, diff, failures, reviewComments, logs }) {
  const relevantLogs = extractRelevantLogs(logs);

  let md = `
# Pull Request Agent Task

Pull Request: #${prNumber}
Title: ${title}

Resolve CI failures and address review feedback.

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
File: ${r.file || 'unknown'}
Line: ${r.line || 'unknown'}

${r.body}

`;
    }

    md += '\n---\n';
  }

  md += `
# Pull Request Diff

\`\`\`diff
${diff}
\`\`\`

---

# Instructions for the Agent

1. Fix CI failures
2. Address reviewer feedback
3. Modify only relevant files
4. Ensure lint, tests, and coverage pass
5. Preserve project conventions

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

  const pr = getPRData(prNumber);

  const reviewComments = filterReviewComments(pr.comments, pr.reviews);

  const diff = getDiff(prNumber);

  const run = getLatestCIRun(pr.headSha);

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
    files: pr.files,
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
Files changed: ${pr.files.length}
`);
}

main();
