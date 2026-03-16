#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_FILE = '.pr-agent-prompt.md';
const ARTIFACT_DIR = '.coverage-artifacts';
const CI_WORKFLOW_NAME = 'CI PR Checks';
const COVERAGE_ARTIFACT_NAME = 'coverage-reports';
const MAX_DIFF_CHARS = 120000;
const LOG_TERMS = [
  'does not meet',
  'Coverage for',
  'FAIL',
  'Error:',
  'Test Suites:',
  'AssertionError',
  'ERR!',
  'Unhandled',
  'Exception'
];

function parseArgs(argv) {
  const args = argv.slice(2);

  const options = {
    prNumber: null,
    debug: false,
    copilotOnly: false
  };

  for (const arg of args) {
    if (arg === '--debug') {
      options.debug = true;
    } else if (arg === '--copilot-only') {
      options.copilotOnly = true;
    } else if (!options.prNumber) {
      options.prNumber = arg;
    }
  }

  if (!options.prNumber) {
    console.error('Usage: npm run pr:agent <PR_NUMBER> [--copilot-only] [--debug]');
    process.exit(1);
  }

  return options;
}

const OPTIONS = parseArgs(process.argv);
const DEBUG = process.env.DEBUG_PR_AGENT === '1' || OPTIONS.debug;

function debug(...args) {
  if (DEBUG) console.log('[debug]', ...args);
}

function runGh(args, options = {}) {
  const { allowFailure = false } = options;

  debug('gh', args.join(' '));

  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 50
    });
  } catch (err) {
    const command = `gh ${args.join(' ')}`;

    if (allowFailure) {
      debug('Command failed (allowed):', command);
      if (err.stdout) debug('stdout:', err.stdout.toString());
      if (err.stderr) debug('stderr:', err.stderr.toString());
      return null;
    }

    console.error('GitHub CLI command failed:', command);

    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);

    process.exit(1);
  }
}

function getRepoInfo() {
  const result = JSON.parse(runGh(['repo', 'view', '--json', 'nameWithOwner']));
  const [owner, repo] = result.nameWithOwner.split('/');
  return { owner, repo };
}

function getPRData(prNumber) {
  const data = JSON.parse(
    runGh([
      'pr',
      'view',
      prNumber,
      '--json',
      'title,headRefOid,headRefName,files,comments,reviews,statusCheckRollup'
    ])
  );

  return {
    title: data.title,
    sha: data.headRefOid,
    headRefName: data.headRefName,
    files: (data.files || []).map((file) => file.path),
    comments: data.comments || [],
    reviews: data.reviews || [],
    checks: data.statusCheckRollup || []
  };
}

function analyzeChecks(checks) {
  const ciFailures = [];
  const coverageFailures = [];
  const pending = [];

  for (const check of checks) {
    const normalized = {
      name: check.name || check.context || 'Unnamed check',
      status: check.status || 'UNKNOWN',
      conclusion: check.conclusion || null,
      detailsUrl: check.detailsUrl || check.url || null,
      workflowName: check.workflowName || null,
      startedAt: check.startedAt || null,
      completedAt: check.completedAt || null,
      rawType: check.__typename || null
    };

    debug('Check:', normalized);

    if (normalized.status !== 'COMPLETED') {
      pending.push(normalized);
      continue;
    }

    if (normalized.conclusion === 'FAILURE') {
      if (/codecov|coverage/i.test(normalized.name)) {
        coverageFailures.push(normalized);
      } else {
        ciFailures.push(normalized);
      }
    }
  }

  return { ciFailures, coverageFailures, pending };
}

function isIgnoredAutomationAuthor(author) {
  const authorLogin = (author || '').toLowerCase();
  return authorLogin.includes('github-actions') || authorLogin.includes('codecov');
}

function getReviewStateLabel(state) {
  switch (state) {
    case 'APPROVED':
      return 'Approved';
    case 'CHANGES_REQUESTED':
      return 'Changes requested';
    case 'COMMENTED':
      return 'Commented';
    case 'DISMISSED':
      return 'Dismissed';
    case 'PENDING':
      return 'Pending';
    default:
      return null;
  }
}

