#!/usr/bin/env node
// Filters panel (owner bugs 2026-10-10, rows 1.9961 1.9962 1.9963):
//   1. Focus moving down through the panel scrolls the drawer body so each focused control is fully visible, with the
//      shared bottom/top edge fades following the overflow, both down and up.
//   2. Audio and subtitle languages are ONE multi-select each (no toggle pills): opens by keyboard, filters by typing,
//      toggles two languages with Enter, closes on Escape with focus back on the field, same ?audio= query param.
//   3. The View control is one row of equal segments, the same height as the other panel choice buttons.
//   4. While the language lists load (slow on a big library) the panel shows a skeleton per list, never "No languages
//      indexed yet"; the lists replace the skeletons when they arrive (row 1.9977).
// 1920x1080 and 1280x720.   node scripts/filters-panel-e2e.mjs [--no-build] [--dist dir] [--shots dir]
import { mkdirSync } from "node:fs";
import { boot, opt, root } from "./e2e-common.mjs";
import { join } from "node:path";
import { startServer } from "./nav-perf/server.mjs";

const { check, open, finish } = await boot({ movies: 24, series: 12 });
const shots = opt("shots", "");
if (shots) mkdirSync(shots, { recursive: true });

const geom = () => {
  const body = document.querySelector(".tv-filter-drawer .drawer-body");
  const el = document.activeElement;
  if (!body || !el) return null;
  const b = body.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    inside: !body.contains(el) || (r.top >= b.top - 1 && r.bottom <= b.bottom + 1),
    start: body.hasAttribute("data-fade-start"),
    end: body.hasAttribute("data-fade-end"),
    top: body.scrollTop,
    max: body.scrollHeight - body.clientHeight,
    label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
  };
};
const settle = (page) => page.waitForTimeout(450);

async function walkPanel(page, tag) {
  // Keyboard down through the panel.
  await page.locator(".tv-filter-drawer .drawer-close").focus();
  const seen = [];
  let sawEnd = false;
  let bad = null;
  let fadeBad = null;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    await settle(page);
    const g = await page.evaluate(geom);
    if (!g) continue;
    seen.push(g);
    if (g.end) sawEnd = true;
    if (!g.inside && !bad) bad = g;
    const wrapped = await page.evaluate(() => document.activeElement?.classList.contains("drawer-close"));
    if (wrapped) break; // Tab wrapped from the last control back to Close
    if (g.end !== g.top < g.max - 3 || g.start !== g.top > 3) fadeBad ??= g;
  }
  const overflow = seen.some((g) => g.max > 4);
  check(`${tag}: every focused control fully inside the drawer body`, bad === null, JSON.stringify(bad));
  if (overflow) {
    if (!tag.includes("1920")) check(`${tag}: panel scrolled while focusing down`, seen.some((g) => g.top > 4));
    check(`${tag}: bottom fade shown while content continues`, sawEnd);
    check(`${tag}: edge fades match the scroll position on every step`, fadeBad === null, JSON.stringify(fadeBad));
    let upBad = null;
    let startSeen = false;
    for (let i = 0; i < seen.length; i++) {
      await page.keyboard.press("Shift+Tab");
      await settle(page);
      const g = await page.evaluate(geom);
      if (g && g.start) startSeen = true;
      if (g && !g.inside && !upBad) upBad = g;
    }
    check(`${tag}: focus up keeps controls in view`, upBad === null, JSON.stringify(upBad));
    if (!tag.includes("1920")) check(`${tag}: top fade shown after scrolling down`, startSeen);
  } else {
    console.log(`INFO  ${tag}: panel does not overflow, scroll checks skipped`);
  }

}

