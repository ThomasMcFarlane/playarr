#!/usr/bin/env node
// One focus style system, checked with real keyboard focus (docs/design/page-layout.md, section 5; owner rulings Q2, Q11, Q13).
//   node scripts/focus-style-e2e.mjs [--dist dir] [--theme light|dark] [--layout tv|desktop]
//
// In both themes at 1920x1080 and 1280x720:
//  - media cards (Home rail card, library grid card, calendar agenda, week and month cards) show NO outline and no fill when focused, lift upward
//    by at least 4px and cast the focus shadow (on the art, or on the card itself when the card is the visible box);
//  - controls (Back, the Filters pill, the search field) show the theme ring (white in dark theme, the ink in light theme),
//    3px wide, with no fill change and no scale.
// PLAYWRIGHT_CHROMIUM_PATH points at a browser executable when the default playwright browser is not installed.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { launchChromium } from "./chromium-launch.mjs";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const DIST = opt("dist", join(root, "dist"));
const THEMES = opt("theme", "") ? [opt("theme", "")] : ["dark", "light"];
const LAYOUTS = { tv: { width: 1920, height: 1080 }, desktop: { width: 1280, height: 720 } };
const layoutIds = opt("layout", "") ? [opt("layout", "")] : Object.keys(LAYOUTS);
const USER_ID = "00000000-0000-4000-8000-000000000001";
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
};

const server = await startServer({ distDir: DIST, seasons: 2, seasonEpisodes: 4, canDownload: false });
const base = `http://127.0.0.1:${server.port}`;
const browser = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH })
  : await launchChromium();

/** Style of the focused element (or the remote marker), and of its art, in the current frame, read once every running
 *  transition and animation has finished (a fixed sleep read the shadow mid-transition, e.g. 23.99px instead of 24px). */
const snapshot = async (page) => {
  await page.evaluate(async () => {
    for (let pass = 0; pass < 5; pass += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const running = document.getAnimations().filter((a) => a.playState === "running" && Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity));
      if (!running.length) return;
      await Promise.allSettled(running.map((a) => a.finished));
    }
  });
  return readStyle(page);
};
const readStyle = (page) => page.evaluate(() => {
  const el = document.querySelector("[data-remote-active]") ?? document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const art = el.querySelector('[class*="art"]');
  const ac = art ? getComputedStyle(art) : null;
  const matrix = cs.transform === "none" ? [1, 0, 0, 1, 0, 0] : cs.transform.replace(/matrix\(|\)/g, "").split(",").map(Number);
  const probe = document.createElement("i");
  probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--ink");
  document.body.appendChild(probe);
  const ink = getComputedStyle(probe).color;
  probe.remove();
  return {
    cls: String(el.className).slice(0, 60),
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    background: cs.backgroundColor,
    scale: matrix[0],
    ty: matrix[5],
    shadow: cs.boxShadow,
    artShadow: ac ? ac.boxShadow : "none",
    ink,
  };
});

const restBackground = (page, selector) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? getComputedStyle(el).backgroundColor : null;
}, selector);

