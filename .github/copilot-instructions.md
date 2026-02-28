# Copilot Repository Instructions

These instructions apply to ALL Copilot features including:

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

---

# Priority Order

When conflicts occur, Copilot MUST prioritize:

1. commit-template.md
2. pull_request_template.md
3. this copilot-instructions.md
4. existing repository code patterns
5. general Copilot defaults (lowest priority)
