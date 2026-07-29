# Repository working agreement

These instructions apply to the entire repository.

## Client product bar (native, parity, performance)

Canonical policy: [`docs/architecture/client-principles.md`](docs/architecture/client-principles.md).
It overrides weaker or older wording elsewhere in the tree.

- **Every Playarr app is fully native** for its platform (Compose, SwiftUI,
  SceneGraph, UWP/XAML, ArkUI, vendor TV package + native player plane, or a
  first-class browser app on Web). Do not introduce WebView shells of Playarr
  Web as the signed-in product on native-capable OS targets.
- **Android TV especially:** fully native Compose + Media3 only. Never use a
  WebView of Playarr Web, Chromium freezes, or SPA residual AE=0 gates as the
  television product or as the parity success path. Binding detail:
  `clients/android/AGENTS.md` and `docs/architecture/clients/android-tv.md`.
- **Full product parity** across complete clients: same tasks, hierarchy, and
  server contract. Do not thin a client because another surface already has
  the UI.
- **Native-class performance**: prefer direct play and the platform media
  pipeline; use real scroll and focus systems; do not accept a browser-engine
  tax where a native toolkit exists.
- **Graceful degradation only for missing capability** (for example offline
  downloads on platforms that cannot support them). Hide or disable with an
  honest reason; never crash or pretend success.
- Temporary fallbacks (browser on Xbox, hosted Web on VIDAA, transitional TV
  web packages) stay labelled as fallbacks until the native path matches.
  Known deviations are listed in the principles doc; do not extend them.

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

## Scrolling and directional navigation

- Use a real browser scroll container (`overflow: auto` or an axis-specific equivalent) for every
  viewport that can overflow. Do not make content reachable only through focus-driven or
  arrow-driven JavaScript scrolling; mouse wheels, scrollbars, touch dragging, and trackpads must
  work without focus.
- Mark shared and nested scroll viewports with `data-tv-scroll-container`, their
  `data-tv-scroll-axis`, and a stable `data-navigation-scroll-key` when their position must be
  restored. Fullscreen surfaces may lock the page root only when every overflowing panel owns a
  native scroll viewport.
- In spatial navigation, single-line text inputs must release ArrowUp and ArrowDown so focus can
  leave the field after an on-screen keyboard closes. Preserve Left and Right for caret movement,
  and preserve native arrow behaviour for textareas, selects, number inputs, and range inputs.
- Add regression coverage whenever the shared scroll-root or form-control arrow policy changes.
