# Releasing Playarr

One workflow, `.github/workflows/release.yml` (Actions > **Release**), releases every app from a
single trigger and publishes one GitHub Release `v<version>`.

## Cutting a release

1. In a PR, bump the version that is committed in the tree and merge it through the merge train:
   - `backend/Cargo.toml` (`[package]` and `[workspace.package]`), `backend/Cargo.lock` (the
     `playarr-*` entries) and `[server] version` in `backend/config/client-compatibility.toml`;
   - `clients/android/version.properties`;
   - the Google Play notes `clients/android/fastlane/metadata/android/{en-GB,en-US}/changelogs/<version>.txt`
     (1 to 500 characters).
2. Run **Release** on `main` with `version` = `X.Y.Z`; the run creates the `vX.Y.Z` tag together with
   the release. There is no tag trigger: the signing environments admit only `main`. Use `dry_run` first
   if anything in the release path changed: it builds and signs everything but pushes no image,
   creates no release and uploads nothing to a store.

The version must be newer than the latest `v*` release and must not exist yet. Release version tags are
applied by the multi-arch server publisher; the regional publisher uses immutable commit SHA tags.

## What it does

| Job | Workflow | Output |
|---|---|---|
| Server | `backend-release.yml` | `playarr-server-<version>-linux-{amd64,arm64}.tar.gz` (+ `.sha256`), `playarr-server-<version>-SHA256SUMS`, `latest.json`; image `ghcr.io/<owner>/playarr:<version>` and `:latest` |
| Regional image | `regional-image.yml` | `ghcr.io/<owner>/playarr:<sha8>` |
| Android APK | `android-ci.yml` | signed sideload `playarr-android.apk` and its update manifest `playarr-android.json` |
| TV packages | `tv-web-ci.yml` | `playarr-webos-<version>.ipk`, `playarr-tizen-<version>-unsigned.zip` (Tizen package root; a `.wgt` needs the owner's Samsung certificate profile) |
| Roku | inline | `playarr-roku-<version>.zip` (sideload channel) |
| Xbox | `xbox-ci.yml` | `playarr-xbox-<version>-x64-unsigned.appx` (no signing certificate yet) |
| HarmonyOS | `harmony-ci.yml` | `playarr-harmony-<version>-unsigned.hap` (no AppGallery signing material yet) |
| GitHub Release | inline | release `v<version>` with every package above, a combined `SHA256SUMS` and `playarr-<version>-CHANGELOG.md` |
| Google Play | `android-play-internal.yml` | closed-testing (alpha) track, after the release exists |
| TestFlight | `ios-release.yml` | iOS and tvOS builds, after the release exists |
| Summary | inline | per-platform result table in the run summary |

The server and the Android APK are required: without them no release is created. Any other platform
that fails is left out of the release and marked in the summary. VIDAA uses the hosted Web App
(`docs/clients/vidaa.md`), so it has no package. The per-platform workflows still run on their own
tags (`backend-v*`, `android-v*`, `ios-v*`, `harmony-v*`, `xbox-v*`, `tv-web-v*`) when a single
platform needs a release of its own.

Release notes come from `scripts/release-notes.mjs`: the `## [Unreleased]` entries of `CHANGELOG.md`
that were not already there at the previous `v*` tag. The GitHub Release body is a short summary
(`--summary`: a few entries per category, a count of the rest, and the artefact table); the full notes
are attached to the release as `playarr-<version>-CHANGELOG.md`, which keeps the body inside GitHub's
125,000-character limit.

## Version numbers

| Platform | Version | Build number |
|---|---|---|
| Server, webOS, Tizen, Roku, Xbox, HarmonyOS | `X.Y.Z` | Roku `build_version` = patch; Xbox `X.Y.Z.0`; HarmonyOS `versionCode` = 1000000 + X·10⁶ + Y·10³ + Z |
| Android sideload (`io.playarr.mobile`) | `X.Y.Z` | `versionCode` = X·10⁶ + Y·10³ + Z |
| Google Play (`app.playarr.mobile`) | `X.Y.Z` | `versionCode` = (X·10⁴ + Y·10² + Z)·10⁵ + commit count, so it stays above the per-commit builds `main` publishes |
| iOS and tvOS | `X.Y.Z` | `<commit count>.<run attempt>`, above every earlier TestFlight build |

## Downloads

`https://playarr.app/downloads/...` (the Worker, `clients/tv-web/web/worker.js`) serves every client
download from GitHub Releases only; see the table in `docs/deployment/playarr-cloudflare.md`.

## Credentials

Signing material lives in the `release-android` and `release-ios` environments, whose deployment
policies admit `main` (and the per-platform tags). Images and the release use the run's `GITHUB_TOKEN`. Container
packages created by this repository's workflows are linked to it and public.
