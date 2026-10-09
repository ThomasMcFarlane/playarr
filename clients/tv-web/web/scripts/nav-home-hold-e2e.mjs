#!/usr/bin/env node
// Home never takes focus (or the page) back on its own (owner/prefetch worker report, 10 Oct 2026: "Home RE-TAKES focus a
// few seconds after settling"). After the viewer has moved to another rail, five quiet seconds later (data arriving late,
// On Deck swapping in, revalidation) the focused card, the remote marker and the stack's scroll position are unchanged.
// Runs twice: with everything answering at once, and on a cold start where the rails answer after 1.5 s and the watch
// progress (On Deck) after 3 s, with the viewer already moving while that data lands.
//   node scripts/nav-home-hold-e2e.mjs [--no-build] [--dist dir]
import { boot, opt, root } from "./e2e-common.mjs";
import { startServer } from "./nav-perf/server.mjs";
import { join } from "node:path";

const { check, open, finish } = await boot({ movies: 40, series: 12, artists: 0, onDeck: 3 }, { realisticAuth: true });
const cold = await startServer({ distDir: opt("dist", join(root, "dist")), movies: 40, series: 12, artists: 0, onDeck: 3, railsDelayMs: 1500, progressDelayMs: 3000 });

const state = (page) =>
  page.evaluate(() => {
    const marker = document.querySelector("[data-remote-active]");
    return {
      marker: marker?.getAttribute("data-navigation-focus-key") ?? null,
      focus: document.activeElement?.getAttribute?.("data-navigation-focus-key") ?? null,
      top: Math.round(document.querySelector(".tv-home-rails")?.scrollTop ?? -1),
    };
  });

for (const [label, server] of [["warm", undefined], ["cold start", cold]]) {
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    const { context, page, errors } = await open("/", { width: w, height: h, server });
    await page.waitForSelector(".tv-home-card", { timeout: 12000 });
    await page.waitForFunction(() => document.querySelector(".tv-home-card.is-selected"), null, { timeout: 12000 });
    // Move as soon as focus exists: down two rails and right twice.
    for (const key of ["ArrowRight", "ArrowDown", "ArrowDown", "ArrowRight", "ArrowRight"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(350);
    }
    await page.waitForTimeout(6500); // the late data (up to 3 s) has landed and everything has settled
    const settled = await state(page);
    const samples = [];
    for (let i = 0; i < 10; i += 1) {
      await page.waitForTimeout(500);
      samples.push(await state(page));
    }
    const moved = samples.filter((s) => s.marker !== settled.marker || s.top !== settled.top).length;
    check(`Home ${label} ${w}x${h}: the viewer is on a lower rail (${settled.marker?.slice(0, 24)})`, Boolean(settled.marker) && settled.top > 0, JSON.stringify(settled));
    check(`Home ${label} ${w}x${h}: marker and scroll stay put for 5 s`, moved === 0, `${moved} of 10 samples differ from ${JSON.stringify(settled)}`);
    check(`Home ${label} ${w}x${h}: no page errors`, errors.length === 0, errors.join(";"));
    await context.close();
  }
}
cold.close?.();
await finish();