function formatReviewBody(body, state) {
  if (body) return body;
  const stateLabel = getReviewStateLabel(state);
  return stateLabel ? `Review state: ${stateLabel}` : '';
}

function includeReviewItem(body, author, state) {
  const authorLogin = (author || '').toLowerCase();
  const formattedBody = formatReviewBody(body, state);
  const normalizedBody = formattedBody.toLowerCase();

  if (isIgnoredAutomationAuthor(authorLogin)) return false;
  if (!formattedBody) return false;

  if (
    authorLogin.includes('copilot') &&
    (normalizedBody.includes('pull request overview') ||
      normalizedBody.includes('reviewed') ||
      normalizedBody.includes('summary per file'))
  ) {
    return false;
  }

  return true;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function uniqueBy(items, makeKey) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = makeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function collectDiscussionReviewItems(comments, reviews) {
  const results = [];

  for (const comment of comments) {
    if (!includeReviewItem(comment.body, comment.author?.login)) continue;

    results.push({
      author: comment.author?.login || 'reviewer',
      body: normalizeText(comment.body),
      file: comment.path || null,
      line: comment.line || null,
      state: null,
      source: 'discussion'
    });
  }

  for (const review of reviews) {
    const body = formatReviewBody(review.body, review.state);
    if (!includeReviewItem(review.body, review.author?.login, review.state)) continue;

    results.push({
      author: review.author?.login || 'reviewer',
      body: normalizeText(body),
      file: null,
      line: null,
      state: review.state || null,
      source: 'review-summary'
    });
  }

  return uniqueBy(
    results,
    (item) =>
      `${item.author}|${item.file || ''}|${item.line || ''}|${item.state || ''}|${item.body}`
  );
}

function fetchReviewThreads(repoInfo, prNumber) {
  const warnings = [];
  const threads = [];
  let cursor = null;
  let hasNextPage = true;

  const query = `
query($owner:String!, $repo:String!, $pr:Int!, $cursor:String) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      reviewThreads(first:50, after:$cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          isResolved
          path
          line
          originalLine
          comments(last:50) {
            nodes {
              author { login }
              body
              diffHunk
            }
          }
        }
      }
    }
  }
}
`;

  while (hasNextPage) {
    const args = [
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-F',
      `owner=${repoInfo.owner}`,
      '-F',
      `repo=${repoInfo.repo}`,
      '-F',
      `pr=${prNumber}`
    ];

    if (cursor) args.push('-F', `cursor=${cursor}`);

    const result = runGh(args, { allowFailure: true });

    if (!result) {
      warnings.push(
        'Review threads were unavailable, so inline review feedback may be incomplete.'
      );
      return { threads: [], warnings };
    }

    const data = JSON.parse(result);
    const page = data?.data?.repository?.pullRequest?.reviewThreads;

    if (!page) {
      warnings.push(
        'Review threads were unavailable, so inline review feedback may be incomplete.'
      );
      return { threads: [], warnings };
    }

    threads.push(...(page.nodes || []));
    hasNextPage = Boolean(page.pageInfo?.hasNextPage);
    cursor = page.pageInfo?.endCursor || null;
  }

  return { threads, warnings };
}

function buildInlineReviewTasks(threads, { copilotOnly = false } = {}) {
  const tasks = [];

  for (const thread of threads) {
    if (thread.isResolved) continue;

    const comments = thread.comments?.nodes || [];
    if (!comments.length) continue;

    const reviewerComment = [...comments].reverse().find((comment) => {
      const author = comment.author?.login || '';
      if (!includeReviewItem(comment.body, author)) return false;
      if (!copilotOnly) return true;
      return author.toLowerCase().includes('copilot') || author.toLowerCase().includes('bot');
    });

    if (!reviewerComment) continue;

    tasks.push({
      file: thread.path || null,
      line: thread.line ?? thread.originalLine ?? null,
      author: reviewerComment.author?.login || 'reviewer',
      body: normalizeText(reviewerComment.body),
      diff: normalizeText(reviewerComment.diffHunk),
      source: 'inline-review'
    });
  }

  return uniqueBy(
    tasks,
    (item) => `${item.author}|${item.file || ''}|${item.line || ''}|${item.body}|${item.diff}`
  );
}

function groupReviewTasksByFile(tasks) {
  const map = new Map();

  for (const task of tasks) {
    const key = task.file || '(general)';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(task);
  }

  return map;
}

function getDiff(prNumber) {
  const diff = runGh(['pr', 'diff', prNumber], { allowFailure: true });

  if (!diff) {
    return {
      diff: '',
      warnings: [
        'Pull request diff was unavailable, so the generated prompt does not include diff context.'
      ]
    };
  }

  if (diff.length > MAX_DIFF_CHARS) {
    return {
      diff: diff.slice(0, MAX_DIFF_CHARS),
      warnings: [
        `Pull request diff was truncated to ${MAX_DIFF_CHARS} characters to keep the prompt manageable.`
      ]
    };
  }

  return { diff, warnings: [] };
}

function getLatestWorkflowRun(headRefName, workflowName) {
  const result = runGh([
    'run',
    'list',
    '--branch',
    headRefName,
    '--json',
    'databaseId,workflowName,event,headBranch,status,conclusion,createdAt,updatedAt',
    '--limit',
    '50'
  ]);

  const runs = JSON.parse(result);
  debug('Workflow runs found:', runs.length);

  return (
    runs.find(
      (run) =>
        run.workflowName === workflowName &&
        run.event === 'pull_request' &&
        run.headBranch === headRefName
    ) || null
  );
}

function getPullRequestRuns(headRefName) {
  const result = runGh([
    'run',
    'list',
    '--branch',
    headRefName,
    '--json',
    'databaseId,workflowName,event,headBranch,status,conclusion,createdAt,updatedAt',
    '--limit',
    '50'
  ]);

  const runs = JSON.parse(result);

  return runs.filter((run) => run.event === 'pull_request' && run.headBranch === headRefName);
}

function getJobs(runId) {
  const result = runGh(['run', 'view', String(runId), '--json', 'jobs'], { allowFailure: true });
  if (!result) return [];

  const parsed = JSON.parse(result);
  if (!parsed || !Array.isArray(parsed.jobs)) return [];

  return parsed.jobs;
}

function findFailedSteps(jobs) {
  const failures = [];

  for (const job of jobs) {
    if (!Array.isArray(job.steps)) continue;

    for (const step of job.steps) {
      if (step.conclusion !== 'failure') continue;

      failures.push({
        job: job.name || 'Unnamed job',
        step: step.name || 'Unnamed step',
        jobId: job.databaseId
      });
    }
  }

  return failures;
}

function getJobLog(runId, jobId) {
  return runGh(['run', 'view', String(runId), '--job', String(jobId), '--log'], {
    allowFailure: true
  });
}

function extractRelevantLogLines(logs) {
  const lines = String(logs || '').split('\n');
  const errorIndex = lines.findIndex((line) => LOG_TERMS.some((term) => line.includes(term)));

  if (errorIndex === -1) return lines.slice(-40);

  const start = Math.max(0, errorIndex - 20);
  const end = Math.min(lines.length, errorIndex + 20);

  return lines.slice(start, end);
}

function collectCITasks(prData, checkAnalysis) {
  const warnings = [];
  const tasks = [];
  let run = null;

  try {
    run = getLatestWorkflowRun(prData.headRefName, CI_WORKFLOW_NAME);
  } catch (err) {
    warnings.push(`Unable to inspect CI workflow runs: ${err.message}`);
  }

  if (!run) {
    if (checkAnalysis.ciFailures.length) {
      warnings.push(
        `A failing CI status was detected, but no pull_request workflow run named "${CI_WORKFLOW_NAME}" was found for branch ${prData.headRefName}.`
      );
    }

    return { run: null, tasks: [], warnings };
  }

  const jobs = getJobs(run.databaseId);
  const failures = findFailedSteps(jobs);

  if (!failures.length && checkAnalysis.ciFailures.length) {
    warnings.push(
      'CI checks are failing, but no explicit failing steps were detected from workflow jobs. Falling back to check-level status only.'
    );
  }

  for (const failure of failures) {
    const rawLogs = getJobLog(run.databaseId, failure.jobId);
    const relevantLogs = extractRelevantLogLines(rawLogs || '').filter(Boolean);

    if (!rawLogs) {
      warnings.push(`Logs were unavailable for failing job "${failure.job}".`);
    }

    tasks.push({
      ...failure,
      relevantLogs,
      logAvailable: Boolean(rawLogs)
    });
  }

  return { run, tasks, warnings };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function downloadCoverageArtifact(runId) {
  ensureDir(ARTIFACT_DIR);

  const runArtifactDir = path.join(ARTIFACT_DIR, String(runId));
  fs.rmSync(runArtifactDir, { recursive: true, force: true });
  fs.mkdirSync(runArtifactDir, { recursive: true });

  const result = runGh(
    ['run', 'download', String(runId), '-n', COVERAGE_ARTIFACT_NAME, '-D', runArtifactDir],
    { allowFailure: true }
  );

  if (!result) {
    fs.rmSync(runArtifactDir, { recursive: true, force: true });
    return null;
  }

  return runArtifactDir;
}

function parseLcov(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  let currentFile = null;
  const uncovered = {};

  for (const line of content.split('\n')) {
    if (line.startsWith('SF:')) {
      currentFile = line.slice(3);
      continue;
    }

    if (!line.startsWith('DA:')) continue;
    if (!currentFile) continue;

    const [lineNumber, hits] = line.slice(3).split(',');

    if (Number(hits) !== 0) continue;

    if (!uncovered[currentFile]) uncovered[currentFile] = [];
    uncovered[currentFile].push(Number(lineNumber));
  }

  return uncovered;
}

function collectLcovFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectLcovFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.info')) {
      files.push(fullPath);
    }
  }

  return files;
}

