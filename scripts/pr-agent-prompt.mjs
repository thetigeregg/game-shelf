#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUTPUT_FILE = '.pr-agent-prompt.md';
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
  'Exception',
];
const NORMALIZED_LOG_TERMS = LOG_TERMS.map((term) => term.toLowerCase());

function parseArgs(argv) {
  const args = argv.slice(2);

  const options = {
    prNumber: null,
    debug: false,
    copilotOnly: false,
    includeCoverage: false,
  };

  for (const arg of args) {
    if (arg === '--debug') {
      options.debug = true;
    } else if (arg === '--copilot-only') {
      options.copilotOnly = true;
    } else if (arg === '--include-coverage') {
      options.includeCoverage = true;
    } else if (!options.prNumber) {
      options.prNumber = arg;
    }
  }

  if (!options.prNumber) {
    console.error(
      'Usage: npm run pr:agent <PR_NUMBER> [--copilot-only] [--include-coverage] [--debug]'
    );
    process.exit(1);
  }

  return options;
}

const OPTIONS = parseArgs(process.argv);
const DEBUG = process.env.DEBUG_PR_AGENT === '1' || OPTIONS.debug;

function debug(...args) {
  if (DEBUG) console.log('[debug]', ...args);
}

function isActionableThread(thread) {
  if (!thread) return false;

  // ❌ Drop resolved
  if (thread.isResolved) return false;

  // ✅ If not outdated, keep without scanning comments
  if (!thread.isOutdated) return true;

  const comments = (thread.comments?.nodes || []).filter(Boolean);

  const hasAutomatedSecurityThread = comments.some((c) => {
    const author = c.author?.login?.toLowerCase() || '';
    return author.includes('github-advanced-security') || author.includes('github-code-scanning');
  });

  // ❌ Drop ONLY outdated security bot threads (GHAS & Code Scanning)
  if (hasAutomatedSecurityThread) return false;

  // ✅ Keep everything else
  return true;
}

