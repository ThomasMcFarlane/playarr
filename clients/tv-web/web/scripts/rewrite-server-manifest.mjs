// After `vite build --mode server`: the PWA manifest must start and scope at /tv/ (not the server's root).
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../dist-server/playarr.webmanifest", import.meta.url);
const manifest = JSON.parse(readFileSync(path, "utf-8"));
manifest.start_url = "/tv/";
manifest.scope = "/tv/";
manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: icon.src.replace(/^\//, "/tv/") }));
writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
