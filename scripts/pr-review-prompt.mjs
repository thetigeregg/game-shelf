import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUTPUT_FILE = '.pr-review-prompt.md';

function runGh(args) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 20
    });
  } catch (err) {
    console.error('GitHub CLI command failed:', args.join(' '));
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    process.exit(1);
  }
}

function getRepoInfo() {
  const result = runGh(['repo', 'view', '--json', 'nameWithOwner']);
  const parsed = JSON.parse(result);
  const [owner, repo] = parsed.nameWithOwner.split('/');
  return { owner, repo };
}

function fetchReviewThreads(owner, repo, prNumber) {
  const threads = [];

  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
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
          comments(first:20) {
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

    const result = runGh([
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-F',
      `owner=${owner}`,
      '-F',
      `repo=${repo}`,
      '-F',
      `pr=${prNumber}`,
      '-F',
      `cursor=${cursor}`
    ]);

    const data = JSON.parse(result);

    const page = data.data.repository.pullRequest.reviewThreads;

    threads.push(...page.nodes);

    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return threads;
}

function filterThreads(threads, { copilotOnly }) {
  return threads.filter((t) => {
    if (t.isResolved) return false;

    const last = t.comments.nodes[t.comments.nodes.length - 1];
    if (!last) return false;

    const author = last.author?.login || '';

    if (copilotOnly) {
      return author.includes('copilot') || author.includes('bot');
    }

    return true;
  });
}

function groupByFile(threads) {
  const map = new Map();

  for (const t of threads) {
    const last = t.comments.nodes[t.comments.nodes.length - 1];

    const entry = {
      line: t.line ?? '?',
      reviewer: last.author?.login ?? 'unknown',
      comment: last.body,
      diff: last.diffHunk ?? ''
    };

    if (!map.has(t.path)) {
      map.set(t.path, []);
    }

    map.get(t.path).push(entry);
  }

  return map;
}

function buildPrompt(prNumber, grouped) {
  if (!grouped.size) {
    return `No unresolved PR review comments for PR #${prNumber}.`;
  }

  let md = `# GitHub PR Review Fix Tasks

Pull Request: #${prNumber}

Your job is to resolve the following review comments.

Rules:

• Fix each task completely
• Modify only relevant code
• Preserve existing style and patterns
• Do not introduce unrelated refactors
• Mark tasks mentally as complete before moving on

---

`;

  let taskNumber = 1;

  for (const [file, comments] of grouped.entries()) {
    md += `\n## File: ${file}\n`;

    for (const c of comments) {
      md += `
### Task ${taskNumber}

Location: ${file}:${c.line}

Reviewer: ${c.reviewer}

Issue:
${c.comment}

Diff Context:
\`\`\`diff
${c.diff}
\`\`\`

Required Action:
Fix the issue described above in the referenced file.

---

`;

      taskNumber++;
    }
  }

  md += `

# Final Step

After completing all fixes:

Generate the Conventional Commit message for the changes.

Use standard Conventional Commit format.
`;

  return md;
}

function parseArgs() {
  const args = process.argv.slice(2);

  const options = {
    prNumber: null,
    copilotOnly: false
  };

  for (const arg of args) {
    if (arg === '--copilot-only') {
      options.copilotOnly = true;
    } else if (!options.prNumber) {
      options.prNumber = arg;
    }
  }

  if (!options.prNumber) {
    console.error('Usage: npm run pr:review <PR_NUMBER> [--copilot-only]');
    process.exit(1);
  }

  return options;
}

function main() {
  const { prNumber, copilotOnly } = parseArgs();

  const { owner, repo } = getRepoInfo();

  console.log(`Fetching PR #${prNumber} review threads...`);

  const threads = fetchReviewThreads(owner, repo, Number(prNumber));

  const unresolved = filterThreads(threads, { copilotOnly });

  const grouped = groupByFile(unresolved);

  const prompt = buildPrompt(prNumber, grouped);

  fs.writeFileSync(OUTPUT_FILE, prompt);

  console.log(`
PR review prompt generated:

${OUTPUT_FILE}

Unresolved threads: ${unresolved.length}
Files affected: ${grouped.size}

Feed this file to your VSCode agent.
`);
}

main();
