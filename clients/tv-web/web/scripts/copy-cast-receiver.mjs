#!/usr/bin/env node
/**
 * Copies the built Chromecast receiver app (`apps/cast-receiver/dist`) into
 * this app's `dist/cast/` so `worker.js` can serve it at `/cast/` alongside
 * the main web app. Must run AFTER `vite build`, which empties `web/dist`
 * before writing to it -- see the `build` script in `package.json`.
 *
 * Fails loudly if the receiver hasn't been built yet: silently no-op'ing
 * here would let the web app's build "succeed" while quietly shipping no
 * `/cast/` route at all.
 */
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../apps/cast-receiver/dist/", import.meta.url));
const destination = fileURLToPath(new URL("../dist/cast/", import.meta.url));

const sourceStats = await stat(source).catch(() => null);
if (!sourceStats || !sourceStats.isDirectory()) {
  console.error(
    `copy-cast-receiver: ${source} does not exist. Build the cast receiver ` +
      `(apps/cast-receiver) before running this script -- refusing to ship ` +
      `a web build with no /cast/ route.`
  );
  process.exit(1);
}

await rm(destination, { force: true, recursive: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
console.log(`Copied cast receiver from ${source} to ${destination}`);
