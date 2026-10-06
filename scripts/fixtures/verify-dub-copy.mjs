#!/usr/bin/env node
// Live check of rows 197 and 198: selecting a dub (or another source audio
// track) at original quality copies the source video into fragmented-MP4 HLS
// and encodes only the audio; a client that does not report the codec, or a
// file above the client's bitrate cap, takes the transcode path; and the
// Dubarr key never reaches ffmpeg's argv. Run it against a fixture server on
// the same host (it reads the process list).
// Usage: verify-dub-copy.mjs [server-url]
// Tip: start the server with PLAYARR_TRANSCODE_MAX_CONCURRENT_JOBS=4 (the checks leave
// sessions of several titles running), and generate media with
// PLAYARR_FIXTURE_CLIP_SECONDS=600 PLAYARR_FIXTURE_DUB_SECONDS=40 to also exercise a dub
// much shorter than the film (the HLS must still cover the whole film).
import { execSync } from "node:child_process";
import { login } from "./api.mjs";
import { FIXTURE_PASSWORD, MOVIES } from "./catalog.mjs";

const base = process.argv[2] ?? `http://127.0.0.1:${process.env.PLAYARR_FIXTURE_PORT ?? 18484}`;
const STUB_KEY = "fixture-stub-key";
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { api } = await login(base, "fx-viewer", FIXTURE_PASSWORD);
const cat = await api.get("/api/v1/catalog?limit=100");
const fileOf = async (title) => {
  const it = (cat.items ?? []).find((x) => x.title === title);
  return (await api.get(`/api/v1/catalog/${it.id}`)).media_file_id;
};

// Negotiates the default track, then selects `pick(tracks)`; returns the info and the ffmpeg argv seen meanwhile.
async function select(title, caps, pick) {
  const fid = await fileOf(title);
  const q = `containers=mp4&audio_codecs=aac&ignore_saved_preferences=true${caps}`;
  const first = await api.get(`/api/v1/playback/${fid}?${q}`);
  const track = pick(first.audio_tracks);
  const argvs = new Set();
  let polling = true;
  const poll = (async () => {
    while (polling) {
      for (const l of execSync("ps -eo args | grep '[f]fmpeg ' || true").toString().split("\n")) if (l.includes("-hls_time")) argvs.add(l);
      await sleep(50);
    }
  })();
  const pb = await api.get(`/api/v1/playback/${fid}?${q}&audio_stream_index=${track.stream_index}`);
  let text = "";
  for (let i = 0; i < 120; i++) {
    const r = await api.raw("GET", pb.url);
    text = r.text;
    if (r.status === 200 && text.includes("#EXTINF")) break;
    await sleep(250);
  }
  polling = false;
  await poll;
  const mine = [...argvs].filter((l) => l.includes(pb.url.split("/")[5]));
  return { pb, text, argv: mine.join("\n") };
}

const dub = (tracks) => tracks.find((t) => t.id.startsWith("dubarr-"));
const movieA = MOVIES[0].title;
const hevcMovie = MOVIES.find((m) => m.files?.[0]?.codec === "hevc" || m.codec === "hevc")?.title ?? MOVIES[1].title;

console.log("== H.264 client, dub, original quality");
let r = await select(movieA, "&video_codecs=h264", dub);
check(r.pb.selected_audio_track_id?.startsWith("dubarr-") && r.pb.selected_quality_id === "original", "dub selected at original quality");
check(r.argv.includes("-c:v copy") && !r.argv.includes("libx264") && r.argv.includes("-c:a aac"), "ffmpeg copies the video and encodes only audio");
check(r.text.includes("init.mp4") && r.text.includes(".m4s"), "fragmented-MP4 HLS (init.mp4 + .m4s segments)");
check(!r.argv.includes(STUB_KEY), "the Dubarr key is not in ffmpeg's argv");

console.log("\n== HEVC client, source audio track, original quality");
r = await select(hevcMovie, "&video_codecs=h264,hevc", (t) => t.find((x) => !x.is_default && !x.id.startsWith("dubarr-")));
check(r.argv.includes("-c:v copy -tag:v hvc1"), "HEVC video copied with the hvc1 tag");
check(r.text.includes("init.mp4"), "fragmented-MP4 HLS");

console.log("\n== client that does not report the codec");
r = await select(movieA, "", dub);
check(r.argv.includes("-c:v libx264") && !r.argv.includes("-c:v copy"), "falls back to a video transcode");

console.log("\n== file above the client's bitrate cap");
r = await select(movieA, "&video_codecs=h264&max_bitrate_bps=1000", dub);
check(r.argv.includes("-c:v libx264") && !r.argv.includes("-c:v copy"), "falls back to a video transcode");

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
