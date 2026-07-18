# Streamarr / Playarr

**Streamarr** is a self-hosted media server. **Playarr** is the suite of
native clients that watch things on it. This repository is the monorepo for
both: one Rust backend, seven playback clients, and the infrastructure to run
the whole thing on anything from a Raspberry Pi to a Kubernetes cluster.

## What this is

If you already run Sonarr, Radarr, Lidarr, Bazarr, Prowlarr, and/or Readarr,
you have a great acquisition and organisation pipeline but no single, polished
place to *watch* the result — and no first-class native apps for phones,
tablets, or TVs. Streamarr sits on top of that stack: it owns your media
library (scanning, metadata, artwork), playback (on-demand and background
transcoding, via [Tdarr](https://github.com/HaveAGitGat/Tdarr) for the
library-wide encode work), authentication, and a single unified HTTP/JSON API
— while leaving indexing, acquisition, and subtitle-fetching to the *arr apps
that already do it well. Playarr is what you actually install to watch things:
Android Mobile, Android TV, iOS, LG webOS, Samsung Tizen, Hisense VIDAA, and a
browser-based Web client, all speaking the same versioned API contract.

See the public [Playarr Clients page](https://playarr.app/clients) for current
availability. Hisense owners can follow the [VIDAA guide](docs/clients/vidaa.md)
to open the hosted Playarr Web App in the television Browser or try the
experimental, temporary-DNS launcher installer on compatible firmware.

Streamarr is designed to run at three tiers without a different codebase or a
data-migration story at each step: a single systemd-managed binary against
SQLite on a home server, a small Docker Compose stack against Postgres, or a
Kubernetes deployment with independently scaled API/worker/coordinator roles
of the *same* binary. See
[`docs/architecture/overview.md`](docs/architecture/overview.md) for why it's
built this way.

## Why it exists

Self-hosted media is currently a patchwork: great acquisition tooling (the
*arr apps), a great transcode farm (Tdarr), and then a gap where a coherent,
native, multi-platform *playback* experience should be. Commercial media
servers fill that gap but keep you out of your own stack. Streamarr/Playarr
exists to close that gap without giving up ownership: wrap the tools you
already trust, add the library/playback/auth layer they don't provide, and
ship real native clients — not just a web view wrapped in each platform's
app shell — for every screen people actually watch on.

## High-level architecture

```
                    ┌───────────────────────────────────────────┐
                    │              Playarr clients               │
                    │  Android Mobile · Android TV · iOS · Web    │
                    │  webOS · Tizen · VIDAA (hosted Web App)     │
                    └───────────────────┬─────────────────────────┘
                                        │  versioned HTTP/JSON API
                    ┌───────────────────▼─────────────────────────┐
                    │                 Streamarr                   │
                    │  (single Rust binary, role-gated: API /     │
                    │   worker / coordinator)                     │
                    │                                             │
                    │  library · auth · on-demand transcode ·     │
                    │  background transcode dispatch (Tdarr) ·    │
                    │  *arr adapter layer                         │
                    └───┬───────────────────┬───────────────┬─────┘
                        │                   │               │
                ┌───────▼──────┐   ┌────────▼───────┐   ┌───▼────┐
                │ Sonarr/Radarr │   │      Tdarr      │   │ SQLite │
                │ Lidarr/Bazarr │   │ (worker pool)   │   │   or   │
                │Prowlarr/Readarr│   │                 │   │Postgres│
                └───────────────┘   └─────────────────┘   └────────┘
```

Streamarr treats each *arr application as a managed external service rather
than reimplementing indexing/acquisition/subtitles itself, and splits
transcoding into two independent problems: latency-sensitive on-demand
transcode-on-play, and low-priority library-wide background re-encoding
dispatched to a Tdarr worker pool. The full reasoning, the crate layout, the
deployment-tier matrix, and the client code-sharing strategy are documented
in depth in [`docs/architecture/overview.md`](docs/architecture/overview.md)
— read that before making non-trivial changes anywhere in the tree.

For what's built, what's next, and how work is sequenced across the monorepo,
see [`docs/roadmap.md`](docs/roadmap.md).

## Repo layout

```
.
├── backend/            Streamarr: the Rust workspace (Cargo workspace under
│                        backend/crates/*, migrations, OpenAPI spec, config,
│                        integration tests). Builds a single `streamarr`
│                        binary; see docs/architecture/overview.md for the
│                        role-gating model.
├── clients/             Playarr: the native and web clients.
│   ├── mobile-android/     Android phone/tablet host for responsive Playarr Web.
│   ├── tv-android/          Android TV host for the same Playarr Web app.
│   ├── android-shared/       Gradle root: shared core-* library modules
│   │                          (data, domain, design system, player, auth),
│   │                          plus the settings.gradle.kts that pulls in
│   │                          mobile-android/ and tv-android/ as sibling
│   │                          app modules of the same build.
│   ├── ios/                    Swift package (SwiftUI app target +
│   │                            UIKit-free StreamarrKit library target).
│   │                            Source-only for now: no Xcode project yet,
│   │                            wraps in one once Xcode is available.
│   ├── tv-web/                   Responsive TypeScript/React Playarr workspace
│   │                              shared by the Web client and the
│   │                              webOS/Tizen/VIDAA TV platform wrappers,
│   │                              plus platform-specific packaging under
│   │                              tv-web/apps/*.
│   └── shared/                     Cross-client tooling, e.g. OpenAPI-
│                                    generated SDK codegen consumed by every
│                                    client above.
├── infra/                Deployment for all three tiers.
│   ├── systemd/            Tier 1: unit files for a single-node install.
│   ├── docker/              Tier 2: Docker Compose stacks (dev + prod),
│   │                          plus local observability/mocks for dev.
│   ├── kubernetes/           Tier 3: base manifests, Helm chart, and
│   │                          per-environment overlays.
│   ├── k6/                    Load-test harness.
│   └── vidaa-gateway/         Expiring DNS and fixed Playarr launcher portal.
├── scripts/               Dev tooling: local environment seeding, SDK
│                           codegen entry points, and related scripts invoked
│                           by the Justfile recipes below.
├── docs/                  Project documentation.
│   ├── architecture/overview.md   Start here.
│   └── roadmap.md                 What's built, what's next.
├── .github/workflows/     CI: per-component workflows plus a top-level
│                           `ci.yml` that fans out to them.
├── Justfile               Cross-language task runner: `just --list`.
├── rust-toolchain.toml    Pins the backend's Rust toolchain.
└── CONTRIBUTING.md        How to build/run each component locally.
```

Every directory above is independently ownable: a crate, an infra tier, a
client platform, or a docs subtree. That's deliberate — see the "Why this is
a monorepo" section of the architecture overview for the reasoning.

## Getting started

```sh
just --list        # see every available recipe
just backend-check  # fmt + clippy + cargo check for the Rust backend
just backend-test    # backend test suite
just backend-run      # run the Streamarr server locally
just tv-web-dev        # tv-web client dev server
just dev-up              # bring up the local Docker Compose dev stack
just dev-seed              # seed it with sample data
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full local-development
walkthrough, and [`docs/architecture/overview.md`](docs/architecture/overview.md)
for how the system fits together before you dive into a specific component.

## License

MIT, see [`LICENSE`](LICENSE).
