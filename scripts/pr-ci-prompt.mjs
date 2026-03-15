import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUTPUT_FILE = '.pr-ci-prompt.md';
const WORKFLOW_NAME = 'CI PR Checks';
const DEBUG = true;

function log(...args) {
  if (DEBUG) console.log('[debug]', ...args);
}

function runGh(args) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 50
    });
  } catch (err) {
    console.error('GitHub CLI command failed:', args.join(' '));
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    process.exit(1);
  }
}

function getPRInfo(prNumber) {
  const result = runGh(['pr', 'view', prNumber, '--json', 'title,headRefOid']);

  const parsed = JSON.parse(result);
  log('PR info:', parsed);
  return parsed;
}

function getLatestCIRun(commitSha) {
  const result = runGh([
    'run',
    'list',
    '--commit',
    commitSha,
    '--json',
    'databaseId,workflowName,status,conclusion',
    '--limit',
    '20'
  ]);

  const runs = JSON.parse(result);

  log('Workflow runs:', runs);

  const ciRun = runs.find((r) => r.workflowName === WORKFLOW_NAME);

  if (!ciRun) {
    throw new Error(`Could not find workflow run named "${WORKFLOW_NAME}"`);
  }

  return ciRun;
}

function getJobs(runId) {
  const result = runGh(['run', 'view', runId, '--json', 'jobs']);

  const parsed = JSON.parse(result);

  if (!parsed || !Array.isArray(parsed.jobs)) {
    log('Jobs missing or invalid');
    return [];
  }

  log(`Jobs found: ${parsed.jobs.length}`);

  for (const job of parsed.jobs) {
    log('Job:', job.name, job.status, job.conclusion);

    if (job.steps) {
      for (const step of job.steps) {
        log('  Step:', step.name, 'status:', step.status, 'conclusion:', step.conclusion);
      }
    }
  }

  return parsed.jobs;
}

function findFailures(jobs) {
  const failures = [];

  for (const job of jobs) {
    if (job.conclusion === 'failure') {
      failures.push({
        job: job.name,
        step: 'Job failure'
      });
    }

    if (job.steps) {
      for (const step of job.steps) {
        if (step.conclusion === 'failure') {
          failures.push({
            job: job.name,
            step: step.name
          });
        }
      }
    }
  }

  log('Failures detected:', failures);

  return failures;
}

function getLogsForJobs(runId, jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    log('No jobs available for log extraction');
    return '';
  }

  let logs = '';

  for (const job of jobs) {
    if (!job || job.status !== 'completed') {
      log('Skipping job (not completed):', job?.name);
      continue;
    }

    log('Fetching logs for job:', job.name);

    try {
      const jobLogs = runGh(['run', 'view', runId, '--job', job.databaseId, '--log']);

      logs += `\n\n===== JOB: ${job.name} =====\n\n`;
      logs += jobLogs;
    } catch {
      log('Logs unavailable for job:', job.name);
    }
  }

  return logs;
}

function extractRelevantLogs(logs) {
  const lines = logs.split('\n');
  const relevant = [];

  for (const line of lines) {
    if (
      line.includes('ERROR') ||
      line.includes('Error:') ||
      line.includes('FAIL') ||
      line.includes('failed') ||
      line.includes('TS') ||
      line.includes('eslint') ||
      line.includes('Coverage for') ||
      line.includes('does not meet')
    ) {
      relevant.push(line);
    }
  }

  log(`Relevant log lines found: ${relevant.length}`);

  return relevant.slice(0, 200);
}

function buildPrompt(prNumber, title, failures, logs) {
  const relevant = extractRelevantLogs(logs);

  let md = `
# CI Failure Fix Tasks

Pull Request: #${prNumber}
Title: ${title}

Resolve the CI failures described below.

Guidelines:

• Fix the root cause of the failures
• Do not suppress errors
• Preserve project conventions

---

`;

  if (!failures.length) {
    md += `
No explicit failing steps were detected.

However CI logs contain the following suspicious lines:

\`\`\`
${relevant.join('\n')}
\`\`\`

Investigate and resolve the underlying issue.
`;
  } else {
    let task = 1;

    for (const failure of failures) {
      md += `
## Task ${task}

Failing Job:
${failure.job}

Failing Step:
${failure.step}

Relevant Log Output:

\`\`\`
${relevant.join('\n')}
\`\`\`

Required Action:

Identify the root cause and fix the failure.

---

`;

      task++;
    }
  }

  md += `
# Final Step

After fixing the issues:

Generate the Conventional Commit message for the changes.
`;

  return md;
}

function main() {
  const prNumber = process.argv[2];

  if (!prNumber) {
    console.error('Usage: npm run pr:ci <PR_NUMBER>');
    process.exit(1);
  }

  console.log(`Preparing CI failure tasks for PR #${prNumber}`);

  const pr = getPRInfo(prNumber);

  const run = getLatestCIRun(pr.headRefOid);

  console.log(`Using workflow run: ${run.databaseId}`);

  const jobs = getJobs(run.databaseId);

  const failures = findFailures(jobs);

  const logs = getLogsForJobs(run.databaseId, jobs);

  const prompt = buildPrompt(prNumber, pr.title, failures, logs);

  fs.writeFileSync(OUTPUT_FILE, prompt);

  console.log(`
CI prompt generated:

${OUTPUT_FILE}

Failing steps detected: ${failures.length}
`);
}

main();
