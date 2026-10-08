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
// Real libraries load artwork slowly; ROKU_WAIT_SCALE stretches every settle wait (the real account runs use 2).
const waitScale = Number(process.env.ROKU_WAIT_SCALE ?? "1");
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000 * (s > 2 ? waitScale : 1)));
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
// Left from the first rail enters the dock (web TV); Down walks it: Search 0, Home 1, Series 2, Movies 3, Playlists 4,
// Watchlist 5, Requests 6, Calendar 7 (no Sites or Music in the fixture, no Downloads on Roku).
// The real device account also has a Music library, which adds a dock entry before Playlists (ROKU_DOCK_HAS_MUSIC=1).
const hasMusic = process.env.ROKU_DOCK_HAS_MUSIC === "1";
const dock = async (steps, wait = 8) => { const downs = hasMusic && steps >= 4 ? steps + 1 : steps; await press("Left"); await presses(Array(downs).fill("Down"), 0.8); await press("Select", wait); };
// Preferences opens from the profile picker's gear; the section rows are walked with Down and opened with Select.
const settings = async (row) => {
  await coldStart();
  await presses(["Down", "Select"], 2);
  await presses(Array(row).fill("Down"), 0.8);
  if (row > 0) await press("Select", 3);
};

const screens = {
  "profile-switcher": async () => { await coldStart(); },
  // The 4 MB hero image can arrive tens of seconds after Home paints on the relay; give it time before the screenshot.
  home: async () => { await toHome(); await sleep(45); },
  series: async () => { await toHome(); await dock(2); },
  movies: async () => { await toHome(); await dock(3); },
  "series-detail": async () => { await toHome(); await dock(2); await press("Select", 9); }, // first series of the A-Z library
  "film-detail": async () => { await toHome(); await dock(3); await press("Select", 9); }, // first film of the A-Z library
  search: async () => { await toHome(); await dock(0, 3); },
  calendar: async () => { await toHome(); await dock(7, 6); },
  watchlist: async () => { await toHome(); await dock(5, 6); },
  requests: async () => { await toHome(); await dock(6, 6); },
  // The first Home card opens its detail page; Play there starts playback. The video plane screenshots black, so the
  // diff compares only the chrome (screens.json compareRegions, diff.mjs --chrome-only).
  // The first Home card (the most recently watched film; the web reference plays the same file): open it, Play, wait for the
  // stream, pause. The video plane screenshots black, so the diff compares the chrome only (--chrome-only).
  "player-controls": async () => { await toHome(); await presses(["Select", "Select"], 25); await press("play", 2); await press("Down", 2); },
  "player-quality-menu": async () => { await toHome(); await presses(["Select", "Select"], 25); await press("play", 2); await press("Up", 2); },
  // Scrolled states (owner rule): a Home rail several cards in, a library grid several rows down, a long settings panel.
  "home-scrolled": async () => { await toHome(); await press("Down", 2); await presses(Array(7).fill("Right"), 0.8); await sleep(2); },
  "movies-scrolled": async () => { await toHome(); await dock(3, 14); await presses(Array(7).fill("Down"), 0.8); await sleep(3); },
  "settings-player-scrolled": async () => { await settings(3); await press("Right", 1); await presses(Array(11).fill("Down"), 0.7); await sleep(1); },
  settings: async () => { await settings(0); },
  "settings-avatar": async () => { await settings(1); },
  "settings-language": async () => { await settings(2); },
  "settings-player": async () => { await settings(3); },
  "settings-server": async () => { await settings(4); },
  "settings-lock": async () => { await settings(5); },
  "settings-invite": async () => { await settings(6); },
  "settings-latency": async () => { await settings(7); },
  "settings-remote": async () => { await settings(8); },
  "settings-your-data": async () => { await settings(9); },
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

// The theme preference lives in the channel's registry; the profile picker's theme dropdown (System, Light, Dark) sets it.
async function setTheme() {
  await coldStart();
  await press("Up");
  await press("Select", 2);
  await presses(Array(theme === "light" ? 1 : 2).fill("Down"), 0.6);
  await press("Select", 3);
}
await setTheme();

for (const id of Object.keys(screens)) {
  if (only.length && !only.includes(id)) continue;
  console.log(`capturing ${id} (${theme})`);
  await screens[id]();
  shoot(id);
}
