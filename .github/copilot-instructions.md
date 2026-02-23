# Repository Development Instructions

## Commit messages

All commits MUST follow Conventional Commits:

type(scope): summary

Examples:

feat(ui): add metadata editor modal
fix(api): resolve platform mapping bug
refactor(service): simplify API client

Rules:

- use lowercase type
- use present tense
- do not use vague messages like "update code"
- scope should reflect the affected area

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

## Pull requests

PR titles MUST follow Conventional Commits.

PR descriptions must include:

- summary
- technical explanation
- testing notes

## Architecture rules

- UI logic in Angular components
- business logic in services
- no API calls directly in components
- use strict TypeScript typing

## Code quality

Ensure:

- lint passes
- tests pass
- no console errors
