#!/usr/bin/env node
// Capture the Roku parity screens from a physical device (dev installer screenshot endpoint) in the
// layout diff.mjs reads:   <out>/tv/<theme>/<screen-id>.png   (1920x1080)
//
//   ROKU_DEV_TARGET=<ip> ROKU_DEV_PASSWORD=<dev password> node scripts/parity/roku/capture.mjs <out-dir> [dark|light] [screen-id ...]
//   node scripts/parity/diff.mjs --ref docs/parity/web --cand <out-dir> --layout tv --theme dark --mask-rect 470,60,260,40
//
// Needs: the sideloaded channel (clients/roku `make deploy`), signed in as the fixture viewer (the profile name must read
// "Fixture Viewer") against a FRESH fixture server (scripts/fixtures/up.sh --fresh), curl and ffmpeg on PATH.
// The device only serves JPEG screenshots; they are converted to PNG with ffmpeg inside a memory scope.
// The shell clock cannot be frozen on a Roku, so the clock rectangle is masked in the diff (--mask-rect above).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const [out, theme = "dark", ...only] = process.argv.slice(2);
const target = process.env.ROKU_DEV_TARGET;
const password = process.env.ROKU_DEV_PASSWORD;
if (!out || !target || !password) {
  console.error("usage: ROKU_DEV_TARGET=<ip> ROKU_DEV_PASSWORD=<pw> capture.mjs <out-dir> [dark|light] [screen-id ...]");
  process.exit(2);
}
const dest = join(out, "tv", theme);
mkdirSync(dest, { recursive: true });
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const ecp = async (path) => { spawnSync("curl", ["-s", "-X", "POST", `http://${target}:8060/${path}`], { stdio: "ignore" }); };
const press = async (key, wait = 1.3) => { await ecp(`keypress/${key}`); await sleep(wait); };
const presses = async (keys, wait) => { for (const k of keys) await press(k, wait); };
const typeText = async (text) => {
  for (const ch of text) await ecp(`keypress/Lit_${encodeURIComponent(ch)}`);
  await sleep(1);
};

// Cold start: Home exits the dev channel, launch starts it again at the profile picker.
async function coldStart() {
  await press("Home", 4);
  await ecp("launch/dev");
  await sleep(9);
}
const toHome = async () => { await coldStart(); await press("Select", 10); };
const dock = async (downs) => { await press("Up"); await presses(Array(downs).fill("Down"), 0.8); await press("Select", 8); };

const screens = {
  "profile-switcher": async () => { await coldStart(); },
  home: async () => { await toHome(); },
  series: async () => { await toHome(); await dock(2); },
  movies: async () => { await toHome(); await dock(3); },
  "series-detail": async () => { await toHome(); await press("Select", 9); },
  "film-detail": async () => { await toHome(); await dock(3); await press("Select", 9); }, // first film of the A-Z library
  search: async () => { await toHome(); await press("Up"); await press("Select", 3); },
};

function shoot(id) {
  const jpg = join(dest, `${id}.jpg`);
  const png = join(dest, `${id}.png`);
  const dig = ["--digest", "-u", `rokudev:${password}`, "--silent", "--show-error"];
  execFileSync("curl", [...dig, "-F", "mysubmit=Screenshot", "-F", "passwd=", `http://${target}/plugin_inspect`], { stdio: "ignore" });
  execFileSync("curl", [...dig, "-o", jpg, `http://${target}/pkgs/dev.jpg?time=${Date.now()}`]);
  const r = spawnSync("systemd-run", ["--user", "--scope", "-q", "-p", "MemoryHigh=2G", "-p", "MemoryMax=3G", "-p", "MemorySwapMax=0", "--",
    "timeout", "120", "ffmpeg", "-threads", "2", "-y", "-v", "error", "-i", jpg, "-frames:v", "1", png], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${id}`);
  rmSync(jpg);
}

for (const id of Object.keys(screens)) {
  if (only.length && !only.includes(id)) continue;
  console.log(`capturing ${id} (${theme})`);
  await screens[id]();
  shoot(id);
}
