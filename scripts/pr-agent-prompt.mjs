import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUTPUT_FILE = '.pr-agent-prompt.md';
const WORKFLOW_NAME = 'CI PR Checks';

const DEBUG = process.env.DEBUG_PR_AGENT === '1' || process.argv.includes('--debug');

function debug(...args) {
  if (DEBUG) {
    console.log('[debug]', ...args);
  }
}

function runGh(args) {
  try {
    const output = execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 50
    });

    debug('gh', args.join(' '));
    return output;
  } catch (err) {
    console.error('GitHub CLI command failed:', args.join(' '));
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    process.exit(1);
  }
}

function getPRData(prNumber) {
  const data = JSON.parse(
    runGh(['pr', 'view', prNumber, '--json', 'title,headRefOid,files,comments,reviews'])
  );

  const result = {
    title: data.title,
    headSha: data.headRefOid,
    files: data.files?.map((f) => f.path) ?? [],
    comments: data.comments ?? [],
    reviews: data.reviews ?? []
  };

  debug('PR title:', result.title);
  debug('PR head SHA:', result.headSha);
  debug('PR changed files:', result.files);

  return result;
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
    if (!c.body.trim()) continue;

    results.push({
      kind: 'inline-comment',
      author: c.author?.login ?? 'reviewer',
      file: c.path ?? '',
      line: c.line ?? '',
      body: c.body.trim()
    });
  }

  for (const r of reviews) {
    if (!r.body) continue;

    const body = r.body.toLowerCase();
    const author = r.author?.login ?? '';

    if (author.includes('copilot')) continue;
    if (author.includes('github-actions')) continue;
    if (body.includes('low confidence')) continue;
    if (body.includes('comments suppressed')) continue;
    if (body.includes('<details>')) continue;
    if (!r.body.trim()) continue;

    results.push({
      kind: 'review-body',
      author: r.author?.login ?? 'reviewer',
      file: '',
      line: '',
      body: r.body.trim()
    });
  }

  debug('Filtered review comments count:', results.length);
  for (const item of results) {
    debug('Review item:', {
      kind: item.kind,
      author: item.author,
      file: item.file,
      line: item.line,
      preview: item.body.slice(0, 120)
    });
  }

  return results;
}

function getDiff(prNumber) {
  try {
    const diff = runGh(['pr', 'diff', prNumber]);
    debug('Diff length:', diff.length);
    return diff;
  } catch {
    debug('Failed to fetch PR diff');
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
      'databaseId,workflowName,status,conclusion,createdAt,displayTitle',
      '--limit',
      '30'
    ])
  );

  debug('Workflow runs returned:', runs.length);
  for (const run of runs) {
    debug('Run candidate:', {
      databaseId: run.databaseId,
      workflowName: run.workflowName,
      displayTitle: run.displayTitle,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.createdAt
    });
  }

  const ciRuns = runs
    .filter((r) => r.workflowName === WORKFLOW_NAME)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  debug('Matching CI workflow runs:', ciRuns.length);

  if (!ciRuns.length) {
    return null;
  }

  const completed = ciRuns.find((r) => r.status === 'completed');
  const selected = completed ?? ciRuns[0];

  debug('Selected CI run:', {
    databaseId: selected.databaseId,
    workflowName: selected.workflowName,
    status: selected.status,
    conclusion: selected.conclusion,
    createdAt: selected.createdAt
  });

  return selected;
}

function getJobs(runId) {
  const result = JSON.parse(runGh(['run', 'view', String(runId), '--json', 'jobs']));

  const jobs = result.jobs ?? [];

  debug('Jobs found for run:', jobs.length);

  for (const job of jobs) {
    debug('Job summary:', {
      name: job.name,
      databaseId: job.databaseId,
      status: job.status,
      conclusion: job.conclusion,
      startedAt: job.startedAt,
      completedAt: job.completedAt
    });

    if (Array.isArray(job.steps)) {
      for (const step of job.steps) {
        debug('Step summary:', {
          job: job.name,
          step: step.name,
          status: step.status,
          conclusion: step.conclusion,
          number: step.number,
          startedAt: step.startedAt,
          completedAt: step.completedAt
        });
      }
    } else {
      debug('Job has no steps array:', job.name);
    }
  }

  return jobs;
}

