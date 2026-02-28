# Copilot Repository Instructions

## Overview

Game Shelf is an Ionic + Angular PWA for tracking a personal game library with metadata enrichment, box art/manual lookup, and browser sync support.

## Project structure

- `src/`: Frontend app (Ionic/Angular PWA)
  - `src/app/core/`: Services, models, data layer, API clients, security, and utils
  - `src/app/features/`: Feature modules (e.g. game-list)
- `server/`: Fastify 5 API (sync, image proxy/cache, manuals, metadata proxy)
- `worker/`: Shared metadata normalisation logic and tests used by server routes
- `hltb-scraper/`: Playwright-backed HLTB lookup service
- `metacritic-scraper/`: Metacritic lookup service
- `edge/`: Caddy image that serves the frontend and proxies `/api`
- `docs/`: Deployment and operational documentation
- `.github/workflows/`: CI, release/publish, and secret scanning pipelines

## Tech stack

- Angular 21 + Ionic 8 (frontend PWA)
- Fastify 5 (server)
- Dexie (IndexedDB ORM for local storage)
- TipTap (rich text editor for game notes)
- Vitest + jsdom (frontend unit tests)
- Node built-in test runner with tsx (server/worker tests)
- Playwright (E2E tests)

## Development setup

Install all workspace dependencies:

```bash
npm ci
```

Copy the example env file and populate secrets under `nas-secrets/`:

```bash
cp .env.example .env
```

Start the local Docker stack (postgres, api, edge, scrapers):

```bash
npm run dev:stack:up
```

Run the frontend dev server at `http://localhost:8100`:

```bash
npm start
```

## Build

```bash
npm run build
```

The `prebuild` script auto-generates `src/assets/runtime-config.js` and Metacritic platform artifacts.

## Testing

Run frontend unit tests with coverage:

```bash
npm test
```

Run backend (server + worker) tests:

```bash
npm run test:backend
```

Run backend coverage checks (80% threshold):

```bash
npm run test:backend:coverage
```

Run UI component + E2E tests:

```bash
npm run test:ui
```

## Linting

```bash
npm run lint
```

## Commit messages

- VS Code Copilot Chat
- VS Code inline suggestions
- GitHub Copilot PR generation
- GitHub Copilot commit message generation

Copilot MUST follow these instructions strictly.

---

# Commit Messages

Copilot MUST use the template defined in:

.github/commit-template.md

Copilot MUST:

- follow the template structure exactly
- never invent new sections
- never remove required sections
- fill in all relevant sections concisely
- base content on the actual code diff

All commits MUST follow Conventional Commits format:

type(scope): summary

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

- use lowercase type
- use present tense
- do not use vague messages
- scope must reflect the actual affected system
- summary must be concise and technical

Examples:

feat(ui): add metadata editor modal  
fix(api): resolve platform mapping bug  
refactor(service): simplify API client

Copilot MUST NOT generate:

- generic messages like "update code"
- messages without scope when scope is applicable
- messages that do not follow Conventional Commits

---

# Pull Requests

Copilot MUST use the template defined in:

.github/pull_request_template.md

Copilot MUST:

- follow the template exactly
- never invent new sections
- never omit template sections
- fill all sections using technical, precise explanations
- base explanations on the actual changes

PR titles MUST follow Conventional Commits.

PR descriptions MUST include:

- summary
- technical explanation
- testing notes

Copilot MUST prioritize technical accuracy over verbosity.

---

# Content Source Requirements

When generating commits or PR descriptions, Copilot MUST use:

- git diff
- staged changes
- modified files
- code context

Copilot MUST NOT:

- hallucinate features
- invent changes that did not occur
- speculate about intent beyond observable code

---

# Architecture Rules

Copilot MUST follow architecture constraints:

- UI logic belongs in Angular components
- business logic belongs in services
- API calls MUST NOT be placed in components
- strict TypeScript typing is required

Copilot SHOULD suggest refactoring if violations are detected.

---

# Code Quality Requirements

Copilot MUST ensure suggested code:

- passes lint rules
- passes tests
- has no console errors
- follows repository conventions

Copilot MUST prefer existing project patterns over introducing new patterns.

- UI logic in Angular components
- business logic in services
- no API calls directly in components
- use strict TypeScript typing
- follow existing service/component structure

# Priority Order

- Use strict TypeScript; do not introduce `implicit any`
- Follow Angular architecture patterns
- Lint must pass (`npm run lint`)
- Tests must pass (`npm test` for frontend, `npm run test:backend` for server/worker)
- No console errors

## Security

- Never commit secrets or credentials to the repository
- Secret files belong in `nas-secrets/` which is git-ignored
- Do not bypass lint checks without justification
- HTML user input is sanitised via DOMPurify through `HtmlSanitizerService` before persistence