function runGh(args, options = {}) {
  const { allowFailure = false } = options;

  debug('gh', args.join(' '));

  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 50,
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

function maybeOpenInVSCode(filePath) {
  const commands = process.platform === 'win32' ? ['code.cmd', 'code.exe', 'code'] : ['code'];

  for (const command of commands) {
    const result = spawnSync(command, [filePath], {
      stdio: 'ignore',
    });

    if (!result.error && result.status === 0) {
      return;
    }

    if (result.error?.code === 'ENOENT') {
      continue;
    }

    const failureReason = result.error?.message || `exit code ${result.status}`;
    console.warn(`VS Code CLI launch failed for ${filePath}: ${failureReason}`);
    return;
  }

  console.log('VS Code CLI code not found; skipping auto-open');
}

function getRepoInfo() {
  const result = JSON.parse(runGh(['repo', 'view', '--json', 'nameWithOwner']));
  const [owner, repo] = result.nameWithOwner.split('/');
  return { owner, repo, nameWithOwner: result.nameWithOwner };
}

function normalizeStatusChecks(statusCheckRollup) {
  if (Array.isArray(statusCheckRollup)) return statusCheckRollup.filter(Boolean);

  if (!statusCheckRollup || typeof statusCheckRollup !== 'object') {
    return [];
  }

  const candidateCollections = [
    statusCheckRollup.contexts,
    statusCheckRollup.contexts?.nodes,
    statusCheckRollup.nodes,
    statusCheckRollup.edges,
    statusCheckRollup.contexts?.edges,
  ];

  for (const candidate of candidateCollections) {
    if (!Array.isArray(candidate)) continue;

    return candidate.map((item) => item?.node || item).filter(Boolean);
  }

  if ('status' in statusCheckRollup || 'conclusion' in statusCheckRollup) {
    return [statusCheckRollup];
  }

  return [];
}

function getPRData(prNumber) {
  const data = JSON.parse(
    runGh([
      'pr',
      'view',
      prNumber,
      '--json',
      'title,headRefOid,headRefName,files,comments,reviews,statusCheckRollup',
    ])
  );

  return {
    title: data.title,
    sha: data.headRefOid,
    headRefName: data.headRefName,
    files: (data.files || []).map((file) => file.path),
    comments: data.comments || [],
    reviews: data.reviews || [],
    checks: normalizeStatusChecks(data.statusCheckRollup),
  };
}

function analyzeChecks(checks) {
  const ciFailures = [];
  const coverageFailures = [];
  const pending = [];
  const successes = [];

  for (const check of checks) {
    const normalized = {
      name: check.name || check.context || 'Unnamed check',
      status: check.status || 'UNKNOWN',
      conclusion: check.conclusion || null,
      detailsUrl: check.detailsUrl || check.url || null,
      workflowName: check.workflowName || null,
      startedAt: check.startedAt || null,
      completedAt: check.completedAt || null,
      rawType: check.__typename || null,
    };

    debug('Check:', normalized);

    if (normalized.status !== 'COMPLETED') {
      pending.push(normalized);
      continue;
    }

    if (normalized.conclusion === 'SUCCESS') {
      successes.push(normalized);
      continue;
    }

    if (normalized.conclusion === 'FAILURE' || normalized.conclusion === 'TIMED_OUT') {
      if (/codecov|coverage/i.test(normalized.name)) {
        coverageFailures.push(normalized);
      } else {
        ciFailures.push(normalized);
      }
    }
  }

  return { ciFailures, coverageFailures, pending, successes };
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

function isActionableReviewState(state) {
  return state === 'CHANGES_REQUESTED';
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

function isCopilotReviewAuthor(author) {
  const normalizedAuthor = String(author || '').toLowerCase();
  return normalizedAuthor.includes('copilot') || normalizedAuthor.includes('bot');
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

function collectDiscussionReviewItems(comments, reviews, { copilotOnly = false } = {}) {
  const results = [];

  for (const comment of comments) {
    const author = comment.author?.login || 'reviewer';

    // Drop PR-level discussion comments that aren't tied to code
    if (comment.path == null && comment.line == null) continue;

    const normalizedBody = normalizeText(comment.body ?? '');
    if (!includeReviewItem(normalizedBody, author)) continue;
    if (copilotOnly && !isCopilotReviewAuthor(author)) continue;

    results.push({
      author,
      body: normalizedBody,
      file: comment.path,
      line: comment.line,
      state: null,
      source: 'discussion',
    });
  }

  for (const review of reviews) {
    const trimmedBody = review.body?.trim();

    // Only include reviews that require action
    if (!isActionableReviewState(review.state)) continue;

    const author = review.author?.login || 'reviewer';
    if (!includeReviewItem(trimmedBody, author, review.state)) continue;
    if (copilotOnly && !isCopilotReviewAuthor(author)) continue;

    const body = formatReviewBody(trimmedBody, review.state);

    results.push({
      author,
      body: normalizeText(body),
      file: null,
      line: null,
      state: review.state || null,
      source: 'review-summary',
    });
  }

  return uniqueBy(
    results,
    (item) =>
      `${item.author}|${item.file ?? ''}|${item.line ?? ''}|${item.state ?? ''}|${item.body}`
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
          isOutdated
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
      `pr=${prNumber}`,
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
    if (!isActionableThread(thread)) continue;

    const comments = thread.comments?.nodes || [];
    if (!comments.length) continue;

    const reviewerComment = [...comments].reverse().find((comment) => {
      const author = comment.author?.login || '';
      if (!includeReviewItem(comment.body, author)) return false;
      if (!copilotOnly) return true;

      const normalized = author.toLowerCase();
      return normalized.includes('copilot') || normalized.includes('bot');
    });

    if (!reviewerComment) continue;

    tasks.push({
      file: thread.path || null,
      line: thread.line ?? thread.originalLine ?? null,
      author: reviewerComment.author?.login || 'reviewer',
      body: normalizeText(reviewerComment.body),
      diff: normalizeText(reviewerComment.diffHunk),
      source: 'inline-review',
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
        'Pull request diff was unavailable, so the generated prompt does not include diff context.',
      ],
    };
  }

  if (diff.length > MAX_DIFF_CHARS) {
    return {
      diff: diff.slice(0, MAX_DIFF_CHARS),
      warnings: [
        `Pull request diff was truncated to ${MAX_DIFF_CHARS} characters to keep the prompt manageable.`,
      ],
    };
  }

  return { diff, warnings: [] };
}

function getLatestWorkflowRun(headRefName, workflowName, { allowFailure = false } = {}) {
  const result = runGh(
    [
      'run',
      'list',
      '--branch',
      headRefName,
      '--json',
      'databaseId,workflowName,event,headBranch,status,conclusion,createdAt,updatedAt',
      '--limit',
      '50',
    ],
    { allowFailure }
  );

  if (!result) {
    return {
      run: null,
      inspectionFailed: true,
    };
  }

  const runs = JSON.parse(result);
  debug('Workflow runs found:', runs.length);

  return {
    run:
      runs.find(
        (run) =>
          run.workflowName === workflowName &&
          run.event === 'pull_request' &&
          run.headBranch === headRefName
      ) || null,
    inspectionFailed: false,
  };
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
        jobId: job.databaseId,
      });
    }
  }

  return failures;
}

