# Contributing to Playarr Server / Playarr

This is a monorepo containing the Playarr Server backend, all Playarr
clients, and the infrastructure to deploy them. Before making a non-trivial
change, read [`docs/architecture/overview.md`](docs/architecture/overview.md)
— it explains why the system is shaped the way it is, and most "why isn't
this just done the simple way" questions are answered there.

Before changing any client, also read
[`docs/architecture/client-principles.md`](docs/architecture/client-principles.md):
every app is fully native for its platform, targets full product parity and
performance, and degrades only for real capability gaps (not for shipping
convenience).

## Monorepo structure

```
backend/          Playarr Server: Rust workspace (Cargo workspace under backend/crates/*)
clients/          Playarr: android/ (one universal app project), ios/,
                   tv-web/ (Web + webOS + Tizen + VIDAA), shared/
infra/            systemd/, docker/, kubernetes/, k6/ — deployment for all three tiers
scripts/          Local dev tooling (environment seeding, SDK codegen)
docs/             Architecture, roadmap, versioning policy, ADRs
.github/workflows/ CI, one workflow per component plus a fan-out ci.yml
```

Each directory is independently ownable (a crate, a client platform, an infra
tier, a docs subtree) so changes to one component rarely conflict with
changes to another. Keep PRs scoped to the component(s) they actually touch.

All cross-component tasks are defined once, in the [`Justfile`](Justfile), so
you don't need to remember each component's underlying toolchain invocation.
Install `just` (`brew install just` or see
[casey/just](https://github.com/casey/just)) and run `just --list` to see
every recipe.

## Running the backend locally

The backend is a Cargo workspace under `backend/`, pinned to the stable Rust
channel via [`rust-toolchain.toml`](rust-toolchain.toml) (`rustup` picks this
up automatically).

```sh
just backend-check   # cargo fmt --check + clippy (warnings denied) + cargo check
just backend-test     # cargo test --workspace
just backend-run       # cargo run --bin playarr (foreground, debug build)
```

`backend-run` forwards extra arguments to the binary, e.g.
`just backend-run -- --role api --config ./backend/config/dev.toml`. See
[`docs/architecture/overview.md`](docs/architecture/overview.md#the-single-role-gated-binary-principle)
for what `--role` does and why there's only one binary.

For anything beyond a bare `cargo run` — a full stack with the *arr apps and
Tdarr wired up — use the Docker Compose dev environment instead (below).

## Running a client locally

**tv-web** (Web + the webOS/Tizen/VIDAA TV shell), a pnpm workspace under
`clients/tv-web/`:

```sh
just tv-web-dev     # dev server with hot reload
just tv-web-build    # production bundles for every tv-web target
```

**Android** (mobile + TV): `clients/android/` is the only Android project. It
contains one responsive `app` module plus internal `core-*` modules and emits
one APK for every supported Android form factor. Always invoke Gradle from
`clients/android/`, which is what `just` does for you:

```sh
just android-build                         # ./gradlew assembleDebug
just android-build :app:assembleRelease    # target the release variant
```

**iOS** (`clients/ios/`): currently a source-only Swift package (no Xcode
project yet — see `clients/ios/Package.swift`), so the check available today
is a plain SwiftPM build, which only needs the Swift toolchain (Xcode
Command Line Tools), not full Xcode:

```sh
just ios-build   # swift build
```

This type-checks and builds the `PlayarrApp`/`PlayarrKit` targets but
does not produce a signed, installable `.app` — that needs an Xcode project
wrapping the package, and full Xcode. `just ios-build` will move to
`xcodebuild` once that project exists.

**HarmonyOS NEXT** (`clients/harmony/`): a native ArkTS/ArkUI project, one HAP
covering phone, tablet/foldable and Huawei Vision TV. Most of it is verifiable
without the Huawei SDK at all:

```sh
just harmony-validate   # offline structural + contract checks (seconds)
just harmony-test        # unit-tests the pure-logic core (seconds)
just harmony-sdk          # fetch the OpenHarmony SDK + Command Line Tools
just harmony-build         # compile a real HAP once the SDK is fetched
```

See `clients/harmony/README.md` for exactly what each tier verifies and what
still needs a physical HarmonyOS device.

If you're on a machine without a relevant native SDK installed (full Xcode,
Tizen Studio, the webOS CLI, the OpenHarmony SDK), you can still read and edit
the source under `clients/`, but you won't be able to run every platform-
specific build step locally — check that client's own `README.md` for what's
actually verifiable without the SDK.

## Local dev stack

`infra/docker/` holds the Docker Compose stack used for local development
(Playarr Server plus the wrapped *arr apps and Tdarr, wired together).

```sh
just dev-up      # bring the stack up in the background
just dev-seed     # populate it with sample libraries/config
just dev-logs      # tail logs
just dev-down        # tear it down
```

## Pull request conventions

- **Keep PRs scoped to one component** (one crate, one client, one infra
  tier, one docs subtree) unless the change is an API-contract update that
  genuinely needs to land alongside the client(s) that consume it — the
  monorepo exists specifically so that kind of atomic, cross-component PR is
  possible, but it should be the exception, not the default.
- **Title format:** `<component>: <imperative summary>`, e.g.
  `backend(playarr-transcode): fix HLS segment numbering on resume` or
  `clients/ios: fix FairPlay license renewal race`. Use `infra`, `docs`, or
  `repo` as the component for changes that don't belong to a single crate or
  client.
- **Before opening a PR**, run the relevant `just` check recipe(s) for every
  component you touched (`backend-check`/`backend-test` for backend changes,
  the client's own lint/build step for client changes) locally. CI runs the
  same recipes and will reject anything that doesn't pass.
- **Reference the architecture doc, not just the diff**, when a change makes
  a non-obvious tradeoff — link the relevant section of
  `docs/architecture/overview.md` (or add an ADR under
  `docs/architecture/adr/` for a new one) rather than only explaining the
  reasoning in the PR description, so the reasoning stays discoverable after
  the PR itself is buried in history.
- **Update docs in the same PR** as the code that makes them stale. A PR that
  changes behaviour documented in `docs/` without updating `docs/` will be
  asked to do so before merge.
- Every path in the repo has an owner in [`CODEOWNERS`](CODEOWNERS); PRs need
  that owner's review.

## Code style

Formatting is enforced by each language's own tool, not by hand: `cargo fmt`
(Rust), the client's own formatter/linter (Prettier/ESLint for tv-web,
ktlint for Android, SwiftFormat for iOS). [`.editorconfig`](.editorconfig)
sets the baseline (indentation, line endings, final newline) that every
editor should already be honouring; run your language's formatter before
pushing rather than relying on editor settings alone.
