#!/usr/bin/env node
// The library's left preview (title, year line, description) follows the remote's focus immediately.
//
// Moving between cards must update the preview text within one frame of the focus marker moving, from the data
// already in the list response: never after the settle timer of the real DOM focus, a debounce, the dwell prefetch
// or a per-item detail request (the mock API answers detail requests after 900 ms to prove the preview does not
// wait on them). The preview must also never blank or replay its enter animation while it changes.
//
//   node scripts/nav-library-preview-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ detailDelayMs: 900, movies: 60, series: 8 });
/** Key to preview text, per press, under a single press and under a held key. */
const SINGLE_MAX_MS = 50;
const HELD_MAX_MS = 100;

const INSTALL = () => {
  const state = { keys: [], text: [], blanks: 0, dimmed: 0 };
  window.__preview = state;
  const read = () => {
    const root = document.querySelector(".tv-library-preview");
    const h = root?.querySelector("h2")?.textContent ?? "";
    const o = root?.querySelector(".tv-preview-overview")?.textContent ?? "";
    return { h, o, opacity: root ? Number(getComputedStyle(root).opacity) : 0 };
  };
  let last = read();
  const onChange = () => {
    const now = read();
    if (now.h === last.h && now.o === last.o) return;
    const t = performance.now();
    if (!now.h || !now.o) state.blanks += 1;
    if (now.opacity < 0.99) state.dimmed += 1;
    state.text.push({ ...now, t });
    last = now;
  };
  new MutationObserver(onChange).observe(document.body, { subtree: true, childList: true, characterData: true });
  addEventListener(
    "keydown",
    (event) => {
      if (!event.key.startsWith("Arrow")) return;
      state.keys.push({ key: event.key, t: performance.now() });
    },
    true
  );
};

async function run(label, press, count, gap, maxMs) {
  const { context, page, errors } = await open("/movies");
  await page.waitForSelector("[data-library-index]");
  await page.evaluate(INSTALL);
  await page.waitForTimeout(1200);
  // Settled focus index, read from the focus marker, and the title the preview should show for it.
  const expectedTitle = () =>
    page.evaluate(() => {
      const el = document.querySelector("[data-remote-active]") ?? document.activeElement;
      return el?.closest?.(".tv-title-card")?.querySelector("strong")?.textContent ?? null;
    });
  await press(page, count, gap);
  await page.waitForTimeout(900);
  const data = await page.evaluate(() => window.__preview);
  const finalTitle = await expectedTitle();
  const shown = await page.evaluate(() => document.querySelector(".tv-library-preview h2")?.textContent ?? "");
  check(`${label}: preview shows the focused title once settled`, finalTitle !== null && shown === finalTitle, `${shown} vs ${finalTitle}`);
  // Latency: each text change against the latest key before it.
  const lags = [];
  for (const change of data.text) {
    const key = [...data.keys].reverse().find((k) => k.t <= change.t);
    if (key) lags.push(change.t - key.t);
  }
  const worst = lags.length ? Math.max(...lags) : Infinity;
  check(`${label}: ${lags.length} preview updates, worst key-to-text ${worst.toFixed(0)} ms (<= ${maxMs})`, lags.length > 0 && worst <= maxMs, `${worst}`);
  check(`${label}: preview is never blank`, data.blanks === 0, String(data.blanks));
  check(`${label}: preview does not replay its fade-in`, data.dimmed === 0, String(data.dimmed));
  check(`${label}: no page errors`, errors.length === 0, errors.join(";"));
  await context.close();
}

const steps = (key) => async (page, count, gap) => {
  for (let i = 0; i < count; i += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(gap);
  }
};
await run("single presses", async (page) => {
  for (const key of ["ArrowRight", "ArrowDown", "ArrowRight", "ArrowDown", "ArrowLeft"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(700);
  }
}, 5, 0, SINGLE_MAX_MS);
await run("held key", steps("ArrowDown"), 14, 35, HELD_MAX_MS);

await finish();
