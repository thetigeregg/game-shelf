# Public Repo Security Checklist

Use this before switching repository visibility to public.

## 1) Rotate exposed credentials first
- Rotate/revoke any credential that was ever committed.
- For this repo, rotate the Firebase web API key currently found in `src/environments/environment.local.ts`.

## 2) Keep local secrets untracked
- `src/environments/environment.local.ts` is now gitignored.
- Use `src/environments/environment.local.example.ts` as the template.

## 3) Rewrite git history to purge exposed values
Run from a clean local clone:

```bash
git filter-repo --replace-text <(cat <<'EOT'
REDACTED_FIREBASE_API_KEY==>REDACTED_FIREBASE_API_KEY
EOT
)
```

If `git filter-repo` is not installed:

```bash
brew install git-filter-repo
```

## 4) Force-push rewritten history
```bash
git push --force --all
git push --force --tags
```

## 5) Ask collaborators to re-clone
After history rewrite, old clones must be re-cloned (or hard-reset to new history).

## 6) Verify in CI
- `Secret Scan` workflow runs on pull requests to `main` and pushes to `main`.
- It scans tracked files for credential leaks and fails the check if leaks are detected.

## 7) Optional one-time full-history verification
After rewrite, run:

```bash
gitleaks git --redact
```

or in CI using a temporary workflow-dispatch job with git-history scan enabled.
