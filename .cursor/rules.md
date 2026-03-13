# Cursor Agent Rules

This repository enforces strict development rules.

## Pre-push requirements

Before suggesting a commit or PR, the agent MUST verify that:

- Angular build passes
- Lint passes
- Tests pass

Commands:

npm run build
npm run lint
npm test

If any command fails, the agent MUST fix the issue before suggesting a commit.

---

## Commit rules

Commits MUST follow Conventional Commits.

Format:

type(scope): summary

Examples:

feat(ui): add metadata editor modal
fix(api): correct IGDB platform mapping

Allowed types:

feat
fix
refactor
perf
docs
test
build
ci
chore
style

Rules:

- lowercase type
- present tense
- concise technical summary
- scope must match affected system

Commit messages MUST be generated from the actual git diff.

Never invent changes.

---

## Pull request rules

PRs MUST be generated from the diff vs origin/main.

Use:

git diff origin/main...HEAD

PR titles MUST follow Conventional Commits.

PR descriptions MUST be generated from the diff against origin/main.

Use:

node scripts/pr-summary.mjs

The generated prompt file (.pr-summary-prompt.md) must be used to produce
the PR description following .github/pull_request_template.md.

---

## Code quality requirements

Before completing a task the agent MUST check:

- Angular architecture patterns are respected
- strict TypeScript typing
- no implicit any
- services contain business logic
- components do not call APIs directly

---

## Security rules

Never commit secrets.

Secrets belong in:

nas-secrets/

---

## Final validation checklist

Before proposing a commit or PR:

1. lint passes
2. build passes
3. tests pass
4. commit message follows Conventional Commits
5. PR description follows template