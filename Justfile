# ==============================================================================
# Streamarr / Playarr monorepo task runner.
#
# Install `just`: https://github.com/casey/just (`brew install just`).
# Run `just --list` to see every recipe with its one-line description.
#
# This file defines the STABLE CROSS-COMPONENT INTERFACE for building,
# testing, and running each piece of the monorepo. Recipes shell out to
# each component's own toolchain (cargo, pnpm, gradle, xcodebuild, docker
# compose). Some of those components are still under active development by
# other contributors/agents in parallel -- that's fine, this file documents
# the contract each component is expected to satisfy (script/binary names,
# working directories) even before every piece exists on disk. If a
# component moves its scripts, update the paths/variables below rather than
# the recipe names, so the interface contributors and CI rely on stays
# stable.
# ==============================================================================

set shell := ["bash", "-euo", "pipefail", "-c"]

# --- Component locations (single source of truth for paths used below) -----

backend_dir := "backend"
tv_web_dir := "clients/tv-web"
# The Android Gradle root lives in android-shared/ (not a top-level
# clients/android/): it declares the shared core-* library modules directly
# and pulls in clients/mobile-android/ as the single responsive application
# module by relative projectDir, since app-module source is out of this
# Gradle root's own directory tree. See
# clients/android-shared/settings.gradle.kts for why.
android_dir := "clients/android-shared"
ios_dir := "clients/ios"
infra_dir := "infra"
scripts_dir := "scripts"

# Docker Compose file for the local dev stack (Streamarr + the *arr apps +
# Tdarr). Owned by the Docker infra scaffolding; update this path if it
# lands somewhere else.
dev_compose_file := infra_dir + "/docker/docker-compose.dev.yml"

# Seed script for local dev data (sample libraries, admin user, API keys).
# Owned by the dev-scripts scaffolding; update this path if it lands
# somewhere else.
dev_seed_script := scripts_dir + "/dev-seed.sh"

# List every available recipe.
default:
    @just --list

# ------------------------------------------------------------------------
# Backend (Streamarr core -- Rust workspace under backend/)
# ------------------------------------------------------------------------

# Static checks for the backend: fmt --check, clippy (warnings denied).
backend-check:
    cd {{backend_dir}} && cargo fmt --all -- --check
    cd {{backend_dir}} && cargo clippy --workspace --all-targets --all-features -- -D warnings
    cd {{backend_dir}} && cargo check --workspace --all-targets

# Run the full backend test suite.
backend-test:
    cd {{backend_dir}} && cargo test --workspace --all-features

# Run the Streamarr server locally, e.g. `just backend-run -- --port 9000`.
backend-run *ARGS:
    cd {{backend_dir}} && cargo run --bin streamarr -- {{ARGS}}

# ------------------------------------------------------------------------
# Playarr tv-web client: browser Web, the hosted Hisense VIDAA Web App, and
# packaged LG webOS/Samsung Tizen shells over shared TypeScript code.
# ------------------------------------------------------------------------

# Start the tv-web dev server with hot reload.
tv-web-dev:
    cd {{tv_web_dir}} && pnpm install --frozen-lockfile && pnpm run dev

# Build production bundles for Web/hosted VIDAA, webOS, Tizen, and the legacy
# experimental VIDAA shell.
tv-web-build:
    cd {{tv_web_dir}} && pnpm install --frozen-lockfile && pnpm run build

# Build and deploy the standalone Playarr Web app to playarr.app.
playarr-deploy:
    cd {{tv_web_dir}} && pnpm install --frozen-lockfile && pnpm --filter @streamarr-tv/web run deploy:cloudflare

# ------------------------------------------------------------------------
# Playarr native clients
# ------------------------------------------------------------------------

# Target a single module/variant instead of the default, e.g.
# `just android-build :mobile-android:assembleRelease`.

# Build the single Android phone/tablet/TV application.
android-build TASK="assembleDebug":
    cd {{android_dir}} && ./gradlew {{TASK}}

# clients/ios/ is a source-only SwiftPM package today (no Xcode project yet
# -- see clients/ios/Package.swift), so this runs `swift build` rather than
# `xcodebuild`: it type-checks and builds the StreamarrApp executable target
# with just the Swift toolchain (Xcode Command Line Tools are enough), but
# does not produce a signed, installable .app -- that needs an Xcode project
# wrapping this package, and full Xcode (not just the CLT). Once that
# project exists, swap this recipe for:
#   xcodebuild -scheme StreamarrApp -configuration Debug \
#     -destination "generic/platform=iOS Simulator" build

# Build iOS (SwiftPM type-check/build; see comment above for the Xcode gap).
ios-build:
    cd {{ios_dir}} && swift build

# ------------------------------------------------------------------------
# Local dev environment (Docker Compose stack: Streamarr + Sonarr/Radarr/
# Lidarr/Bazarr/Prowlarr/Readarr + Tdarr)
# ------------------------------------------------------------------------

# Bring up the full local dev stack in the background.
dev-up:
    docker compose -f {{dev_compose_file}} up -d

# Tear the local dev stack down.
dev-down:
    docker compose -f {{dev_compose_file}} down

# Tail logs for the local dev stack.
dev-logs:
    docker compose -f {{dev_compose_file}} logs -f

# Seed the local dev stack with sample libraries/config.
dev-seed:
    bash {{dev_seed_script}}
