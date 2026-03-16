import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUTPUT_FILE = '.pr-agent-prompt.md';

const DEBUG = process.env.DEBUG_PR_AGENT === '1' || process.argv.includes('--debug');

function debug(...args) {
  if (DEBUG) console.log('[debug]', ...args);
}

function runGh(args) {
  debug('gh', args.join(' '));
  return execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50
  });
}

function getPRData(pr) {
  const data = JSON.parse(
    runGh(['pr', 'view', pr, '--json', 'title,headRefOid,files,comments,reviews,statusCheckRollup'])
  );

  const files = (data.files || []).map((f) => f.path);

  return {
    title: data.title,
    sha: data.headRefOid,
    files,
    comments: data.comments || [],
    reviews: data.reviews || [],
    checks: data.statusCheckRollup || []
  };
}

function getInlineReviewComments(ownerRepo, pr) {
  try {
    const data = JSON.parse(runGh(['api', `repos/${ownerRepo}/pulls/${pr}/comments`]));

    const results = [];

    for (const c of data) {
      const body = c.body?.trim();
      const author = c.user?.login;

      if (!body) continue;

      const b = body.toLowerCase();

      if (author?.includes('copilot')) continue;
      if (author?.includes('codecov')) continue;
      if (author?.includes('github-actions')) continue;

      if (b.includes('low confidence')) continue;
      if (b.includes('comments suppressed')) continue;
      if (b.includes('<details>')) continue;

      results.push({
        author,
        file: c.path,
        line: c.line || c.original_line,
        body
      });
    }

    debug('Inline review comments:', results.length);

    return results;
  } catch (e) {
    debug('Inline review fetch failed');
    return [];
  }
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
    if (b.includes('comments suppressed')) return false;
    if (b.includes('<details>')) return false;

    return true;
  }

  for (const c of comments) {
    if (include(c.body, c.author?.login)) {
      results.push({
        author: c.author?.login,
        body: c.body,
        file: c.path || '',
        line: c.line || ''
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

  const ciRun = runs.find((r) => r.workflowName === 'CI PR Checks');

  if (!ciRun) return null;

  debug('Selected workflow run:', ciRun);

  return ciRun.databaseId;
}

function findFailedJobs(runId) {
  const data = JSON.parse(runGh(['run', 'view', runId, '--json', 'jobs']));

  const failures = [];

  for (const job of data.jobs || []) {
    if (job.conclusion === 'failure') {
      failures.push({
        job: job.name,
        id: job.databaseId
      });
    }
  }

  return failures;
}

function getFailureLogs(runId, jobs) {
  let logs = '';

  for (const j of jobs) {
    try {
      debug('Fetching logs for job:', j.job);

      const l = runGh(['run', 'view', runId, '--job', j.id, '--log']);

      logs += `\n\n===== ${j.job} =====\n\n`;
      logs += l;
    } catch {}
  }

  return logs;
}

function extractRelevantLogs(logs) {
  if (!logs) return [];

  const lines = logs.split('\n');

  const idx = lines.findIndex(
    (l) => l.includes('FAIL') || l.includes('Error:') || l.includes('Test Suites:')
  );

  if (idx === -1) return lines.slice(-40);

  return lines.slice(Math.max(0, idx - 25), idx + 25);
}

function getCodecovCoverageRegression(ownerRepo, sha) {
  try {
    const data = JSON.parse(runGh(['api', `repos/${ownerRepo}/commits/${sha}/check-runs`]));

    const codecov = data.check_runs?.find((r) => r.name?.startsWith('codecov'));

    if (!codecov?.output?.summary) return [];

    const summary = codecov.output.summary;
    const lines = summary.split('\n');

    const regressions = [];

    for (const line of lines) {
      const match = line.match(/`(.+?)`\s*\|\s*-([\d.]+)%/);

      if (match) {
        regressions.push({
          file: match[1],
          drop: match[2]
        });
      }
    }

    return regressions;
  } catch (e) {
    debug('Codecov regression parse failed');
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
  const {
    pr,
    title,
    files,
    diff,
    ciFailures,
    coverageFailures,
    pending,
    reviews,
    logs,
    coverageRegression
  } = data;

  const relevantLogs = extractRelevantLogs(logs);

  let md = `
# Pull Request Agent Task

PR: #${pr}
Title: ${title}

Resolve CI failures, coverage regressions, and review feedback.

---

# Changed Files
`;

  for (const f of files) md += `• ${f}\n`;

  md += '\n---\n';

  if (ciFailures.length) {
    md += `# CI Failures\n\n`;

    for (const f of ciFailures) md += `• ${f}\n`;

    if (relevantLogs.length) {
      md += `\n\`\`\`\n${relevantLogs.join('\n')}\n\`\`\`\n`;
    }

    md += '\n---\n';
  }

  if (coverageFailures.length) {
    md += `# Coverage Failures\n\n`;

    for (const c of coverageFailures) md += `• ${c}\n`;

    md += '\n---\n';
  }

  if (coverageRegression.length) {
    md += `# Coverage Regression\n\n`;

    for (const r of coverageRegression) {
      md += `• ${r.file}  (-${r.drop}%)\n`;
    }

    md += `
Add tests covering the new or modified logic in these files.

---
`;
  }

  if (pending.length) {
    md += `# Pending Checks\n\n`;

    for (const p of pending) md += `• ${p}\n`;

    md += '\n---\n';
  }

  if (reviews.length) {
    md += `# Review Feedback\n`;

    for (const r of reviews) {
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
${diff}
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

  const repo = JSON.parse(runGh(['repo', 'view', '--json', 'nameWithOwner']));

  const discussionComments = filterReviewComments(prData.comments, prData.reviews);

  const inlineComments = getInlineReviewComments(repo.nameWithOwner, pr);

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

  let coverageRegression = [];

  if (coverageFailures.length) {
    try {
      const repo = JSON.parse(runGh(['repo', 'view', '--json', 'nameWithOwner']));

      coverageRegression = getCodecovCoverageRegression(repo.nameWithOwner, prData.sha);
    } catch {}
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
    logs,
    coverageRegression
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
