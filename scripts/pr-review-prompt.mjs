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
  const url = runGh(['repo', 'view', '--json', 'nameWithOwner']);
  const parsed = JSON.parse(url);
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
          comments(first:10) {
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

  let md = `
You are addressing GitHub Pull Request review comments.

Fix the issues described below.

Guidelines:

• Modify only the relevant code
• Preserve project style and patterns
• Avoid unrelated refactors
• Inspect the referenced file if context is unclear

Pull Request: #${prNumber}

---

`;

  for (const [file, comments] of grouped.entries()) {
    md += `\n# FILE: ${file}\n`;

    for (const c of comments) {
      md += `
LINE: ${c.line}

Reviewer: ${c.reviewer}

Comment:
${c.comment}

Diff Context:
\`\`\`diff
${c.diff}
\`\`\`

---
`;
    }
  }

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
