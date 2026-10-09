#!/usr/bin/env node
// "Who's watching?" never shows profiles that are not the current account's, and its tiles never jump.
//   node scripts/profile-picker-e2e.mjs [--dist dir] [--no-build]
// Fixtures only (no live users). The mock directory answers late, so the cold state is on screen long enough to sample.
//  0. Account A has a second saved account that is still valid: its skeleton is replaced by its real tile in place.
//  1. Account A has one stale saved session (an account the server no longer knows). The picker shows a skeleton, then
//     only A's tiles: the stale name never renders, and a tile never moves once it is on screen.
//  2. A signs out and account B signs in. No tile of A renders on B's picker at any frame, the directory cache of A is
//     gone, and B's tiles keep their place from the skeleton to the real tile.
//  3. A returning visit for B paints B's cached tiles at once and the fresh answer changes nothing visible.
import { boot, USER_ID } from "./e2e-common.mjs";

const { browser, check, finish, server } = await boot({});
const base = `http://127.0.0.1:${server.port}`;
const ID_B = "00000000-0000-4000-8000-0000000000bb";
const DELAY_MS = 900;
let staleStillKnown = true;
const NAMES = { [USER_ID]: "Fixture Ann", [ID_B]: "Fixture Ben" };
const STALE = { id: "00000000-0000-4000-8000-0000000000dd", name: "Fixture Stale" };
// The app names the signed-in account from the `sub` claim of the access token, so the fixtures issue JWT-shaped tokens.
const jwtFor = (userId) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: userId, exp: Math.floor(Date.now() / 1000) + 86_400 })}.sig`;
};
const idFromAuth = (header) => {
  try { return JSON.parse(Buffer.from((header ?? "").split(".")[1], "base64url").toString()).sub; } catch { return undefined; }
};

const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await context.addInitScript(({ base, userId, stale, token }) => {
  try {
    if (localStorage.getItem("fixture-seeded")) return;
    localStorage.setItem("fixture-seeded", "1");
    localStorage.setItem("playarr:apiBaseUrl", base);
    const session = { accessToken: token, refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
    const entry = (key, id, name) => ({ profileKey: key, apiBaseUrl: base, userId: id, name, deviceId: "d", session });
    localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([entry("a", userId, "Fixture Ann"), entry("stale", stale.id, stale.name)]));
    localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "a", apiBaseUrl: base, userId }));
  } catch {}
}, { base, userId: USER_ID, stale: STALE, token: jwtFor(USER_ID) });

// The directory of an account lists only that account's profile, after a delay.
await context.route("**/api/v1/users/profiles", async (route) => {
  const id = idFromAuth(route.request().headers()["authorization"]);
  await new Promise((r) => setTimeout(r, DELAY_MS));
  const entry = (pid, name, current) => ({ id: pid, username: name, display_name: name, is_current: current, pin_locked: false });
  const list = [entry(id, NAMES[id] ?? "x", true)];
  if (id === USER_ID && staleStillKnown) list.push(entry(STALE.id, STALE.name, false));
  await route.fulfill({ json: list });
});
await context.route("**/api/v1/auth/login", async (route) => {
  const body = route.request().postDataJSON();
  const id = body.username === NAMES[ID_B] ? ID_B : USER_ID;
  await route.fulfill({ json: { access_token: jwtFor(id), refresh_token: "r", expires_in: 86400, token_type: "Bearer", user_id: id } });
});

const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

/** Record every tile (text and avatar box) on each animation frame from now on; read with `stop()`. */
const startSampling = () => page.evaluate(() => {
  window.__frames = [];
  let live = true;
  window.__stop = () => { live = false; return window.__frames; };
  const tick = () => {
    if (!live) return;
    window.__frames.push([...document.querySelectorAll(".profile-choice")].map((tile) => {
      const avatar = tile.querySelector(".profile-avatar")?.getBoundingClientRect();
      return { text: tile.textContent?.trim() ?? "", skeleton: tile.classList.contains("profile-skeleton"), add: tile.classList.contains("profile-add"), x: avatar ? Math.round(avatar.x) : null, y: avatar ? Math.round(avatar.y) : null, w: avatar ? Math.round(avatar.width) : null };
    }));
    requestAnimationFrame(tick);
  };
  tick();
});
const stopSampling = () => page.evaluate(() => window.__stop());
const names = (frames) => new Set(frames.flat().filter((t) => !t.skeleton && !t.add).map((t) => t.text));
/** The move of a tile (the add tile excluded) between the first frame it has a box and the end, after it left its skeleton. */
const maxShift = (frames) => {
  const boxes = frames.filter((f) => f.length).map((f) => f.map((t) => `${t.x},${t.y},${t.w}`));
  if (!boxes.length) return 0;
  // Tiles can only move when the count changes; with the same count the boxes must be identical frame to frame.
  let worst = 0;
  const first = frames.find((f) => f.some((t) => t.skeleton));
  const count = first ? first.length : frames.find((f) => f.length)?.length ?? 0;
  for (const f of frames) {
    if (f.length !== count) continue;
    f.forEach((t, i) => {
      const ref = (first ?? frames.find((g) => g.length === count))[i];
      worst = Math.max(worst, Math.abs(t.x - ref.x), Math.abs(t.y - ref.y), Math.abs(t.w - ref.w));
    });
  }
  return worst;
};

// 0. Two valid saved accounts: the second one's skeleton turns into its tile without moving.
let frames;
await page.goto(`${base}/profiles`);
await startSampling();
await page.waitForSelector(".profile-choice:not(.profile-skeleton):not(.profile-add) >> nth=1", { timeout: 15000 });
await page.waitForTimeout(600);
frames = await stopSampling();
const skeletonFrame = frames.find((f) => f.some((t) => t.skeleton));
check("two accounts: a skeleton stands in for the second tile", Boolean(skeletonFrame) && skeletonFrame.length === 3, JSON.stringify(skeletonFrame));
const settledFrame = frames[frames.length - 1];
check("two accounts: the real tiles take the skeleton's place", Boolean(skeletonFrame) && settledFrame.length === 3 && settledFrame.every((t, i) => Math.abs(t.x - skeletonFrame[i].x) <= 1 && Math.abs(t.y - skeletonFrame[i].y) <= 1 && t.w === skeletonFrame[i].w), JSON.stringify([skeletonFrame, settledFrame]));
check("two accounts: no other name renders", [...names(frames)].every((n) => n.includes("Ann") || n.includes("Stale")), [...names(frames)].join("|"));
staleStillKnown = false;
await page.evaluate(() => localStorage.removeItem("playarr.profileDirectory.v1"));

// 1. Account A with a stale saved session: cold load.
await page.goto(`${base}/profiles`);
await startSampling();
await page.waitForSelector(".profile-choice:not(.profile-skeleton):not(.profile-add)", { timeout: 15000 });
await page.waitForTimeout(600);
frames = await stopSampling();
check("cold picker: a skeleton of tiles shows first", frames.some((f) => f.some((t) => t.skeleton)), "no skeleton frame");
check("cold picker: no stale name ever renders", ![...names(frames)].some((n) => n.includes("Stale")), [...names(frames)].join("|"));
check("cold picker: only the account's own tile renders", [...names(frames)].length === 1 && [...names(frames)][0].includes("Fixture Ann"), [...names(frames)].join("|"));
// The saved stale account only costs one skeleton that disappears; the account's own tile is real from the first frame.
const firstTiles = frames.find((f) => f.length);
check("cold picker: the account's own tile is real from the first frame", Boolean(firstTiles) && firstTiles[0].text.includes("Fixture Ann") && !firstTiles[0].skeleton, JSON.stringify(firstTiles));
await page.waitForFunction(() => document.querySelectorAll(".profile-skeleton").length === 0);

// 2. Sign out A, then sign in as B.
const aDirectory = await page.evaluate(() => localStorage.getItem("playarr.profileDirectory.v1"));
check("A's directory is cached after the first load", Boolean(aDirectory) && aDirectory.includes("Fixture Ann"));
await page.locator("#profile-sign-out").click();
await page.waitForTimeout(300);
check("sign-out clears the cached directory", (await page.evaluate(() => localStorage.getItem("playarr.profileDirectory.v1"))) === null);
await page.goto(`${base}/login`);
await page.fill('input[name="username"]', NAMES[ID_B]);
await page.fill('input[name="password"]', "pw");
await page.locator("button[type=submit]").click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
await page.goto(`${base}/profiles`);
await startSampling();
await page.waitForSelector(".profile-choice:not(.profile-skeleton):not(.profile-add)", { timeout: 15000 });
await page.waitForFunction(() => document.querySelectorAll(".profile-skeleton").length === 0, null, { timeout: 15000 });
await page.waitForTimeout(600);
frames = await stopSampling();
const seenB = [...names(frames)];
check("B's picker: no tile of A renders", !seenB.some((n) => n.includes("Ann")), seenB.join("|"));
check("B's picker: no stale tile renders", !seenB.some((n) => n.includes("Stale")), seenB.join("|"));
check("B's picker: shows B's own tile", seenB.length === 1 && seenB[0].includes("Fixture Ben"), seenB.join("|"));
check("B's picker: tiles never move after they are on screen", maxShift(frames) <= 1, `shift ${maxShift(frames)}px`);

// 3. Returning visit for B: cached tiles paint at once, the fresh answer changes nothing.
await page.reload();
await page.waitForSelector(".profile-choice:not(.profile-skeleton):not(.profile-add)", { timeout: 15000 });
const firstPaint = await page.evaluate(() => document.querySelectorAll(".profile-choice.profile-skeleton").length);
// Let the page's own entrance motion finish; the directory answer (delayed) lands inside the sampled window.
await page.waitForTimeout(500);
await startSampling();
await page.waitForTimeout(DELAY_MS + 600);
frames = await stopSampling();
check("returning visit: B's cached tile paints without a skeleton", firstPaint === 0 && !frames.some((f) => f.some((t) => t.skeleton)));
check("returning visit: the fresh answer moves nothing", maxShift(frames) <= 1, `shift ${maxShift(frames)}px`);
check("returning visit: still only B", [...names(frames)].length === 1 && [...names(frames)][0].includes("Fixture Ben"), [...names(frames)].join("|"));
check("no page errors", errors.length === 0, errors.join("; "));

await finish();