function collectCoverage(artifactDir) {
  const uncovered = {};
  const lcovFiles = collectLcovFiles(artifactDir);

  for (const filePath of lcovFiles) {
    const parsed = parseLcov(filePath);

    for (const coveredFile of Object.keys(parsed)) {
      if (!uncovered[coveredFile]) uncovered[coveredFile] = [];
      uncovered[coveredFile].push(...parsed[coveredFile]);
    }
  }

  return uncovered;
}

function dedupeAndSortNumbers(values) {
  return [...new Set(values.map((value) => Number(value)).filter(Number.isFinite))].sort(
    (a, b) => a - b
  );
}

function intersectCoverageWithPRFiles(uncovered, prFiles) {
  const tasks = {};

  for (const coverageFile of Object.keys(uncovered)) {
    const match = prFiles.find((prFile) => coverageFile.endsWith(prFile));
    if (!match) continue;

    tasks[match] = dedupeAndSortNumbers([...(tasks[match] || []), ...uncovered[coverageFile]]);
  }

  return tasks;
}

function extractSnippet(filePath, lines) {
  if (!fs.existsSync(filePath)) return '';
  if (!lines.length) return '';

  const content = fs.readFileSync(filePath, 'utf8').split('\n');
  const start = Math.max(Math.min(...lines) - 3, 0);
  const end = Math.min(Math.max(...lines) + 3, content.length);

  return content.slice(start, end).join('\n').trim();
}

