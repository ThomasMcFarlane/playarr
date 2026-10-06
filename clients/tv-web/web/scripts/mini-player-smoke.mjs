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
const context = await browser.newContext({
  viewport: tv ? { width: 1920, height: 1080 } : { width: 1280, height: 800 },
  hasTouch: true,
});
const page = await context.newPage();
const q = tv ? "?platform=tv-vidaa" : "";
try {
  await page.goto(`${base}/login${q}`);
  await page.fill("#login-username", user);
  await page.fill("#login-password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  // The fixture clip is only 6 s; a heavily loaded host can hand back a truncated
  // stream, so retry the load until the stream is long enough to test against.
  for (let attempt = 1; ; attempt++) {
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
    const long = await page
      .waitForFunction(() => document.querySelector("video.player-video").duration > 4.5, null, { timeout: 3000 })
      .then(() => true, () => false);
    if (long) break;
    if (attempt >= 5) throw new Error("stream stayed shorter than 4.5 s after 5 loads");
    console.log(`note: truncated stream (attempt ${attempt}), reloading`);
  }
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

  // Chrome layout: X close at the top right, minimise to its left, no top-left back.
  const chrome = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom };
    };
    return {
      close: rect(".player-close"),
      minimise: rect(".player-minimise"),
      back: document.querySelector(".player-back"),
      closeLabel: document.querySelector(".player-close")?.getAttribute("aria-label"),
      w: innerWidth,
      quality: document.querySelector(".player-quality-button")?.textContent,
    };
  });
  console.log(JSON.stringify(chrome));
  check(chrome.back === null, "no top-left back control");
  check(chrome.closeLabel === "Close player", "close button is labelled Close player");
  check(chrome.close && chrome.close.r > chrome.w * 0.9 && chrome.close.t < 120, "X close sits at the top right");
  check(chrome.minimise && chrome.close && chrome.minimise.r <= chrome.close.l && chrome.minimise.l > chrome.w / 2, "minimise sits to the left of the X, on the right half");
  check(/^Original/.test((chrome.quality ?? "").trim()) || /Original/.test(chrome.quality ?? ""), `quality label reads Original (${(chrome.quality ?? "").trim()})`);

  // Reveal-only: with the controls hidden a click must not pause.
  const freshPlayer = async () => {
    await page.goto(`${base}/player/${fileId}${q}`);
    await page.waitForFunction(() => {
      const v = document.querySelector("video.player-video");
      return v && v.readyState >= 3 && v.currentTime > 0.3 && !v.paused;
    }, null, { timeout: 90000 });
    await page.evaluate(() => {
      const v = document.querySelector("video.player-video");
      window.__video = v;
      window.__events = [];
      for (const e of ["emptied", "loadstart", "abort", "seeking"]) v.addEventListener(e, () => window.__events.push(e));
      window.__t0 = v.currentTime;
    });
  };
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
      ended: v.ended,
      duration: v.duration,
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
  // Reveal-only (each case on a fresh load so the short clip is still playing).
  await freshPlayer();
  await page.waitForSelector(".player-shell-idle", { timeout: 15000 }).catch(async (e) => {
    console.log("debug", JSON.stringify(await page.evaluate(() => ({ t: window.__video.currentTime, paused: window.__video.paused, ended: window.__video.ended, d: window.__video.duration, shell: document.querySelector(".player-shell")?.className }))));
    throw e;
  });
  // A tap (no preceding mouse-move that would reveal the controls first).
  await page.touchscreen.tap(chrome.w / 2, 300);
  await page.waitForTimeout(300);
  const afterReveal = await page.evaluate(() => ({
    paused: window.__video.paused,
    idle: Boolean(document.querySelector(".player-shell-idle")),
  }));
  console.log("afterReveal", JSON.stringify(afterReveal));
  check(!afterReveal.paused && !afterReveal.idle, "tap with hidden controls only reveals them (still playing)");
  await freshPlayer();
  await page.waitForSelector(".player-shell-idle", { timeout: 15000 });
  await page.evaluate(() => document.querySelector("video.player-video").focus());
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const afterEnter = await page.evaluate(() => ({
    paused: window.__video.paused,
    idle: Boolean(document.querySelector(".player-shell-idle")),
  }));
  check(!afterEnter.paused && !afterEnter.idle, "Enter/OK with hidden controls only reveals them (still playing)");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__video.paused), "Enter/OK with visible controls toggles pause");
  await page.keyboard.press(" ");
  await page.waitForTimeout(300);
  check(await page.evaluate(() => !window.__video.paused), "Space toggles directly");

  await page.screenshot({ path: join(out, `${tv ? "tv" : "desktop"}-1-full.png`) });

} catch (error) {
  check(false, `script error: ${error.message}`);
  await page.screenshot({ path: join(out, `${tv ? "tv" : "desktop"}-error.png`) }).catch(() => {});
} finally {
  await browser.close();
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
