# Playarr Server releases

Playarr Server is published as build artefacts only. The source repository is private;
nothing in a release links to it.

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
   the image, and uploads the tarballs and checksums to the private R2 bucket
   `playarr-client-downloads` under `server/releases/<version>/`. Stable releases also refresh the
   `server/playarr-server-linux-<arch>.tar.gz` aliases and `server/latest.json`; pre-releases do not,
   and do not get the `latest` image tag.
4. The Worker (`clients/tv-web/web/worker.js`) serves those keys same-origin under
   `/downloads/server/`, the same way as the Android APK. Versioned paths are immutable and cached for
   a year; aliases and the manifest for five minutes. The Clients hub page `/clients/server` shows the
   buttons and reads the manifest for the version and checksums. Bump `SERVER_FALLBACK_VERSION` in
   `Clients.tsx` when convenient; it is only the pre-load fallback.

Re-run a failed release with **Run workflow** on the tag (the workflow refuses non-tag refs).

## Credentials

The upload step runs in the `release-android` environment (where the Cloudflare account ID lives)
and needs `CLOUDFLARE_R2_API_TOKEN` there (Workers R2 Storage Edit). The Workers deploy token
`CLOUDFLARE_API_TOKEN` has no R2 access, so it is not used. Until the secret exists the step prints a
warning and skips; upload by hand from the workflow's `playarr-server-dist` artefact with
`scripts/upload-server-release.sh <dist-dir> <version>` (it uses `wrangler`, so a `wrangler login` plus
`CLOUDFLARE_ACCOUNT_ID` is enough), or add the secret with `scripts/server-release-owner-setup.sh` and
re-run the workflow on the tag. The image push uses the job's `GITHUB_TOKEN` (`packages: write`). All
builds run on GitHub-hosted runners.

## Making the image public

A package created by the workflow starts private and GitHub's API cannot change that. Run
`scripts/ghcr-make-public.sh` (or `scripts/server-release-owner-setup.sh`) to see the current visibility; if it is private it prints the single
manual step (Package settings, Danger Zone, Change visibility, Public). It only has to be done once.
Verify with a logged-out Docker config:

```sh
DOCKER_CONFIG=$(mktemp -d) docker pull ghcr.io/thomasmcfarlane/playarr-server:latest
```