function getJobLog(runId, jobId) {
  return runGh(['run', 'view', String(runId), '--job', String(jobId), '--log'], {
    allowFailure: true,
  });
}

function extractRelevantLogLines(logs) {
  const lines = String(logs || '').split('\n');
  const errorIndex = lines.findIndex((line) => {
    const normalizedLine = line.toLowerCase();
    return NORMALIZED_LOG_TERMS.some((term) => normalizedLine.includes(term));
  });

  if (errorIndex === -1) return lines.slice(-40);

  const start = Math.max(0, errorIndex - 20);
  const end = Math.min(lines.length, errorIndex + 20);

  return lines.slice(start, end);
}

function collectCITasks(prData, checkAnalysis) {
  const warnings = [];
  const tasks = [];
  let run = null;

  const workflowRunData = getLatestWorkflowRun(prData.headRefName, CI_WORKFLOW_NAME, {
    allowFailure: true,
  });

  run = workflowRunData.run;

  if (workflowRunData.inspectionFailed) {
    warnings.push(
      `Unable to inspect CI workflow runs for branch ${prData.headRefName}; workflow-based CI details may be incomplete.`
    );
  }

  if (!run) {
    if (checkAnalysis.ciFailures.length && !workflowRunData.inspectionFailed) {
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
      logAvailable: Boolean(rawLogs),
    });
  }

  return { run, tasks, warnings };
}

