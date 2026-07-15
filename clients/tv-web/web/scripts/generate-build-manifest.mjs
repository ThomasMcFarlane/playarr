#!/usr/bin/env node
/**
 * Regenerates `public/build-manifest.json` -- the CDN-hosted "build
 * manifest" this app's own OTA update flow polls (see
 * `src/lib/appUpdate.ts` and `@streamarr-tv/domain`'s `fetchBuildManifest`),
 * per `docs/architecture/clients/web.md#self-update--ota-mechanism`.
 *
 * `bundleVersion` is sourced straight from `package.json`'s own `version`
 * so it can never drift out of sync with what actually got built -- run
 * before every build (see the `build` script in `package.json`). Vite
 * copies everything under `public/` into `dist/` as-is, so this is what
 * ends up served at the well-known `/build-manifest.json` path once
 * deployed behind a real CDN; a production deploy pipeline outside this
 * client repo is what actually publishes a *new* one per release, this
 * script only keeps the local dev/build copy honest.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(readFileSync(`${rootDir}/package.json`, "utf-8"));

const manifest = {
  bundleVersion: packageJson.version,
  generatedAt: new Date().toISOString(),
};

writeFileSync(`${rootDir}/public/build-manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote public/build-manifest.json (bundleVersion: ${manifest.bundleVersion})`);
