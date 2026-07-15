import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// This shell's own version, baked into the bundle at build time and read
// back at runtime as `__APP_VERSION__` -- see `src/index.tsx` and
// `@streamarr-tv/ui-tv`'s `TvApp` "check on launch" version-check banner.
const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

// Tizen packages a directory of static assets into a .wgt and serves them
// from the device's local filesystem -- relative asset paths (`base: "./"`)
// are required. Tizen's legacy WebKit runtime (Tizen 4.x/5.x TVs) does not
// reliably support the newest ECMAScript syntax, hence the conservative
// build target.
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    outDir: "dist",
    target: "es2018",
  },
});