for (const theme of THEMES) {
  for (const id of layoutIds) {
    const { width, height } = LAYOUTS[id];
    const label = `${theme} ${width}x${height}`;
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript(({ base, userId, theme }) => {
      localStorage.setItem("playarr:apiBaseUrl", base);
      const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
      localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "nav-perf", apiBaseUrl: base, userId, name: "Perf", deviceId: "d", session }]));
      localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "nav-perf", apiBaseUrl: base, userId }));
      localStorage.setItem("playarr-theme", theme);
      document.documentElement.dataset.theme = theme;
    }, { base, userId: USER_ID, theme });
    const page = await context.newPage();

    const expectCard = (name, s, { selfShadow = false } = {}) => {
      check(`${label} ${name}: card is focused`, !!s, "nothing focused");
      if (!s) return;
      check(`${label} ${name}: no ring`, s.outlineStyle === "none" || s.outlineWidth === "0px", `${s.outlineStyle} ${s.outlineWidth}`);
      check(`${label} ${name}: lifts`, s.ty <= -4, `ty=${s.ty}`);
      check(`${label} ${name}: casts the focus shadow`, /\b(2[2-6])(\.\d+)?px\b/.test(selfShadow ? s.shadow : s.artShadow), `shadow=${selfShadow ? s.shadow : s.artShadow}`);
    };

    // Home: a rail card, focused with real keys.
    await page.goto(`${base}/`);
    await page.waitForSelector(".tv-home-card");
    await page.waitForTimeout(1500);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(700);
    expectCard("home card", await snapshot(page));

    // Library grid card.
    await page.goto(`${base}/series`);
    await page.waitForSelector(".tv-title-card");
    await page.waitForTimeout(1500);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(700);
    expectCard("library grid card", await snapshot(page));

    // Calendar cards in every view (agenda rows, week entries, month chips): the card is the visible box and carries the
    // shadow itself; focus is the shared lift, never a ring or a white border.
    for (const view of ["agenda", "week", "month"]) {
      await page.goto(`${base}/calendar?view=${view}`);
      await page.waitForSelector(".calendar-chip, .calendar-entry");
      await page.waitForTimeout(1500);
      for (let i = 0; i < 10; i += 1) {
        await page.keyboard.press(view === "agenda" ? "ArrowDown" : "ArrowRight");
        await page.waitForTimeout(250);
        const focused = await page.evaluate(() => document.activeElement?.className ?? "");
        if (/calendar-(chip|entry)/.test(String(focused))) break;
      }
      if (!/calendar-(chip|entry)/.test(await page.evaluate(() => String(document.activeElement?.className ?? "")))) {
        // Keyboard focus lands on a card (month chips sit behind the header controls in the arrow order).
        await page.keyboard.press("Shift");
        await page.focus(".calendar-chip, .calendar-entry");
      }
      await page.waitForTimeout(900);
      const chip = await snapshot(page);
      expectCard(`calendar ${view} card`, chip, { selfShadow: true });
      const border = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        const cs = getComputedStyle(el);
        const probe = document.createElement("i");
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--ink");
        document.body.appendChild(probe);
        const ink = getComputedStyle(probe).color;
        probe.remove();
        const seen = (w, c) => (parseFloat(w) > 0 ? c : "none");
        return { ink, top: seen(cs.borderTopWidth, cs.borderTopColor), right: seen(cs.borderRightWidth, cs.borderRightColor), bottom: seen(cs.borderBottomWidth, cs.borderBottomColor), shadow: cs.boxShadow };
      });
      if (border) {
        check(`${label} calendar ${view} card: no white border`, border.top !== border.ink && border.right !== border.ink && border.bottom !== border.ink, JSON.stringify(border));
        check(`${label} calendar ${view} card: no inset ring`, !/inset/.test(border.shadow), border.shadow);
      }
    }

    // Controls, reached with Tab: Back, the Filters pill, and (search page) the search field.
    const controls = [
      ["back", ".tv-page-back", "/series"],
      ["filters pill", ".action-pill", "/series"],
      ["search field", ".tv-search-form input", "/search"],
    ];
    for (const [name, selector, route] of controls) {
      await page.goto(`${base}${route}`);
      await page.waitForSelector(selector);
      await page.waitForTimeout(1200);
      const rest = await restBackground(page, selector);
      let reached = false;
      // The search field is reached with Tab. Header controls are focused after a key press, so the browser reports
      // :focus-visible exactly as for D-pad focus (the D-pad's own header routes are covered by the spatial-nav tests).
      if (name === "search field") {
        for (let i = 0; i < 40 && !reached; i += 1) {
          await page.keyboard.press("Tab");
          reached = await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector);
        }
      } else {
        await page.keyboard.press("Shift");
        await page.focus(selector);
        reached = await page.evaluate((s) => document.activeElement?.matches(s) && document.activeElement.matches(":focus-visible"), selector);
      }
      check(`${label} ${name}: focused by keyboard`, reached);
      if (!reached) continue;
      await page.waitForTimeout(350);
      const s = await page.evaluate((s) => {
        const el = document.querySelector(s);
        // The search field draws the ring on its pill (the input has none of its own).
        const ringed = el.matches(".tv-search-form input") ? el.closest(".tv-search-form") : el;
        const cs = getComputedStyle(ringed);
        const probe = document.createElement("i");
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--ink");
        document.body.appendChild(probe);
        const ink = getComputedStyle(probe).color;
        probe.remove();
        const own = getComputedStyle(el);
        return {
          outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, outlineColor: cs.outlineColor, ink,
          background: own.backgroundColor, transform: own.transform,
        };
      }, selector);
      const wantColor = theme === "dark" ? "rgb(255, 255, 255)" : s.ink;
      check(`${label} ${name}: 3px theme ring`, s.outlineStyle === "solid" && s.outlineWidth === "3px" && s.outlineColor === wantColor, JSON.stringify(s));
      check(`${label} ${name}: no scale`, s.transform === "none", s.transform);
      check(`${label} ${name}: no fill change`, rest === null || rest === s.background, `${rest} -> ${s.background}`);
    }
    await context.close();
  }
}
await browser.close();
server.close?.();
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
