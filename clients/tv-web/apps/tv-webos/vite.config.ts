import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { legacyTvCssPlugin } from "../../tooling/legacy-tv-css.mjs";

// Keep the native package and the web runtime on one release number. The
// package-preparation step independently rejects a version mismatch between
// package.json and appinfo.json so an IPK can never report a different version
// from the bundle that it runs.
const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

// webOS packages a directory of static assets (via `ares-package`) and
// serves them from the device's local filesystem, not from a URL root --
// relative asset paths (`base: "./"`) are required for icons/scripts to
// resolve once installed on the TV.
export default defineConfig({
  base: "./",
  plugins: [legacyTvCssPlugin(), react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __PLAYARR_PLATFORM__: JSON.stringify("tv-webos"),
  },
  build: {
    outDir: "dist",
    // webOS 23 is the supported developer-package floor. Its Chromium runtime
    // supports the full Playarr/Shaka bundle; es2018 keeps our own output
    // conservative without claiming compatibility with untested older TVs.
    target: "es2018",
    cssTarget: "chrome94",
  },
});
