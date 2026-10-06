# ==============================================================================
# Playarr Server / Playarr monorepo task runner.
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
# The only Android project. It contains one responsive application module and
# its internal core modules, and produces one phone/tablet/TV APK.
android_dir := "clients/android"
ios_dir := "clients/ios"
xbox_dir := "clients/xbox"
# Native HarmonyOS NEXT (ArkTS/ArkUI) client: one HAP covering phone,
# tablet/foldable and Huawei Vision TV, chosen at runtime from
# deviceInfo.deviceType (playarr_model::ClientPlatform's HarmonyMobile /
# HarmonyTv variants).
harmony_dir := "clients/harmony"
infra_dir := "infra"
scripts_dir := "scripts"

# Docker Compose file for the local dev stack (Playarr Server + the *arr apps +
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
# Backend (Playarr Server core -- Rust workspace under backend/)
# ------------------------------------------------------------------------

# Static checks for the backend: fmt --check, clippy (warnings denied).
backend-check:
    cd {{backend_dir}} && cargo fmt --all -- --check
    cd {{backend_dir}} && cargo clippy --workspace --all-targets --all-features -- -D warnings
    cd {{backend_dir}} && cargo check --workspace --all-targets

# Run the full backend test suite.
backend-test:
    cd {{backend_dir}} && cargo test --workspace --all-features

# Run the Playarr Server locally, e.g. `just backend-run -- --port 9000`.
backend-run *ARGS:
    cd {{backend_dir}} && cargo run --bin playarr-server -- {{ARGS}}

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
    cd {{tv_web_dir}} && pnpm install --frozen-lockfile && pnpm --filter @playarr-tv/web run deploy:cloudflare

# Build the Chromecast custom web receiver in isolation (see
# clients/tv-web/apps/cast-receiver/README.md to test it standalone with the
# Cast Command & Control tool before touching any sender).
cast-receiver-build:
    cd {{tv_web_dir}} && pnpm install --frozen-lockfile && pnpm --filter @playarr-tv/app-cast-receiver run build

# ------------------------------------------------------------------------
# Playarr native clients
# ------------------------------------------------------------------------

# Target a single module/variant instead of the default, e.g.
# `just android-build :app:assembleRelease`.

# Build the single Android phone/tablet/TV application.
android-build TASK="assembleDebug":
    cd {{android_dir}} && ./gradlew {{TASK}}

# clients/ios/ is a source-only SwiftPM package today (no Xcode project yet
# -- see clients/ios/Package.swift), so this runs `swift build` rather than
# `xcodebuild`: it type-checks and builds the PlayarrApp executable target
# with just the Swift toolchain (Xcode Command Line Tools are enough), but
# does not produce a signed, installable .app -- that needs an Xcode project
# wrapping this package, and full Xcode (not just the CLT). Once that
# project exists, swap this recipe for:
#   xcodebuild -scheme PlayarrApp -configuration Debug \
#     -destination "generic/platform=iOS Simulator" build

# Build iOS (SwiftPM type-check/build; see comment above for the Xcode gap).
ios-build:
    cd {{ios_dir}} && swift build

# clients/xbox/ is a .NET solution (Playarr.Xbox.sln) split into a portable
# core library (src/Playarr.Core, netstandard2.0) and its UWP application
# head (src/Playarr.Xbox, TargetPlatformIdentifier=UAP). Only Playarr.Core
# is buildable/testable here: it's a plain netstandard2.0 class library, so
# the `dotnet` CLI on Linux is enough. The UWP head needs MSBuild, the
# Windows 10 SDK, and Visual Studio's UWP workload -- none of which exist in
# this environment (or on Linux at all) -- so these recipes deliberately
# scope to Playarr.Core's csproj rather than the .sln.

# Build the portable Xbox client core (Playarr.Core only; see comment above).
xbox-core-build:
    cd {{xbox_dir}} && dotnet build src/Playarr.Core/Playarr.Core.csproj

# Test the portable Xbox client core (Playarr.Core only; see comment above).
xbox-core-test:
    cd {{xbox_dir}} && dotnet test tests/Playarr.Core.Tests/Playarr.Core.Tests.csproj

# clients/harmony/ is a native ArkTS/ArkUI HarmonyOS NEXT project. There is
# no HarmonyOS SDK on this machine by default, so most of these recipes are
# tiered: harmony-validate/harmony-test run with only Node (no SDK, no
# device, seconds); harmony-sdk/harmony-build need the real OpenHarmony SDK
# and Command Line Tools, fetched on demand; harmony-deploy needs a
# connected device over hdc. See clients/harmony/README.md for the full
# tier breakdown and what each one genuinely verifies.

# Offline structural + contract validation for the HarmonyOS client (no SDK).
harmony-validate:
    cd {{harmony_dir}} && node scripts/validate.mjs

# Unit-test the HarmonyOS client's pure-logic core (no SDK, no device).
harmony-test:
    cd {{harmony_dir}} && npm ci --prefix tools && node tools/run-core-tests.mjs

# Download and unpack the OpenHarmony SDK + Command Line Tools (Linux).
harmony-sdk:
    cd {{harmony_dir}} && bash scripts/fetch-sdk.sh

# Compile the HarmonyOS HAP. Requires `just harmony-sdk` once first.
harmony-build MODE="debug":
    cd {{harmony_dir}} && bash scripts/build.sh {{MODE}}

# Sideload the built HAP to a connected device (HDC_TARGET env var).
harmony-deploy:
    cd {{harmony_dir}} && bash scripts/deploy.sh

# ------------------------------------------------------------------------
# Local dev environment (Docker Compose stack: Playarr Server + Sonarr/Radarr/
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
