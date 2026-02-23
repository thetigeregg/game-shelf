# AI Agent Instructions

This repository uses Conventional Commits.

## Commit format

type(scope): description

Examples:

feat(ui): add game editor modal
fix(api): correct IGDB platform mapping
refactor(service): simplify caching logic

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
- implementation details
- testing notes

## Code rules

- Use strict TypeScript
- Follow Angular architecture patterns
- Do not introduce implicit any
- Follow existing service/component structure

## Disallowed

- vague commit messages
- committing secrets
- bypassing lint without reason