const slow = await startServer({ distDir: opt("dist", join(root, "dist")), movies: 8, series: 2, languagesDelayMs: 2500 });
for (const [width, height] of [[1920, 1080], [1280, 720]]) {
  const tag = `${width}x${height}`;
  {
    const { context: slowContext, page: slowPage } = await open("/movies?panel=filters", { width, height, server: slow });
    await slowPage.waitForSelector(".tv-filter-drawer .drawer-body section", { timeout: 8000 });
    await slowPage.waitForTimeout(600);
    const loading = await slowPage.evaluate(() => ({
      skeletons: document.querySelectorAll("[data-language-filter] .tv-filter-language-skeleton[aria-busy='true']").length,
      claimsEmpty: /No languages indexed yet/.test(document.querySelector(".tv-filter-drawer")?.textContent ?? ""),
    }));
    check(`${tag}: language lists show a skeleton each while loading`, loading.skeletons === 2, JSON.stringify(loading));
    check(`${tag}: no "No languages indexed yet" while the lists load`, !loading.claimsEmpty);
    await slowPage.waitForSelector("[data-language-filter] .ui-multiselect", { timeout: 8000 });
    const loaded = await slowPage.evaluate(() => ({
      skeletons: document.querySelectorAll(".tv-filter-language-skeleton").length,
      fields: document.querySelectorAll("[data-language-filter] .ui-multiselect").length,
    }));
    check(`${tag}: the lists replace the skeletons`, loaded.skeletons === 0 && loaded.fields === 2, JSON.stringify(loaded));
    await slowContext.close();
  }
  const { context, page, errors } = await open("/movies?panel=filters", { width, height });
  try {
    await page.waitForSelector(".tv-filter-drawer .drawer-body section", { timeout: 8000 });
    await page.waitForTimeout(700);
    check(`${tag}: no language toggle pills remain`, (await page.locator('[data-language-filter] .tv-filter-choice-grid').count()) === 0);
    check(`${tag}: one multi-select per language filter`, (await page.locator("[data-language-filter] .ui-multiselect").count()) === 2);

    // View control: one row, equal segments, height matches the other panel buttons.
    const view = await page.evaluate(() => {
      const row = document.querySelector(".tv-segmented");
      const bs = [...row.querySelectorAll("button")].map((b) => ({ top: b.getBoundingClientRect().top, width: b.offsetWidth, height: b.offsetHeight }));
      const sort = document.querySelector(".tv-filter-choice-grid-wide button");
      return { tops: bs.map((r) => r.top), widths: bs.map((r) => r.width), h: bs[0].height, sortH: sort?.offsetHeight };
    });
    check(`${tag}: view segments share one row`, Math.max(...view.tops) - Math.min(...view.tops) <= 1, JSON.stringify(view.tops));
    check(`${tag}: view segments equal width`, Math.max(...view.widths) - Math.min(...view.widths) <= 1, JSON.stringify(view.widths));
    check(`${tag}: view segment height matches other choice buttons`, Math.abs(view.h - view.sortH) <= 1, `${view.h} vs ${view.sortH}`);

    if (shots) await page.screenshot({ path: `${shots}/drawer-${tag}.png` });
    await walkPanel(page, tag);
    // Multi-select by keyboard.
    for (const which of ["audio", "subs"]) {
      const field = page.locator(`[data-language-filter="${which}"] .ui-multiselect-trigger`);
      await field.focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector(`[data-language-filter="${which}"] [role="listbox"]`);
      const aria = await page.evaluate((w) => {
        const root = document.querySelector(`[data-language-filter="${w}"]`);
        const lb = root.querySelector('[role="listbox"]');
        const opts = [...lb.querySelectorAll('[role="option"]')];
        const input = root.querySelector('[role="combobox"]');
        return {
          multi: lb.getAttribute("aria-multiselectable"),
          opts: opts.length,
          small: opts.some((o) => o.getBoundingClientRect().height < 43.5),
          inputFocused: document.activeElement === input,
          status: root.querySelector('[role="status"]').textContent,
        };
      }, which);
      check(`${tag} ${which}: listbox is aria-multiselectable with options`, aria.multi === "true" && aria.opts >= 10, JSON.stringify(aria));
      check(`${tag} ${which}: options at least 44px tall`, !aria.small);
      check(`${tag} ${which}: search box focused on open and count announced`, aria.inputFocused && /\d/.test(aria.status), JSON.stringify(aria));
      await page.keyboard.type("an");
      const filtered = await page.locator(`[data-language-filter="${which}"] [role="option"]`).allTextContents();
      check(`${tag} ${which}: typing filters the list`, filtered.length > 0 && filtered.length < aria.opts && filtered.every((t) => /an/i.test(t)), JSON.stringify(filtered));
      if (which === "audio" && shots) await page.screenshot({ path: `${shots}/multiselect-${tag}.png` });
      await page.keyboard.press("Enter");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
      const param = which;
      const url = new URL(page.url());
      const codes = (url.searchParams.get(param) ?? "").split(",").filter(Boolean);
      check(`${tag} ${which}: two languages toggled into ?${param}=`, codes.length === 2, page.url());
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      const state = await page.evaluate((w) => ({
        listbox: !!document.querySelector(`[data-language-filter="${w}"] [role="listbox"]`),
        drawer: !!document.querySelector(".tv-filter-drawer"),
        onField: document.activeElement?.classList.contains("ui-multiselect-trigger"),
        tokens: document.querySelectorAll(`[data-language-filter="${w}"] .ui-multiselect-token`).length,
      }), which);
      check(`${tag} ${which}: Escape closes only the list and refocuses the field`, !state.listbox && state.drawer && state.onField, JSON.stringify(state));
      check(`${tag} ${which}: selected languages shown as removable tokens`, state.tokens === 2, JSON.stringify(state));
    }
    // Selected first on reopen.
    const trigger = page.locator('[data-language-filter="audio"] .ui-multiselect-trigger');
    await trigger.focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector('[data-language-filter="audio"] [role="listbox"]');
    const firstTwo = await page.evaluate(() => [...document.querySelectorAll('[data-language-filter="audio"] [role="option"]')].slice(0, 3).map((o) => o.getAttribute("aria-selected")));
    check(`${tag}: selected languages listed first`, firstTwo[0] === "true" && firstTwo[1] === "true" && firstTwo[2] === "false", JSON.stringify(firstTwo));
    if (shots) await page.screenshot({ path: `${shots}/multiselect-selected-${tag}.png` });
    await page.keyboard.press("Escape");
    check(`${tag}: no page errors`, errors.length === 0, errors.join("; "));
  } finally {
    await context.close();
  }
}
// Calendar filters: Type and Status are multi-selects, Monitored only is a switch, no chips or pills remain.
for (const [width, height] of [[1920, 1080], [1280, 720]]) {
  const tag = `calendar ${width}x${height}`;
  const { context, page, errors } = await open("/calendar?panel=filters", { width, height });
  try {
    await page.waitForSelector(".tv-filter-drawer .drawer-body section", { timeout: 8000 });
    await page.waitForTimeout(700);
    const pills = await page.evaluate(() =>
      [...document.querySelectorAll(".tv-filter-drawer .tv-filter-choice-grid:not(.tv-segmented) button")].map((b) => b.textContent.trim())
    );
    check(`${tag}: no filter chips or pills (only the Clear action may use the grid)`, pills.every((t) => /clear/i.test(t)), JSON.stringify(pills));
    for (const [title, type, param, expect] of [["Type", "mus", "type", "music"], ["Status", "air", "status", "aired"]]) {
      const section = page.locator(`.tv-filter-drawer .drawer-body section:has(> h3:text-is("${title}"))`);
      check(`${tag} ${title}: is a multi-select`, (await section.locator(".ui-multiselect").count()) === 1);
      await section.locator(".ui-multiselect-trigger").focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector(`.tv-filter-drawer [role="listbox"]`);
      await page.keyboard.type(type);
      const shown = await section.locator('[role="option"]').allTextContents();
      check(`${tag} ${title}: typing filters`, shown.length === 1, JSON.stringify(shown));
      await page.keyboard.press("Enter");
      await page.waitForTimeout(400);
      check(`${tag} ${title}: toggling sets ?${param}=${expect}`, new URL(page.url()).searchParams.get(param) === expect, page.url());
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      const state = await page.evaluate(() => ({ drawer: !!document.querySelector(".tv-filter-drawer"), onField: document.activeElement?.classList.contains("ui-multiselect-trigger") }));
      check(`${tag} ${title}: Escape closes the list only and refocuses the field`, state.drawer && state.onField, JSON.stringify(state));
    }
    const sw = page.locator('.tv-filter-drawer input[role="switch"]');
    check(`${tag}: Monitored only is one switch`, (await sw.count()) === 1);
    check(`${tag}: switch target is at least 44px`, await sw.evaluate((el) => el.offsetHeight >= 44 && el.offsetWidth >= 44));
    await sw.focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(400);
    check(`${tag}: switch on sets ?monitored=1`, new URL(page.url()).searchParams.get("monitored") === "1" && (await sw.isChecked()), page.url());
    await page.keyboard.press("Space");
    await page.waitForTimeout(400);
    check(`${tag}: switch off clears ?monitored`, new URL(page.url()).searchParams.get("monitored") === null && !(await sw.isChecked()), page.url());
    check(`${tag}: no page errors`, errors.length === 0, errors.join("; "));
    if (shots) await page.screenshot({ path: `${shots}/calendar-filters-${width}x${height}.png` });
  } finally {
    await context.close();
  }
}
// Panels that overflow at these sizes: Calendar filters, and Movies at a short window.
for (const [path, width, height, name] of [
  ["/calendar?panel=filters", 1920, 1080, "calendar 1920x1080"],
  ["/calendar?panel=filters", 1280, 720, "calendar 1280x720"],
  ["/movies?panel=filters", 1280, 480, "movies 1280x480"],
]) {
  const { context, page } = await open(path, { width, height });
  try {
    await page.waitForSelector(".tv-filter-drawer .drawer-body section", { timeout: 8000 });
    await page.waitForTimeout(700);
    await walkPanel(page, name);
    if (shots && name === "calendar 1280x720") await page.screenshot({ path: `${shots}/drawer-scrolled-1280x720.png` });
  } finally {
    await context.close();
  }
}
await finish();
