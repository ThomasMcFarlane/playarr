import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { legacyTvCssPlugin } from "../../tooling/legacy-tv-css.mjs";

// This shell's own version, baked into the bundle at build time and read
// back at runtime as `__APP_VERSION__` -- see `src/index.tsx` and
// `@streamarr-tv/ui-tv`'s `TvApp` "check on launch" version-check banner.
const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

// Tizen packages a directory of static assets into a .wgt and serves them
// from the device's local filesystem -- relative asset paths (`base: "./"`)
// are required. The supported Tizen 7 floor uses Chromium 94, so JavaScript
// and CSS output must remain within that engine's syntax/capability baseline.
export default defineConfig({
  base: "./",
  publicDir: "../../web/public",
  plugins: [legacyTvCssPlugin(), react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __PLAYARR_PLATFORM__: JSON.stringify("tv-tizen"),
  },
  build: {
    outDir: "dist",
    target: "es2018",
    cssTarget: "chrome94",
  },
});