function collectCoverageTasks(prData, preferredRunId = null) {
  const warnings = [];
  const candidateRuns = [];
  const seen = new Set();

  if (preferredRunId) {
    candidateRuns.push({ databaseId: preferredRunId, workflowName: CI_WORKFLOW_NAME });
    seen.add(String(preferredRunId));
  }

  for (const run of getPullRequestRuns(prData.headRefName)) {
    const id = String(run.databaseId);
    if (seen.has(id)) continue;
    seen.add(id);
    candidateRuns.push(run);
  }

  let artifactDir = null;
  let artifactRun = null;

  for (const run of candidateRuns) {
    artifactDir = downloadCoverageArtifact(run.databaseId);
    if (!artifactDir) continue;
    artifactRun = run;
    break;
  }

  if (!artifactDir) {
    return {
      run: null,
      tasks: [],
      warnings: [
        'Coverage artifacts were unavailable, so uncovered line tasks could not be generated.'
      ]
    };
  }

  const uncovered = collectCoverage(artifactDir);
  const intersected = intersectCoverageWithPRFiles(uncovered, prData.files);

  const tasks = Object.keys(intersected).map((filePath) => ({
    file: filePath,
    lines: intersected[filePath],
    snippet: extractSnippet(filePath, intersected[filePath])
  }));

  if (!tasks.length) {
    warnings.push(
      'Coverage artifacts were downloaded, but no uncovered lines matched the files modified in this PR.'
    );
  }

  return { run: artifactRun, tasks, warnings };
}

