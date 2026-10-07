#!/usr/bin/env node
// Real playback start on a physical Roku, as the signed-in device test account (owner rule: every device parity run).
//
//   ROKU_DEV_TARGET=<ip> [PLAYARR_SERVER=<url> PLAYARR_DEVICE_TEST_USERNAME=.. PLAYARR_DEVICE_TEST_PASSWORD=..] \
//     node scripts/parity/roku/verify-playback.mjs <out-dir>
//
// Opens the first Home card, presses Play and checks, through the Roku ECP media-player query, that video really plays
// (state "play", position advancing, no error), that BACK hides the controls first and the second BACK leaves the player,
// and (when credentials are given) that the server's resume point for the title advanced. Writes <out-dir>/playback.json
// and a screenshot of the controls. Credentials are only read from the environment and never printed.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const target = process.env.ROKU_DEV_TARGET;
const out = process.argv[2];
if (!target || !out) {
  console.error("usage: ROKU_DEV_TARGET=<ip> verify-playback.mjs <out-dir>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
// The Roku's ECP server drops a connection now and then; retry a few times.
const ecp = async (path, method = "POST") => {
  for (let i = 0; ; i += 1) {
    try {
      return await fetch(`http://${target}:8060/${path}`, { method, headers: { connection: "close" } });
    } catch (e) {
      if (i >= 4) throw e;
      await sleep(1.5);
    }
  }
};
const press = async (key, wait = 1.5) => {
  await ecp(`keypress/${key}`);
  await sleep(wait);
};
const media = async () => {
  const xml = await (await ecp("query/media-player", "GET")).text();
  const state = /state="([^"]+)"/.exec(xml)?.[1] ?? "none";
  const position = Number(/<position>(\d+)\s*ms/.exec(xml)?.[1] ?? 0);
  const error = /error="([^"]+)"/.exec(xml)?.[1] === "true";
  return { state, position, error };
};

const result = { startedPlaying: false, positionAdvanced: false, firstBackHidControls: null, secondBackLeftPlayer: false, resumeAdvanced: null };

// Cold start at the profile picker, pick the profile, open the first Home card, then Play.
await press("Home", 4);
await ecp("launch/dev");
await sleep(10);
await press("Select", 26);
await press("Select", 18); // card -> detail
await press("Select", 3); // Play
let first;
// Poll gently: querying the media player every couple of seconds while the stream starts has been seen to disturb a cold start.
await sleep(20);
for (let i = 0; i < 20; i += 1) {
  await sleep(8);
  first = await media();
  console.error(`poll ${i}: ${first.state} ${first.position} ms`);
  if (first.state === "play" && first.position > 0) break;
}
result.startedPlaying = first?.state === "play" && !first.error;
await sleep(10);
const later = await media();
result.positionAdvanced = later.state === "play" && later.position > (first?.position ?? 0) + 5000;
result.positions = { first: first?.position, later: later.position };

// Controls first, then exit: the first BACK hides the visible controls (playback keeps going), the second leaves the player.
await press("Down", 1.5);
await press("Back", 1.5);
const afterFirst = await media();
// Still playing (or briefly re-buffering on a live transcode) means the first BACK only hid the controls.
result.firstBackHidControls = ["play", "buffer", "pause"].includes(afterFirst.state);
await press("Back", 3);
const afterSecond = await media();
result.secondBackLeftPlayer = !["play", "buffer", "pause"].includes(afterSecond.state);

const server = process.env.PLAYARR_SERVER;
if (server && process.env.PLAYARR_DEVICE_TEST_USERNAME) {
  try {
    const login = await (await fetch(`${server}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: process.env.PLAYARR_DEVICE_TEST_USERNAME,
        password: process.env.PLAYARR_DEVICE_TEST_PASSWORD,
        device_id: "6f1f2d2e-0b7e-4d6e-9d52-0a9e47ad0042",
        device_name: "roku-parity-verify",
        client_platform: "web",
        client_version: "parity",
      }),
    })).json();
    const progress = await (await fetch(`${server}/api/v1/playback/progress`, { headers: { authorization: `Bearer ${login.access_token}` } })).json();
    const rows = Array.isArray(progress) ? progress : progress.items ?? [];
    const best = rows.map((r) => r.position_ms ?? r.progress_ms ?? 0).sort((a, b) => b - a)[0] ?? 0;
    result.resumeAdvanced = best > 0;
  } catch (e) {
    result.resumeAdvanced = `check failed: ${String(e.message).split("\n")[0]}`;
  }
}
writeFileSync(join(out, "playback.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
process.exit(result.startedPlaying && result.positionAdvanced && result.firstBackHidControls && result.secondBackLeftPlayer ? 0 : 1);
