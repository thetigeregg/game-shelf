import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUTPUT_FILE = '.pr-agent-prompt.md';

const DEBUG = process.env.DEBUG_PR_AGENT === '1' || process.argv.includes('--debug');

function debug(...args) {
  if (DEBUG) console.log('[debug]', ...args);
}

function runGh(args) {
  debug('gh', args.join(' '));

  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 50
    });
  } catch (err) {
    console.error('GitHub CLI command failed:', args.join(' '));
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    process.exit(err.status || 1);
  }
}

function getPRData(pr) {
  const data = JSON.parse(
    runGh(['pr', 'view', pr, '--json', 'title,headRefOid,files,comments,reviews,statusCheckRollup'])
  );

  return {
    title: data.title,
    sha: data.headRefOid,
    files: (data.files || []).map((f) => f.path),
    comments: data.comments || [],
    reviews: data.reviews || [],
    checks: data.statusCheckRollup || []
  };
}

function analyzeChecks(checks) {
  const ciFailures = [];
  const coverageFailures = [];
  const pending = [];

  for (const c of checks) {
    debug('Check:', {
      name: c.name,
      status: c.status,
      conclusion: c.conclusion
    });

    if (c.status !== 'COMPLETED') {
      pending.push(c.name);
      continue;
    }

    if (c.conclusion === 'FAILURE') {
      if (c.name.startsWith('codecov')) {
        coverageFailures.push(c.name);
      } else {
        ciFailures.push(c.name);
      }
    }
  }

  return { ciFailures, coverageFailures, pending };
}

function findWorkflowRun(sha) {
  const runs = JSON.parse(
    runGh([
      'run',
      'list',
      '--commit',
      sha,
      '--json',
      'databaseId,workflowName,status,conclusion,createdAt',
      '--limit',
      '20'
    ])
  );

  const ciRuns = runs
    .filter((r) => r.workflowName === 'CI PR Checks')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const selected = ciRuns[0];

  debug('Selected workflow run:', selected);

  return selected ? selected.databaseId : null;
}

function findFailedJobs(runId) {
  const data = JSON.parse(runGh(['run', 'view', runId, '--json', 'jobs']));

  const failures = [];

  for (const job of data.jobs || []) {
    if (!job.steps) continue;

    for (const step of job.steps) {
      if (step.conclusion === 'failure') {
        failures.push({
          job: job.name,
          step: step.name,
          id: job.databaseId
        });
      }
    }
  }

  return failures;
}

function getFailureLogs(runId, jobs) {
  let logs = '';

  for (const j of jobs) {
    try {
      debug('Fetching logs for job:', j.job);

      const jobLogs = runGh(['run', 'view', runId, '--job', j.id, '--log']);

      logs += `\n\n===== ${j.job} / ${j.step} =====\n\n`;
      logs += jobLogs;
    } catch {
      debug('Failed to fetch logs for job:', j.job);
    }
  }

  return logs;
}

function extractRelevantLogs(logs) {
  if (!logs) return [];

  const lines = logs.split('\n');

  const errorIndex = lines.findIndex(
    (l) => l.includes('FAIL') || l.includes('Error:') || l.includes('Test Suites:')
  );

  if (errorIndex === -1) return lines.slice(-40);

  return lines.slice(Math.max(0, errorIndex - 25), errorIndex + 25);
}

function filterReviewComments(comments, reviews) {
  const results = [];

  function include(body, author) {
    if (!body) return false;

    const b = body.toLowerCase();

    if (author?.includes('copilot')) return false;
    if (author?.includes('github-actions')) return false;
    if (author?.includes('codecov')) return false;

    if (b.includes('low confidence')) return false;
    if (b.includes('<details>')) return false;

    return true;
  }

  for (const c of comments) {
    if (include(c.body, c.author?.login)) {
      results.push({
        author: c.author?.login,
        body: c.body,
        file: c.path,
        line: c.line
      });
    }
  }

  for (const r of reviews) {
    if (include(r.body, r.author?.login)) {
      results.push({
        author: r.author?.login,
        body: r.body
      });
    }
  }

  return results;
}

function getInlineReviewComments(repo, pr) {
  try {
    const data = JSON.parse(runGh(['api', `repos/${repo}/pulls/${pr}/comments`]));

    return data.map((c) => ({
      author: c.user?.login,
      file: c.path,
      line: c.line || c.original_line,
      body: c.body
    }));
  } catch {
    return [];
  }
}

function getDiff(pr) {
  try {
    return runGh(['pr', 'diff', pr]);
  } catch {
    return '';
  }
}

function buildPrompt(data) {
  const relevantLogs = extractRelevantLogs(data.logs);

  let md = `
# Pull Request Agent Task

PR: #${data.pr}
Title: ${data.title}

Resolve CI failures, coverage regressions, and review feedback.

---

# Changed Files
`;

  for (const f of data.files) md += `• ${f}\n`;

  md += '\n---\n';

  if (data.ciFailures.length) {
    md += `# CI Failures\n\n`;

    for (const f of data.ciFailures) md += `• ${f}\n`;

    if (relevantLogs.length) {
      md += `\n\`\`\`\n${relevantLogs.join('\n')}\n\`\`\`\n`;
    }

    md += '\n---\n';
  }

  if (data.coverageFailures.length) {
    md += `# Coverage Failures\n\n`;

    for (const c of data.coverageFailures) md += `• ${c}\n`;

    md += '\n---\n';
  }

  if (data.pending.length) {
    md += `# Pending Checks\n\n`;

    for (const p of data.pending) md += `• ${p}\n`;

    md += '\n---\n';
  }

  if (data.reviews.length) {
    md += `# Review Feedback\n`;

    for (const r of data.reviews) {
      md += `
Reviewer: ${r.author || 'reviewer'}

${r.body}
`;
    }

    md += '\n---\n';
  }

  md += `
# Pull Request Diff

\`\`\`diff
${data.diff}
\`\`\`

---

# Instructions for the Agent

1. Fix CI failures first.
2. Address coverage regressions.
3. Address reviewer feedback.
4. Ensure all checks pass.
5. Preserve existing project conventions.

Generate a Conventional Commit message for any changes.
`;

  return md.trim() + '\n';
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--debug');
  const pr = args[0];

  if (!pr) {
    console.error('Usage: npm run pr:agent <PR>');
    process.exit(1);
  }

  console.log(`Generating agent prompt for PR #${pr}`);

  const prData = getPRData(pr);

  const repo = JSON.parse(runGh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;

  const discussionComments = filterReviewComments(prData.comments, prData.reviews);

  const inlineComments = getInlineReviewComments(repo, pr);

  const reviews = [...discussionComments, ...inlineComments];

  const { ciFailures, coverageFailures, pending } = analyzeChecks(prData.checks);

  let logs = '';

  if (ciFailures.length) {
    const runId = findWorkflowRun(prData.sha);

    if (runId) {
      const jobs = findFailedJobs(runId);

      logs = getFailureLogs(runId, jobs);
    }
  }

  const diff = getDiff(pr);

  const prompt = buildPrompt({
    pr,
    title: prData.title,
    files: prData.files,
    diff,
    ciFailures,
    coverageFailures,
    pending,
    reviews,
    logs
  });

  fs.writeFileSync(OUTPUT_FILE, prompt);

  console.log(`
Agent prompt generated:

${OUTPUT_FILE}

CI failures: ${ciFailures.length}
Coverage failures: ${coverageFailures.length}
Pending checks: ${pending.length}
Review comments: ${reviews.length}
Files changed: ${prData.files.length}
`);
}

main();