function bulletList(items) {
  return items.map((item) => `• ${item}`).join('\n');
}

function formatCheckSummary(check) {
  const suffix = check.detailsUrl ? ` (${check.detailsUrl})` : '';
  return `${check.name}${suffix}`;
}

function buildPrompt(data) {
  const sections = [];

  sections.push(`# Pull Request Agent Task\n\nPR: #${data.pr}\nTitle: ${data.title}`);

  sections.push(
    [
      '# Execution Order',
      '1. Fix CI failures first.',
      '2. Add or update tests for uncovered changed code.',
      '3. Address unresolved review feedback.',
      '4. Re-run validation before preparing the final commit message.'
    ].join('\n')
  );

  if (data.warnings.length) {
    sections.push(`# Prompt Warnings\n\n${bulletList(data.warnings)}`);
  }

  sections.push(
    `# Changed Files\n\n${bulletList(data.files.length ? data.files : ['No changed files reported'])}`
  );

  if (data.ci.tasks.length || data.checks.ciFailures.length) {
    let md = '# CI Failure Tasks\n';

    if (data.ci.run?.databaseId) {
      md += `\nWorkflow run: ${data.ci.run.databaseId}`;
      if (data.ci.run.workflowName) md += ` (${data.ci.run.workflowName})`;
      md += '\n';
    }

    if (data.ci.tasks.length) {
      let taskNumber = 1;

      for (const task of data.ci.tasks) {
        md += `
## Task ${taskNumber}

Failing job:
${task.job}

Failing step:
${task.step}

Relevant log output:

\`\`\`
${task.relevantLogs.join('\n') || 'Logs unavailable.'}
\`\`\`

Required action:
Fix the root cause so this CI failure passes without suppressing the check.
`;
        taskNumber += 1;
      }
    } else {
      md += `

No failing workflow steps were extracted, but these CI checks are failing:

${bulletList(data.checks.ciFailures.map(formatCheckSummary))}
`;
    }

    sections.push(md.trim());
  }

  if (data.coverage.tasks.length || data.checks.coverageFailures.length) {
    let md =
      '# Coverage Tasks\n\nPrefer writing or expanding tests instead of changing production logic.';

    if (data.coverage.run?.databaseId) {
      md += `\n\nCoverage artifact source run: ${data.coverage.run.databaseId}`;
      if (data.coverage.run.workflowName) md += ` (${data.coverage.run.workflowName})`;
    }

    if (data.coverage.tasks.length) {
      let taskNumber = 1;

      for (const task of data.coverage.tasks) {
        md += `
## Coverage Task ${taskNumber}

File:
${task.file}

Uncovered lines:
${task.lines.join(', ')}

Relevant code:

\`\`\`ts
${task.snippet || '// Source file unavailable locally for snippet extraction.'}
\`\`\`

Required action:
Add or update tests that execute these uncovered paths, including conditional and error branches where relevant.
`;
        taskNumber += 1;
      }
    } else if (data.checks.coverageFailures.length) {
      md += `

Coverage-related checks are failing:

${bulletList(data.checks.coverageFailures.map(formatCheckSummary))}
`;
    }

    sections.push(md.trim());
  }

  if (data.review.inlineByFile.size || data.review.general.length) {
    let md = '# Review Feedback Tasks\n';
    let taskNumber = 1;

    for (const [filePath, tasks] of data.review.inlineByFile.entries()) {
      md += `\n## File: ${filePath}\n`;

      for (const task of tasks) {
        md += `
### Task ${taskNumber}

Location: ${task.file || filePath}${task.line ? `:${task.line}` : ''}

Reviewer: ${task.author}

Issue:
${task.body}
`;

        if (task.diff) {
          md += `
Diff context:

\`\`\`diff
${task.diff}
\`\`\`
`;
        }

        md += `
Required action:
Resolve the feedback in the referenced code without unrelated refactors.
`;
        taskNumber += 1;
      }
    }

    if (data.review.general.length) {
      md += '\n## General discussion / review summary feedback\n';

      for (const note of data.review.general) {
        md += `
### Task ${taskNumber}

Reviewer: ${note.author}

Issue:
${note.body}

Required action:
Address this review feedback in the PR updates and ensure the conversation is resolved by the code changes.
`;
        taskNumber += 1;
      }
    }

    sections.push(md.trim());
  }

  if (data.checks.pending.length) {
    sections.push(
      `# Pending Checks\n\n${bulletList(data.checks.pending.map((check) => check.name))}`
    );
  }

  sections.push(
    [
      '# Final Validation',
      '',
      'Before finishing:',
      '',
      '• All CI checks must pass',
      '• Coverage regressions for changed code must be addressed',
      '• All unresolved review comments must be addressed',
      '• Frontend build must succeed',
      '• Linting must pass with no errors',
      '• Frontend tests must pass with no failures',
      '• Backend tests must pass with no failures',
      '',
      'Finally: generate the Conventional Commit message for the changes.'
    ].join('\n')
  );

  if (data.diff) {
    sections.push(`# Pull Request Diff\n\n\`\`\`diff\n${data.diff}\n\`\`\``);
  }

  return sections.join('\n\n---\n\n').trim() + '\n';
}

