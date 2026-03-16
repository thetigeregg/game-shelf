import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUTPUT_FILE = '.pr-agent-prompt.md';

const DEBUG = process.env.DEBUG_PR_AGENT === '1' || process.argv.includes('--debug');

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
    debug('Check:', c.name, c.status, c.conclusion);

    if (c.status !== 'COMPLETED') {
      pending.push(c.name);
      continue;
    }

    if (c.conclusion === 'FAILURE') {
      if (c.name.startsWith('codecov')) coverageFailures.push(c.name);
      else ciFailures.push(c.name);
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

/*
  IMPORTANT CHANGE

  Only filter true system bots.
  Copilot comments and suggestion blocks are valid review feedback.
*/

function includeReviewItem(body, author, state) {
  const authorLogin = (author || '').toLowerCase();
  const formattedBody = formatReviewBody(body, state);
  const b = formattedBody.toLowerCase();

  // Ignore automation
  if (isIgnoredAutomationAuthor(authorLogin)) return false;

  if (!formattedBody) return false;

  // Ignore Copilot PR summary posts
  if (
    authorLogin.includes('copilot') &&
    (b.includes('pull request overview') ||
      b.includes('reviewed') ||
      b.includes('summary per file'))
  ) {
    return false;
  }

  return true;
}

function filterReviewComments(comments, reviews) {
  const results = [];

  for (const c of comments) {
    if (includeReviewItem(c.body, c.author?.login)) {
      results.push({
        author: c.author?.login,
        body: c.body,
        file: c.path,
        line: c.line
      });
    }
  }

  for (const r of reviews) {
    const body = formatReviewBody(r.body, r.state);

    if (includeReviewItem(r.body, r.author?.login, r.state)) {
      results.push({
        author: r.author?.login,
        body,
        state: r.state
      });
    }
  }

  return results;
}

function getUnresolvedInlineReviewComments(repoInfo, pr) {
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
      `pr=${pr}`
    ];

    if (cursor) args.push('-F', `cursor=${cursor}`);

    const result = runGh(args, { allowFailure: true });

    if (!result) {
      warnings.push(
        'Review threads were unavailable, so inline review feedback may be incomplete.'
      );
      return { comments: [], warnings };
    }

    const data = JSON.parse(result);

    const page = data?.data?.repository?.pullRequest?.reviewThreads;

    if (!page) {
      warnings.push(
        'Review threads were unavailable, so inline review feedback may be incomplete.'
      );
      return { comments: [], warnings };
    }

    threads.push(...(page.nodes || []));

    hasNextPage = Boolean(page.pageInfo?.hasNextPage);
    cursor = page.pageInfo?.endCursor || null;
  }

  const unresolved = threads.filter((t) => !t.isResolved);

  debug('Unresolved threads:', unresolved.length);

  const results = [];

  for (const thread of unresolved) {
    const comments = thread.comments?.nodes || [];

    debug(
      'Thread comments:',
      comments.map((c) => c.author?.login)
    );

    const reviewerComment = [...comments]
      .reverse()
      .find((c) => includeReviewItem(c.body, c.author?.login));

    if (!reviewerComment) {
      debug('Filtered thread:', thread.path);
      continue;
    }

    results.push({
      author: reviewerComment.author?.login,
      file: thread.path,
      line: thread.line ?? thread.originalLine,
      body: reviewerComment.body
    });
  }

  debug('Collected review comments:', results.length);

  return { comments: results, warnings };
}

function getDiff(pr) {
  const diff = runGh(['pr', 'diff', pr], { allowFailure: true });

  if (!diff) {
    return {
      diff: '',
      warnings: [
        'Pull request diff was unavailable, so the generated prompt does not include diff context.'
      ]
    };
  }

  return { diff, warnings: [] };
}

function buildPrompt(data) {
  let md = `
# Pull Request Agent Task

PR: #${data.pr}
Title: ${data.title}

Resolve CI failures, coverage regressions, and review feedback.

---
`;

  if (data.warnings.length) {
    md += `
# Prompt Warnings

`;

    for (const warning of data.warnings)
      md += `• ${warning}
`;
  }

  md += `
# Changed Files
`;

  for (const f of data.files) md += `• ${f}\n`;

  if (data.ciFailures.length) {
    md += `\n# CI Failures\n\n`;

    for (const f of data.ciFailures) md += `• ${f}\n`;
  }

  if (data.coverageFailures.length) {
    md += `\n# Coverage Failures\n\n`;

    for (const c of data.coverageFailures) md += `• ${c}\n`;
  }

  if (data.pending.length) {
    md += `\n# Pending Checks\n\n`;

    for (const p of data.pending) md += `• ${p}\n`;
  }

  if (data.reviews.length) {
    md += `\n# Review Feedback\n`;

    for (const r of data.reviews) {
      md += `
Reviewer: ${r.author || 'reviewer'}

${r.file ? `File: ${r.file}${r.line ? `:${r.line}` : ''}\n` : ''}

${r.body}
`;
    }
  }

  md += `
# Pull Request Diff

\`\`\`diff
${data.diff}
\`\`\`
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

  const repoInfo = getRepoInfo();

  const prData = getPRData(pr);
  const warnings = [];

  const discussionComments = filterReviewComments(prData.comments, prData.reviews);

  const inlineReviewData = getUnresolvedInlineReviewComments(repoInfo, pr);
  warnings.push(...inlineReviewData.warnings);

  const reviews = [...discussionComments, ...inlineReviewData.comments];

  const { ciFailures, coverageFailures, pending } = analyzeChecks(prData.checks);

  const diffData = getDiff(pr);
  warnings.push(...diffData.warnings);

  for (const warning of warnings) {
    console.warn('Warning:', warning);
  }

  const prompt = buildPrompt({
    pr,
    title: prData.title,
    files: prData.files,
    diff: diffData.diff,
    ciFailures,
    coverageFailures,
    pending,
    reviews,
    warnings
  });

  fs.writeFileSync(OUTPUT_FILE, prompt);

  console.log(`
Agent prompt generated: ${OUTPUT_FILE}

CI failures: ${ciFailures.length}
Coverage failures: ${coverageFailures.length}
Pending checks: ${pending.length}
Review comments: ${reviews.length}
Files changed: ${prData.files.length}
`);
}

main();