function detectFailures(jobs) {
  const failures = [];

  for (const job of jobs) {
    const steps = Array.isArray(job.steps) ? job.steps : [];

    const failedSteps = steps.filter((step) => step.conclusion === 'failure');
    const nonSuccessSteps = steps.filter(
      (step) => step.conclusion && !['success', 'skipped'].includes(step.conclusion)
    );

    debug('Failure analysis for job:', {
      job: job.name,
      jobConclusion: job.conclusion,
      failedStepNames: failedSteps.map((s) => s.name),
      nonSuccessStepNames: nonSuccessSteps.map((s) => ({
        name: s.name,
        conclusion: s.conclusion
      }))
    });

    if (failedSteps.length > 0) {
      for (const step of failedSteps) {
        failures.push({
          type: 'step',
          job: job.name,
          step: step.name,
          jobId: job.databaseId
        });
      }
      continue;
    }

    if (job.conclusion === 'failure') {
      failures.push({
        type: 'job',
        job: job.name,
        step: 'Job failure',
        jobId: job.databaseId
      });
    }
  }

  debug('Detected failures:', failures);

  return failures;
}

function getFailureLogs(runId, failures) {
  const uniqueJobIds = [...new Set(failures.map((f) => f.jobId))];
  let logs = '';

  debug('Fetching logs for failing job IDs:', uniqueJobIds);

  for (const jobId of uniqueJobIds) {
    const failure = failures.find((f) => f.jobId === jobId);

    try {
      debug('Fetching logs for job:', {
        jobId,
        jobName: failure?.job
      });

      const jobLogs = runGh(['run', 'view', String(runId), '--job', String(jobId), '--log']);

      logs += `\n\n===== JOB: ${failure?.job ?? jobId} =====\n\n`;
      logs += jobLogs;

      debug('Fetched log length:', jobLogs.length);
    } catch {
      debug('Could not fetch logs for job:', {
        jobId,
        jobName: failure?.job
      });
    }
  }

  return logs;
}

function extractRelevantLogs(logs) {
  if (!logs) {
    debug('No logs available to extract relevant lines from');
    return [];
  }

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

  debug('Relevant log anchor index:', idx);

  if (idx === -1) {
    const tail = lines.slice(-40);
    debug('No anchor found, returning tail lines:', tail.length);
    return tail;
  }

  const start = Math.max(0, idx - 25);
  const end = Math.min(lines.length, idx + 25);
  const snippet = lines.slice(start, end);

  debug('Returning contextual snippet lines:', {
    start,
    end,
    count: snippet.length
  });

  return snippet;
}

function buildPrompt({ prNumber, title, files, diff, failures, reviewComments, logs }) {
  const relevantLogs = extractRelevantLogs(logs);

  debug('Prompt assembly stats:', {
    failures: failures.length,
    reviewComments: reviewComments.length,
    files: files.length,
    diffLength: diff.length,
    relevantLogLines: relevantLogs.length
  });

  let md = `
# Pull Request Agent Task

Pull Request: #${prNumber}
Title: ${title}

Resolve CI failures and address review feedback.

---

# Changed Files
`;

  if (files.length) {
    for (const f of files) {
      md += `• ${f}\n`;
    }
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
Failure Type: ${f.type}
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
    } else {
      md += `
Relevant CI Log Snippet

(No relevant CI log lines were detected.)
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

  if (!failures.length && !reviewComments.length) {
    md += `
No CI failures or review feedback were detected.

Verify the PR implementation and confirm everything is correct.
`;
  }

  md += `
# Pull Request Diff

\`\`\`diff
${diff}
\`\`\`

---

# Instructions for the Agent

1. Fix CI failures first
2. Address reviewer feedback
3. Modify only relevant files
4. Preserve existing project conventions
5. Ensure the pipeline passes

---

# Final Step

Generate the Conventional Commit message for the changes.
`;

  return md.trim() + '\n';
}

function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--debug');
  const prNumber = args[0];

  if (!prNumber) {
    console.error('Usage: npm run pr:agent <PR_NUMBER> [--debug]');
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
    } else {
      debug('No failures detected, skipping failure log fetch');
    }
  } else {
    debug('No CI workflow run found for this PR commit');
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