function main() {
  const prNumber = OPTIONS.prNumber;

  console.log(`Generating agent prompt for PR #${prNumber}`);

  const repoInfo = getRepoInfo();
  const prData = getPRData(prNumber);
  const warnings = [];

  const checkAnalysis = analyzeChecks(prData.checks);

  const discussionReviewItems = collectDiscussionReviewItems(prData.comments, prData.reviews);

  const reviewThreadData = fetchReviewThreads(repoInfo, Number(prNumber));
  warnings.push(...reviewThreadData.warnings);

  const inlineReviewTasks = buildInlineReviewTasks(reviewThreadData.threads, {
    copilotOnly: OPTIONS.copilotOnly
  });

  const ciData = collectCITasks(prData, checkAnalysis);
  warnings.push(...ciData.warnings);

  const coverageData = collectCoverageTasks(prData, ciData.run?.databaseId || null);
  warnings.push(...coverageData.warnings);

  const diffData = getDiff(prNumber);
  warnings.push(...diffData.warnings);

  const prompt = buildPrompt({
    pr: prNumber,
    title: prData.title,
    files: prData.files,
    diff: diffData.diff,
    warnings: uniqueBy(warnings, (warning) => warning),
    checks: checkAnalysis,
    ci: ciData,
    coverage: coverageData,
    review: {
      inline: inlineReviewTasks,
      inlineByFile: groupReviewTasksByFile(inlineReviewTasks),
      general: discussionReviewItems
    }
  });

  fs.writeFileSync(OUTPUT_FILE, prompt);

  console.log(`
Agent prompt generated: ${OUTPUT_FILE}

CI failure tasks: ${ciData.tasks.length}
Coverage tasks: ${coverageData.tasks.length}
Inline review tasks: ${inlineReviewTasks.length}
General review notes: ${discussionReviewItems.length}
Pending checks: ${checkAnalysis.pending.length}
Files changed: ${prData.files.length}
`);
}

main();
