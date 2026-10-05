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

## No media titles or real media assets

This repository is public. **Never write the name of a real film, series, episode, album, track, artist or
studio franchise anywhere in it**: not in code, tests, fixtures, comments, docs, `TASKS.md`, `tasks.d/`,
`CHANGELOG.md`, `changelog.d/`, scripts, branch names, commit messages or PR text. Use neutral references
(`Test Movie A`, `Sample Series 1`, "a 4K Dolby Vision remux at about 64 Mbps", "a test series with three seasons").
Likewise never commit real posters, backdrops, stills, album art, cast photos, video clips or screenshots that show
real titles or artwork; generate placeholders instead (solid colours, gradients, procedural art). Openly licensed
demo media that the product genuinely needs is the only exception and must be justified where it is used.
Do not keep a list of forbidden titles in the repository: such a list would itself leak them.

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

## Deployment configuration (this repository is public)

- Never commit environment data: real hostnames or domains, node names, LAN, tailnet or public
  host addresses, hostPaths, registry hosts, image pins, cluster Secret names or personal paths.
  Use placeholders in code, tests and docs (`example.com`, `<node>`, RFC 5737 addresses such as
  `203.0.113.10`, `/srv/...`). `scripts/ci/check-env-data.sh` enforces this in CI; genuinely
  generic IPv4 examples go in `scripts/ci/env-data-allowlist.txt`.
- Kubernetes manifests and Helm charts here are generic templates with neutral defaults
  (`infra/kubernetes/helm/playarr-dev` renders nothing on its own; its README lists the values).
  Deployment of the server (values, image pins, rollouts) is out of scope of this repository.
- The `regional-image` workflow publishes `ghcr.io/<owner>/playarr-regional:<sha8>` for each
  `main` commit. Consumers pin an image tag in their own deployment configuration; never move a
  pin to an older image.

## Runners

This repository is public: every workflow job runs on a GitHub-hosted runner (`ubuntu-latest`,
`windows-latest` or `macos-latest`). Never add a self-hosted runner, a runner group or a
`runs-on` expression. `scripts/ci/check-hosted-runners.sh` enforces this in CI and in the merge
train.

## Merging: the merge train

Pull requests are landed by the merge train (`.github/workflows/merge-train.yml`,
`scripts/merge-train.sh`), not by hand. It replaces GitHub's merge queue, which repositories
on a personal account do not get.

- **Agents: when your PR is finished and its local checks pass, add the label `ready` and stop.**
  Do not wait for CI to merge it and do not merge it manually (never `--admin`). Move on to
  other work or report.
- The train handles one PR at a time, oldest `ready` label first: it merges the latest `main`
  into your branch only when main's new commits touch your files (CHANGELOG.md, TASKS.md,
  `changelog.d/` and `tasks.d/` excluded) or conflict; otherwise it keeps your tested head, so a
  running CI is never cancelled by an unrelated landing. It waits for `ci-required` on that exact
  head SHA, then squash-merges. Its commits are authored by Thomas McFarlane and carry a
  `Merge-Train: yes` trailer, which `scripts/ci/check-fragments.sh` exempts.
- Whenever the train rewrites a head anyway (folding fragments, squashing several commits) it
  merges the current `main` in first, so what lands is always current main plus the PR's diff.
  Before landing, a guard refuses any result that changes files outside the PR's diff, restores a
  file to its state before one of main's last 50 commits, or drops TASKS/CHANGELOG lines those
  commits added; after an API merge the train checks main's new tree is exactly main + the PR and
  stops if not. A deliberate revert of a recent change is therefore landed by hand (merge rule v2).
- On a conflict, a red `ci-required`, a timeout or any other failure it removes `ready`, adds
  `blocked` and comments the reason. Fix it, push, remove `blocked` and add `ready` again.
- Do not push to a branch that carries `ready` unless you are withdrawing it (remove the label first).
- Merge manually (merge rule v2: rebase, green `ci-required` on the pushed SHA, plain squash) only
  while the train is down, which means the `Merge train` workflow is failing or disabled.
- Dry run: Actions > Merge train > Run workflow (default `dry_run: true`, optional `pr`) merges main
  locally and reports what it would do without pushing, labelling, commenting or merging.
- Owner one-off for the best behaviour: create a new write deploy key for this repository and store
  its private half as the secret `TRAIN_DEPLOY_KEY` (deploy keys do not carry over from another
  repository). With it, the train's pushes and landings trigger CI
  and the deploy workflows natively. Without it the train still works using `GITHUB_TOKEN`, starting
  CI via `workflow_dispatch` and dispatching post-merge workflows itself; it cannot push a merge that
  brings in `.github/workflows` changes (it blocks with an explanation) and it does not start the
  Android Play upload (needs a version input).

## Changelog

- **Do not edit `CHANGELOG.md` in a PR** (it is a merge-conflict hotspot; CI rejects such PRs).
  Add one fragment file per change under `changelog.d/`, named `<slug>.<category>.md`
  (categories: added, changed, fixed, removed, security, deprecated, documentation, performance,
  testing), containing one or more `- ...` bullets. The merge train folds fragments into
  `## [Unreleased]` and deletes them as the PR lands. See `changelog.d/README.md`.
- Include user-visible behaviour, fixes, security changes, operational changes, tests,
  documentation, generated contracts, and developer workflow changes.
- A change whose only purpose is to maintain the changelog or task board does not need to describe itself.

## Task tracking

- `TASKS.md` stays the live board, but **do not edit it directly in a PR** (CI rejects that). Add or
  update rows with fragment files `tasks.d/<row-number>.md` (a `section:` line plus the complete
  row; an existing row number replaces that row in place). The merge train folds them into
  `TASKS.md` when the PR lands. See `tasks.d/README.md`. Validate with
  `node scripts/fold-fragments.mjs --check`.
- Add every newly discovered unit of work as a task row (fragment) immediately, using the numbered
  MC3-style table pattern. Do not leave blockers, follow-up work, or acceptance gaps only in chat,
  logs, or hand-off notes.
- Update each active row's status, owner, notes, and concrete evidence as work starts, progresses,
  becomes blocked, or completes. Keep the board current during the work rather than reconciling it
  only at the end.
- Every new owner requirement or bug must get a task row in the same PR that starts the work.
  The coordinator logs requirements passed verbally (chat, calls, hand-offs) as rows straight away,
  so nothing exists only in conversation.
- Any agent working in this repository must read and maintain the board; when delegating work,
  include the relevant task number and require status/evidence to be returned for the board.

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

## React — prefer derived state over effects

Follow [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect). This is a
performance rule as well as a correctness rule: every `useEffect` → `setState` pair is an extra
render (and under TV remote navigation, often a long task).

- If a value can be computed from props or existing state, **derive it during render** (or with
  `useMemo` when expensive). Do not store it in `useState` and sync it from an effect.
- `useEffect` is for **synchronising with external systems** only (network, subscriptions, DOM
  measurement APIs, timers, imperative third-party widgets). It is not for chaining React state.
- Event handlers (and focus/scroll handlers), not effects, should drive state that changes because
  the user did something.
- When props reset local UI (e.g. route `kind` changes), adjust state **during render** with the
  “store previous prop” pattern, or remount with `key={...}`. Do not `useEffect(() => setX(...), [prop])`.
- Prefer one source of truth (focused index, selected id, filter) and derive windows, labels,
  “is-selected”, empty/loading flags, and secondary chrome from it.
- Reach for `useEffect` only after ruling out: derived value, `useMemo`, event handler, `key` reset,
  or lifting state up.
