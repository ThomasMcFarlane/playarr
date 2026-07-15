import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tizen packages a directory of static assets into a .wgt and serves them
// from the device's local filesystem -- relative asset paths (`base: "./"`)
// are required. Tizen's legacy WebKit runtime (Tizen 4.x/5.x TVs) does not
// reliably support the newest ECMAScript syntax, hence the conservative
// build target.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    target: "es2018",
  },
});
