# Playarr Server releases

Playarr Server is published as build artefacts on GitHub Releases.

| Artefact | Where |
|---|---|
| Linux x86-64 tarball | `https://playarr.app/downloads/server/playarr-server-linux-amd64.tar.gz` (latest) or `.../playarr-server-<version>-linux-amd64.tar.gz` |
| Linux ARM64 tarball | `https://playarr.app/downloads/server/playarr-server-linux-arm64.tar.gz` (latest) or `.../playarr-server-<version>-linux-arm64.tar.gz` |
| Checksums | `<tarball>.sha256` beside each tarball, and `.../playarr-server-<version>-SHA256SUMS` |
| Latest manifest | `https://playarr.app/downloads/server/latest.json` (version, image, per-arch URL, SHA-256, size) |
| Container image | `ghcr.io/thomasmcfarlane/playarr-server:<version>` and `:latest` (multi-arch, ffmpeg included, SBOM and provenance attached) |

The tarball unpacks to `playarr-server-<version>-linux-<arch>/` with `playarr-server`, `web/` (the
Admin UI, which the binary finds beside itself or via `PLAYARR_WEB_ASSETS_DIR`), `LICENSE`,
`README.txt` and `systemd/` (example units, env template, `install.sh`). The binary needs glibc
2.39 or newer, libssl3 and ffmpeg on the `PATH`; the container image has everything.

## How a release is cut

1. Bump `version` in `backend/Cargo.toml` and merge it.
2. Tag the merge commit and push: `git tag backend-v0.1.0 && git push origin backend-v0.1.0`. The tag
   version must equal the crate version (a `-rc.1` style suffix is allowed and marks a pre-release).
3. `.github/workflows/backend-release.yml` builds both architectures with
   `infra/docker/backend.Dockerfile` (the Rust build cross-compiles natively on the x86-64 runner, so
   the tarball binary is byte-identical to the one in the image), smoke-tests the amd64 tarball
   (`/healthz` and the Admin UI), packs the tarballs with `scripts/package-server-release.sh`, pushes
   the image, and attaches the tarballs, checksums and `latest.json` to the GitHub release for the
   tag (`backend-v<version>`). GitHub Releases is the only download store. Pre-releases are marked as
   such, are never the "latest" stable release, and do not get the `latest` image tag.
4. The Worker (`clients/tv-web/web/worker.js`) keeps the stable `https://playarr.app/downloads/server/`
   URLs: the unversioned aliases resolve the newest stable `backend-v*` release and redirect to its
   assets, versioned paths redirect to the matching tag, and `latest.json` is proxied same-origin. The
   Android APK is served the same way from `android-v*` releases. The Clients hub page `/clients/server` shows the
   buttons and reads the manifest for the version and checksums. Bump `SERVER_FALLBACK_VERSION` in
   `Clients.tsx` when convenient; it is only the pre-load fallback.

Re-run a failed release with **Run workflow** on the tag (the workflow refuses non-tag refs).

## Credentials

The release job needs no object-storage credential. The image push and the GitHub release use the
job's `GITHUB_TOKEN` (`contents: write`, `packages: write`). All builds run on GitHub-hosted runners.

## Making the image public

A package created by the workflow starts private and GitHub's API cannot change that. Run
`scripts/ghcr-make-public.sh` to see the current visibility; if it is private it prints the single
manual step (Package settings, Danger Zone, Change visibility, Public). It only has to be done once.
Verify with a logged-out Docker config:

```sh
DOCKER_CONFIG=$(mktemp -d) docker pull ghcr.io/thomasmcfarlane/playarr-server:latest
```
