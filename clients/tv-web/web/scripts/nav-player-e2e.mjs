#!/usr/bin/env node
// Player BACK and D-pad reachability against a stalled or failed negotiation (web TV audit P2, P4, R5): with the
// stream never starting, one BACK press must leave the player on every BACK key, and the mute button must be
// reachable with the arrow keys. Playable-media layers (panel -> controls -> exit, end card) are covered by
// player-audit-e2e.mjs on the fixture server.
//
//   node scripts/nav-player-e2e.mjs [--no-build] [--dist dir]
import { BACK_KEYS, boot, focusInfo } from "./e2e-common.mjs";

const { base, check, open, finish } = await boot();
const playback = /\/api\/v1\/playback\//;

async function player(mode) {
  const { context, page } = await open("/movies");
  await page.waitForSelector("[data-library-index]");
  await page.route(playback, (route) =>
    mode === "error" ? route.fulfill({ status: 503, json: { error: "unavailable" } }) : new Promise(() => {})
  );
  await page.evaluate(() => history.pushState({ backTo: "/movies" }, "", "/player/mf-test?title=x"));
  await page.goto(`${base}/player/mf-test?title=x`);
  await page.waitForTimeout(2200);
  return { context, page };
}

for (const mode of ["stalled", "error"]) {
  for (const [name, press] of BACK_KEYS) {
    const { context, page } = await player(mode);
    await press(page);
    await page.waitForTimeout(700);
    check(`${mode} player: one ${name} leaves`, !new URL(page.url()).pathname.startsWith("/player"), page.url());
    await context.close();
  }
}

{
  const { context, page } = await player("stalled");
  await page.locator(".player-controls .player-btn").first().focus().catch(() => {});
  let reached = false;
  for (let i = 0; i < 14 && !reached; i += 1) {
    reached = await page.evaluate(() => Boolean(document.activeElement?.closest?.(".player-volume")) || /mute/i.test(document.activeElement?.getAttribute("aria-label") ?? ""));
    if (!reached) await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(80);
  }
  const info = await focusInfo(page);
  check("player: the mute button is reachable with the arrow keys", reached, JSON.stringify(info));
  await context.close();
}

await finish();
