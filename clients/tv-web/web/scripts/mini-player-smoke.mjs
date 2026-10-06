#!/usr/bin/env node
// Headless check that the in-app mini player (the Picture-in-Picture fallback)
// keeps the live <video> playing: same element, no reload, no restart, visible,
// and clicking it expands back.
//
//   node scripts/mini-player-smoke.mjs --base http://127.0.0.1:18484 --user fx-viewer \
//     --password <fixture password> --out <dir> [--tv] [--chromium /usr/bin/chromium]
//
// Needs a fixture server (scripts/fixtures/up.sh) that also serves the built web client.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const base = opt("base", "http://127.0.0.1:18484");
const user = opt("user", "fx-viewer");
const password = opt("password", "");
const out = opt("out", ".");
const tv = args.includes("--tv");
const title = opt("title", "Test Movie A");
mkdirSync(out, { recursive: true });

const results = [];
const check = (ok, message) => {
  results.push({ ok, message });
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
};

async function api(path, init, token) {
  const r = await fetch(base + path, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return r.json();
}
const session = await api("/api/v1/auth/login", {
  method: "POST",
  body: JSON.stringify({
    username: user, password, device_id: "6d1f0b9a-3c1e-4c7a-9a55-0c2f6a1b7e11", device_name: "mini-smoke",
    client_platform: "web", client_version: "smoke",
  }),
});
const catalog = await api("/api/v1/catalog?limit=100", {}, session.access_token);
const work = catalog.items.find((w) => w.title === title);
const detail = await api(`/api/v1/catalog/${work.id}`, {}, session.access_token);
const fileId = detail.media_file_id;

const browser = await chromium.launch({
  executablePath: opt("chromium", "/usr/bin/chromium"),
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: tv ? { width: 1920, height: 1080 } : { width: 1280, height: 800 } });
const q = tv ? "?platform=tv-vidaa" : "";
try {
  await page.goto(`${base}/login${q}`);
  await page.fill("#login-username", user);
  await page.fill("#login-password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await page.goto(`${base}/player/${fileId}${q}`);
  await page.waitForSelector("video.player-video", { timeout: 30000 });
  await page.waitForFunction(
    () => {
      const v = document.querySelector("video.player-video");
      return v && v.readyState >= 3 && v.currentTime > 0.3 && !v.paused;
    },
    null,
    { timeout: 90000 }
  );
  // Tag the element and count reload-type events from here on.
  await page.evaluate(() => {
    const v = document.querySelector("video.player-video");
    window.__video = v;
    window.__events = [];
    for (const e of ["emptied", "loadstart", "abort", "seeking"]) {
      v.addEventListener(e, () => window.__events.push(e));
    }
    window.__t0 = v.currentTime;
  });
  check(true, "full player is playing the video");
  await page.screenshot({ path: join(out, `${tv ? "tv" : "desktop"}-1-full.png`) });

  await page.mouse.move(400, 300);
  // Headless Chromium has no PiP window; force the fallback path deterministically.
  await page.evaluate(() => {
    Object.defineProperty(document, "pictureInPictureEnabled", { value: false, configurable: true });
  });
  await page.click(".player-minimise");
  await page.waitForFunction(() => !location.pathname.startsWith("/player/"), null, { timeout: 15000 });
  await page.waitForSelector(".player-page.is-minimised video.player-video");
  const t1 = await page.evaluate(() => window.__video.currentTime);
  await page.waitForTimeout(2000);
  const mini = await page.evaluate(() => {
    const v = document.querySelector(".player-page.is-minimised video.player-video");
    const r = v.getBoundingClientRect();
    const cs = getComputedStyle(v);
    return {
      same: v === window.__video,
      t: v.currentTime,
      paused: v.paused,
      ready: v.readyState,
      w: r.width,
      h: r.height,
      onScreen: r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight,
      visible: cs.visibility === "visible" && cs.display !== "none" && Number(cs.opacity) > 0,
      videoWidth: v.videoWidth,
      events: window.__events.slice(),
    };
  });
  console.log(JSON.stringify(mini));
  await page.screenshot({ path: join(out, `${tv ? "tv" : "desktop"}-2-mini.png`) });
  check(mini.same, "mini player shows the very same <video> element (no second element, no reload)");
  check(mini.w > 40 && mini.h > 40 && mini.onScreen && mini.visible, "mini video is visible and has a real size");
  check(mini.t > t1 + 1 && !mini.paused, "mini video keeps playing (currentTime advanced, not paused)");
  check(mini.videoWidth > 0 && mini.ready >= 3, "mini video holds decoded frames");
  check(mini.events.length === 0, `no emptied/loadstart/abort/seeking after minimise (${mini.events.join(",") || "none"})`);

  await page.click(".mini-player-hit-target");
  await page.waitForFunction(() => location.pathname.startsWith("/player/"), null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const back = await page.evaluate(() => {
    const v = document.querySelector("video.player-video");
    return {
      same: v === window.__video,
      t: v.currentTime,
      paused: v.paused,
      minimised: Boolean(document.querySelector(".player-page.is-minimised")),
      events: window.__events.slice(),
    };
  });
  console.log(JSON.stringify(back));
  await page.screenshot({ path: join(out, `${tv ? "tv" : "desktop"}-3-expanded.png`) });
  check(back.same && !back.minimised, "clicking the mini player expands back with the same <video>");
  check(back.t > mini.t && !back.paused && back.events.length === 0, "playback continued without restart after expanding");
} catch (error) {
  check(false, `script error: ${error.message}`);
  await page.screenshot({ path: join(out, `${tv ? "tv" : "desktop"}-error.png`) }).catch(() => {});
} finally {
  await browser.close();
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
