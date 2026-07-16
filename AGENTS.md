# Repository working agreement

These instructions apply to the entire repository.

## Delivery

- Do not leave completed work only in the working tree. Commit and push each logical change as
  soon as its relevant validation passes.
- Keep commits small and atomic: one intent per commit, with its directly related tests,
  documentation, generated contracts, and migration files.
- Use Conventional Commits in the form `type(scope): imperative summary`. Prefer `feat`, `fix`,
  `docs`, `test`, `refactor`, `perf`, `build`, `ci`, or `chore`; keep the subject concise and do
  not end it with a full stop.
- Push each completed commit to the current branch's configured upstream. Never force-push unless
  the user explicitly requests it.
- Before and after every push, verify the branch, upstream, and repository status. Report the real
  pushed commit hash rather than assuming the push succeeded.

## Changelog

- Update `CHANGELOG.md` in the same commit as every change. Add a concise entry beneath
  `Unreleased` in the appropriate category.
- Include user-visible behaviour, fixes, security changes, operational changes, tests,
  documentation, generated contracts, and developer workflow changes.
- A commit whose only purpose is to maintain `CHANGELOG.md` does not need to describe itself in
  the changelog.

## Safety before committing or pushing

- Inspect the complete staged diff with `git diff --cached` and run `git diff --cached --check`.
- Scan every staged change with `gitleaks git --staged --redact`.
- Never commit secrets, credentials, tokens, private keys, personal data, local databases,
  downloaded models, caches, browser-automation state, build outputs, or environment-specific
  scratch files.
- Use placeholders in examples and documentation. Do not publish private hosts, private media
  identifiers, personal absolute paths, or real account details.
- If a safety check finds a possible exposure, stop and remove or sanitise it before committing.

## Validation

- Run the narrowest relevant checks before each commit, then run the repository's broader
  validation before the final push.
- Do not claim a test passed unless its command completed successfully in the current worktree.
- Preserve unrelated user changes and never use destructive Git cleanup commands to make a commit
  easier.