function downloadCoverageArtifact(runId) {
  const runArtifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-agent-coverage-'));
  const debugLoggingEnabled =
    process.env.DEBUG_PR_AGENT === '1' || process.env.DEBUG === '1';
  if (debugLoggingEnabled) {
    console.log(`Downloading coverage artifact to ${runArtifactDir}...`);
  }

  const result = spawnSync(
    'gh',
    ['run', 'download', String(runId), '-n', COVERAGE_ARTIFACT_NAME, '-D', runArtifactDir],
    {
      stdio: 'inherit',
    }
  );

  if (result.status !== 0) {
    console.warn('Artifact download failed');
    fs.rmSync(runArtifactDir, { recursive: true, force: true });
    return null;
  }

  // 🔍 Debug what was extracted
  const contents = fs.readdirSync(runArtifactDir);
  if (debugLoggingEnabled) {
    console.log('Artifact dir contents after download:', contents);
  }

  // ✅ Handle nested extraction
  const extractedDir = path.join(runArtifactDir, COVERAGE_ARTIFACT_NAME);

  if (fs.existsSync(extractedDir)) {
    // Move contents of the nested directory up to the temp root so callers
    // can clean up a single directory (runArtifactDir) without leaking.
    for (const entry of fs.readdirSync(extractedDir)) {
      const from = path.join(extractedDir, entry);
      const to = path.join(runArtifactDir, entry);
      fs.renameSync(from, to);
    }

    // Remove the now-empty nested directory
    fs.rmSync(extractedDir, { recursive: true, force: true });
  }

  // Always return the temp root so cleanup removes the whole directory.
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

function collectCoverageTasks(
  prData,
  { preferredRunId = null, includeCoverage = false, hasCoverageFailures = false } = {}
) {
  if (!includeCoverage && !hasCoverageFailures) {
    return {
      run: null,
      tasks: [],
      warnings: [],
    };
  }

  if (!preferredRunId) {
    return {
      run: null,
      tasks: [],
      warnings: [
        `Coverage artifact inspection was skipped because no "${CI_WORKFLOW_NAME}" workflow run was identified for this PR.`,
      ],
    };
  }

  const artifactDir = downloadCoverageArtifact(preferredRunId);

  if (!artifactDir) {
    return {
      run: { databaseId: preferredRunId, workflowName: CI_WORKFLOW_NAME },
      tasks: [],
      warnings: [
        `Coverage artifact "${COVERAGE_ARTIFACT_NAME}" was not available on workflow run ${preferredRunId}.`,
      ],
    };
  }

  try {
    const uncovered = collectCoverage(artifactDir);
    const intersected = intersectCoverageWithPRFiles(uncovered, prData.files);

    const tasks = Object.keys(intersected).map((filePath) => ({
      file: filePath,
      lines: intersected[filePath],
      snippet: extractSnippet(filePath, intersected[filePath]),
    }));

    const warnings = [];

    if (!tasks.length) {
      warnings.push(
        'Coverage artifacts were downloaded, but no uncovered lines matched the files modified in this PR.'
      );
    }

    return {
      run: { databaseId: preferredRunId, workflowName: CI_WORKFLOW_NAME },
      tasks,
      warnings,
    };
  } finally {
    fs.rmSync(artifactDir, { recursive: true, force: true });
  }
}

function bulletList(items) {
  return items.map((item) => `• ${item}`).join('\n');
}

function formatCheckSummary(check) {
  const suffix = check.detailsUrl ? ` (${check.detailsUrl})` : '';
  return `${check.name}${suffix}`;
}

function buildCurrentStatus(data) {
  const ciStatus =
    data.checks.ciFailures.length > 0
      ? `FAIL (${data.checks.ciFailures.length} failing check${data.checks.ciFailures.length === 1 ? '' : 's'})`
      : data.checks.pending.length > 0
        ? `PENDING (${data.checks.pending.length} running or queued check${data.checks.pending.length === 1 ? '' : 's'})`
        : 'PASS';

  const coverageStatus =
    data.checks.coverageFailures.length > 0
      ? `FAIL (${data.checks.coverageFailures.length} failing coverage check${data.checks.coverageFailures.length === 1 ? '' : 's'})`
      : data.coverage.tasks.length > 0
        ? `ACTION NEEDED (${data.coverage.tasks.length} changed file${data.coverage.tasks.length === 1 ? '' : 's'} with uncovered lines)`
        : 'PASS';

  const reviewCount = data.review.inline.length + data.review.general.length;
  const reviewStatus =
    reviewCount > 0
      ? `ACTION NEEDED (${reviewCount} unresolved review item${reviewCount === 1 ? '' : 's'})`
      : 'PASS';

  let focus =
    'Everything currently looks green. Verify the latest state and avoid unnecessary changes.';

  if (data.checks.ciFailures.length > 0) {
    focus = 'Focus first on fixing failing CI checks and the underlying root causes.';
  } else if (data.coverage.tasks.length > 0 || data.checks.coverageFailures.length > 0) {
    focus = 'Focus on adding or updating tests for changed code with coverage gaps.';
  } else if (reviewCount > 0) {
    focus = 'Focus only on resolving the remaining review feedback.';
  } else if (data.checks.pending.length > 0) {
    focus = 'Wait for pending checks to finish before assuming the PR is complete.';
  }

  return [
    '# Current Status',
    '',
    `CI: ${ciStatus}`,
    `Coverage: ${coverageStatus}`,
    `Review feedback: ${reviewStatus}`,
    '',
    `Focus: ${focus}`,
  ].join('\n');
}

function buildPrompt(data) {
  const sections = [];

  sections.push(`# Pull Request Agent Task\n\nPR: #${data.pr}\nTitle: ${data.title}`);

  sections.push(buildCurrentStatus(data));

  sections.push(
    [
      '# Fix Strategy',
      '',
      'Work through the following priorities in order:',
      '',
      '1. Fix CI failures',
      '2. Fix failing tests',
      '3. Address uncovered code in changed files',
      '4. Resolve unresolved review comments',
      '5. Ensure linting and build succeed',
      '',
      'Always fix root causes rather than suppressing errors.',
      'Avoid unrelated refactors.',
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
      '# Definition of Done',
      '',
      'The pull request is complete only when all of the following are satisfied:',
      '',
      '• All CI checks pass',
      '• All review comments are addressed',
      '• Frontend build succeeds',
      '• Linting passes with no errors',
      '• Frontend tests pass with no failures',
      '• Backend tests pass with no failures',
      '• Coverage does not regress for modified code',
      '',
      'Before finishing, verify locally:',
      '',
      '```bash',
      'npm run lint',
      'npm run test',
      'npm run build',
      '```',
      '',
      'If the PR touches backend code, also verify locally:',
      '',
      '```bash',
      'npm run test:backend',
      'npm run test:backend:coverage',
      '```',
      '',
      'Finally: generate the Conventional Commit message for the changes.',
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

  const discussionReviewItems = collectDiscussionReviewItems(prData.comments, prData.reviews, {
    copilotOnly: OPTIONS.copilotOnly,
  });

  const reviewThreadData = fetchReviewThreads(repoInfo, Number(prNumber));
  warnings.push(...reviewThreadData.warnings);

  const inlineReviewTasks = buildInlineReviewTasks(reviewThreadData.threads, {
    copilotOnly: OPTIONS.copilotOnly,
  });

  const ciData = collectCITasks(prData, checkAnalysis);
  warnings.push(...ciData.warnings);

  const coverageData = collectCoverageTasks(prData, {
    preferredRunId: ciData.run?.databaseId || null,
    includeCoverage: OPTIONS.includeCoverage,
    hasCoverageFailures: checkAnalysis.coverageFailures.length > 0,
  });
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
      general: discussionReviewItems,
    },
  });

  fs.writeFileSync(OUTPUT_FILE, prompt);
  maybeOpenInVSCode(OUTPUT_FILE);

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
