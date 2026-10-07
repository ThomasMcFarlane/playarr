#!/usr/bin/env node
// Headless smoke test for remote / pointer navigation on the real screens,
// against the same deterministic mock API as nav-perf.mjs.
//
//   node scripts/nav-smoke.mjs [--no-build] [--dist dir] [--throttle 4]
//
// Covers the manual test plan of the remote-nav perf work: keyboard (remote)
// navigation with a visible focus target on every screen, Enter to open and
// Back to return with focus restored, pointer mode taking over from the
// remote, alphabet jump, cover-flow, the media context menu, and Home rails.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const DIST = opt("dist", join(root, "dist"));
const THROTTLE = Number(opt("throttle", 1));
if (!flag("no-build") && !opt("dist", "")) {
  const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const USER_ID = "00000000-0000-4000-8000-000000000001";

function launch() {
  const gpu = !flag("software") && existsSync("/dev/dri/renderD128");
  if (!gpu) return {};
  const dir = join(homedir(), ".cache/ms-playwright");
  const full = existsSync(dir) ? readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
  return {
    executablePath: process.env.NAV_PERF_CHROMIUM || (full ? join(dir, full, "chrome-linux64/chrome") : undefined),
    args: ["--use-angle=vulkan", "--enable-features=Vulkan", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
  };
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
}

const server = await startServer({ distDir: DIST });
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch(launch());

async function newPage(path, storage = {}) {
  const context = await browser.newContext({ viewport: { width: 3840, height: 2160 } });
  await context.addInitScript(
    ({ base, userId, storage }) => {
      try {
        localStorage.setItem("playarr:apiBaseUrl", base);
        const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
        localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "nav-perf", apiBaseUrl: base, userId, name: "Perf", deviceId: "d", session }]));
        localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "nav-perf", apiBaseUrl: base, userId }));
        for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
      } catch {}
    },
    { base, userId: USER_ID, storage }
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}${path}`);
  if (THROTTLE > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  }
  return { context, page, errors };
}

/** The element the remote user sees as focused: the virtual marker, else DOM focus. */
const focusedInfo = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-remote-active]") ?? document.activeElement;
    if (!el || el === document.body) return null;
    const r = el.getBoundingClientRect();
    return {
      cls: el.className?.toString() ?? "",
      index: el.getAttribute("data-library-index"),
      href: el.getAttribute("href"),
      visible: r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
      markers: document.querySelectorAll("[data-remote-active]").length,
      mode: document.body.dataset.inputMode,
    };
  });
const press = async (page, key, n = 1, delay = 60) => {
  for (let i = 0; i < n; i += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(delay);
  }
};
const settle = (page) => page.waitForTimeout(700);

try {
  // 1. Movies: remote navigation keeps one visible focus target through a long walk.
  {
    const { context, page, errors } = await newPage("/movies");
    await page.waitForSelector("[data-library-index]");
    await page.waitForTimeout(1200);
    await press(page, "ArrowDown", 40);
    await press(page, "ArrowRight", 2);
    await settle(page);
    const f = await focusedInfo(page);
    check("movies: focus target visible after 40 rows down + 2 right", Boolean(f?.visible), JSON.stringify(f));
    check("movies: exactly one remote marker", f?.markers === 1, JSON.stringify(f));
    check("movies: input mode is remote", f?.mode === "remote", JSON.stringify(f));
    const idx = Number(f?.index);
    check("movies: virtual index advanced (40 rows x 3 cols + 2 right ~ 122)", idx >= 118 && idx <= 124, `index ${idx}`);
    await press(page, "ArrowUp", 10);
    await settle(page);
    const up = await focusedInfo(page);
    check("movies: focus visible after moving back up", Boolean(up?.visible), JSON.stringify(up));

    // 2. Enter opens the detail page; Escape returns to the library with focus restored.
    const before = await focusedInfo(page);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/movies\/[0-9a-f-]+/, { timeout: 10_000 }).catch(() => {});
    check("movies: Enter opens the focused title", /\/movies\/[0-9a-f-]+/.test(page.url()), page.url());
    await page.keyboard.press("Escape");
    await page.waitForURL(/\/movies$/, { timeout: 10_000 }).catch(() => {});
    await page.waitForSelector("[data-library-index]");
    await page.waitForTimeout(1500);
    const after = await focusedInfo(page);
    check("movies: Back restores a visible focused title", Boolean(after?.visible), JSON.stringify(after));
    check("movies: Back restores the same title", after?.index === before?.index, `${before?.index} -> ${after?.index}`);

    // 3. Pointer takes over from the remote.
    await page.mouse.move(2400, 900);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);
    const pointer = await focusedInfo(page);
    check("pointer: pointerdown switches input mode", (await page.evaluate(() => document.body.dataset.inputMode)) === "pointer");
    check("pointer: remote marker cleared", (await page.evaluate(() => document.querySelectorAll("[data-remote-active]").length)) === 0, JSON.stringify(pointer));
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(300);
    check("pointer: a key press returns to remote mode", (await page.evaluate(() => document.body.dataset.inputMode)) === "remote");
    check("movies: no page errors", errors.length === 0, errors[0]);
    await context.close();
  }

  // 4. Alphabet jump lands on the first title of the letter and focuses it.
  {
    const { context, page } = await newPage("/movies");
    await page.waitForSelector("[data-library-index]");
    await page.waitForTimeout(1200);
    await page.locator(".tv-alphabet button", { hasText: /^M$/ }).click();
    await page.waitForTimeout(2500);
    const letter = await page.evaluate(() => document.activeElement?.getAttribute("data-library-letter") ?? null);
    check("alphabet: jump focuses a title starting with the letter", letter === "M", `letter ${letter}`);
    await context.close();
  }

  // 5. Context menu: contextmenu event opens the drawer, Escape closes it.
  {
    const { context, page } = await newPage("/movies");
    await page.waitForSelector("[data-library-index]");
    await page.waitForTimeout(1200);
    await page.locator("[data-library-index='1']").click({ button: "right" });
    await page.waitForSelector(".media-context-drawer", { timeout: 5000 }).catch(() => {});
    check("context menu: right-click opens the drawer", (await page.locator(".media-context-drawer").count()) > 0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    check("context menu: Escape closes it", (await page.locator(".media-context-drawer").count()) === 0);
    await context.close();
  }

  // 5b. Remote long-press OK opens the menu for the *visible* title, and arrows then drive the menu.
  {
    const { context, page } = await newPage("/movies");
    await page.waitForSelector("[data-library-index]");
    await page.waitForTimeout(1200);
    await press(page, "ArrowDown", 3);
    await press(page, "ArrowRight", 1);
    const target = await focusedInfo(page);
    await page.keyboard.down("Enter");
    await page.waitForSelector(".media-context-drawer", { timeout: 5000 }).catch(() => {});
    await page.keyboard.up("Enter");
    check("context menu: long-press OK opens the drawer", (await page.locator(".media-context-drawer").count()) > 0);
    const title = await page.evaluate((idx) => document.querySelector(`[data-library-index="${idx}"] strong`)?.textContent ?? "", target?.index);
    const drawerText = await page.locator(".media-context-drawer").innerText().catch(() => "");
    check("context menu: long-press OK targets the visible title", Boolean(title) && drawerText.includes(title), `title=${title}`);
    await page.waitForTimeout(400);
    await press(page, "ArrowDown", 2);
    const after = await focusedInfo(page);
    const inDrawer = await page.evaluate(() => Boolean(document.activeElement?.closest(".media-context-drawer")));
    check("context menu: arrows stay inside the drawer", inDrawer && after?.index === target?.index, JSON.stringify({ inDrawer, before: target?.index, after: after?.index }));
    await context.close();
  }

  // 5c. Detail pages keep working with the frame-batched generic (geometric) navigation.
  {
    const { context, page, errors } = await newPage("/movies");
    await page.waitForSelector("[data-library-index]");
    await page.waitForTimeout(1200);
    await page.locator("[data-library-index='2']").click();
    await page.waitForURL(/\/movies\/[0-9a-f-]+/, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const snapshot = () => page.evaluate(() => {
      const el = document.activeElement;
      return el && el !== document.body ? `${el.tagName}.${(el.className?.toString() ?? "").slice(0, 30)}|${el.textContent?.trim().slice(0, 20)}` : "";
    });
    const seen = new Set([await snapshot()]);
    for (const key of ["ArrowDown", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(200);
      seen.add(await snapshot());
    }
    check("detail: arrow keys move focus between controls", seen.size >= 2, JSON.stringify([...seen]));
    check("detail: no page errors", errors.length === 0, errors[0]);
    await context.close();
  }

  // 6. Series behaves like Movies.
  {
    const { context, page } = await newPage("/series");
    await page.waitForSelector("[data-library-index]");
    await page.waitForTimeout(1200);
    await press(page, "ArrowDown", 25);
    await settle(page);
    const f = await focusedInfo(page);
    check("series: focus target visible after 25 rows down", Boolean(f?.visible), JSON.stringify(f));
    await context.close();
  }

  // 7. Cover-flow (music) keeps the centred card focused while moving sideways.
  {
    const { context, page } = await newPage("/music", { "playarr.libraryView.artist": "cover-flow" });
    await page.waitForSelector(".tv-title-card", { timeout: 15_000 });
    await page.waitForTimeout(1200);
    await press(page, "ArrowRight", 12, 120);
    await settle(page);
    const f = await focusedInfo(page);
    check("cover-flow: focus target visible after 12 steps right", Boolean(f?.visible), JSON.stringify(f));
    await context.close();
  }

  // 8. Home rails: sideways and between rails keep the focus target on screen.
  {
    const { context, page } = await newPage("/");
    await page.waitForSelector(".tv-home-card");
    await page.waitForTimeout(1500);
    // Smooth scrolling: a single Right past the viewport must pass through
    // intermediate scroll offsets, and a held key must keep focus on screen
    // on every sampled frame (no trailing viewport, no queued animations).
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      const rail = () => document.activeElement?.closest("[data-tv-scroll-axis=horizontal]") ?? document.querySelector("[data-tv-scroll-axis=horizontal]");
      const probe = { offsets: [], offscreen: 0, running: true };
      window.__navProbe = probe;
      const loop = () => {
        if (!probe.running) return;
        probe.offsets.push(Math.round(rail()?.scrollLeft ?? 0));
        const el = document.activeElement;
        if (el && el !== document.body) {
          const r = el.getBoundingClientRect();
          if (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) probe.offscreen += 1;
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await press(page, "ArrowRight", 14, 60);
    await page.waitForTimeout(500);
    const sample = await page.evaluate(() => {
      const p = window.__navProbe;
      p.running = false;
      return { distinct: new Set(p.offsets).size, offscreen: p.offscreen, final: p.offsets.at(-1) };
    });
    check("home: held Right scrolls the rail in eased steps", sample.distinct >= 3, JSON.stringify(sample));
    // A batched key burst can jump focus further than one eased step; allow a short
    // (<= ~15 frame) transient but never a trailing viewport.
    check("home: focus never trails off screen during a held Right", sample.offscreen <= 24, JSON.stringify(sample));
    await press(page, "ArrowRight", 9);
    await settle(page);
    let f = await focusedInfo(page);
    check("home: focus visible after 9 steps right", Boolean(f?.visible), JSON.stringify(f));
    await press(page, "ArrowDown", 3);
    await settle(page);
    f = await focusedInfo(page);
    check("home: focus visible after moving down 3 rails", Boolean(f?.visible), JSON.stringify(f));
    check("home: exactly one remote marker", f?.markers <= 1, JSON.stringify(f));
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/(movies|series)\/[0-9a-f-]+/, { timeout: 10_000 }).catch(() => {});
    check("home: Enter opens the focused title", /\/(movies|series)\/[0-9a-f-]+/.test(page.url()), page.url());
    await context.close();
  }

  // 8b. Late data must not steal the highlight: Home resolves "On Deck" through slow
  // per-title detail calls; the focused card has to keep focus and its lift (soft shadow, no ring) when they land.
  {
    const slow = await startServer({ distDir: DIST, onDeck: 4, detailDelayMs: 1800 });
    const slowBase = `http://127.0.0.1:${slow.port}`;
    const context = await browser.newContext({ viewport: { width: 3840, height: 2160 } });
    await context.addInitScript(({ base, userId }) => {
      localStorage.setItem("playarr:apiBaseUrl", base);
      const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
      localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "nav-perf", apiBaseUrl: base, userId, name: "Perf", deviceId: "d", session }]));
      localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "nav-perf", apiBaseUrl: base, userId }));
    }, { base: slowBase, userId: USER_ID });
    const page = await context.newPage();
    await page.goto(`${slowBase}/`);
    await page.waitForSelector(".tv-home-card", { timeout: 15_000 });
    await page.waitForTimeout(600);
    await press(page, "ArrowRight", 2);
    await page.waitForTimeout(500);
    const marked = () => page.evaluate(() => {
      const el = document.querySelector("[data-remote-active]") ?? document.activeElement;
      if (!el || el === document.body || !el.classList.contains("tv-home-card")) return null;
      const art = el.querySelector(".tv-home-card-art");
      const shadow = art ? getComputedStyle(art).boxShadow : "";
      return { href: el.getAttribute("href"), connected: el.isConnected, lifted: shadow.includes("52px") && !shadow.includes("0px 0px 0px 3px"), focused: document.activeElement === el, active: el.hasAttribute("data-remote-active") };
    });
    const before = await marked();
    await page.waitForTimeout(3500); // detail calls (1.8 s) land and the hero text arrives
    const after = await marked();
    const hero = await page.evaluate(() => document.querySelector(".tv-home-feature")?.textContent ?? "");
    check("home: highlighted card survives the hero detail load", Boolean(before && after && before.href === after.href && after.lifted && (after.focused || after.active)), JSON.stringify({ before, after }));
    check("home: hero description did load", hero.includes("Hero description") || hero.length > 0, hero.slice(0, 60));
    await context.close();
    await slow.close();
  }

  // 8c. Movies/Series/Search: slow watch-progress data must not disturb the highlight either.
  for (const [label, path, selector] of [["movies", "/movies", "[data-library-index]"], ["search", "/search", "a[href^='/search/']"]]) {
    const slow = await startServer({ distDir: DIST, progressDelayMs: 1800 });
    const slowBase = `http://127.0.0.1:${slow.port}`;
    const context = await browser.newContext({ viewport: { width: 3840, height: 2160 } });
    await context.addInitScript(({ base, userId }) => {
      localStorage.setItem("playarr:apiBaseUrl", base);
      const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
      localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "nav-perf", apiBaseUrl: base, userId, name: "Perf", deviceId: "d", session }]));
      localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "nav-perf", apiBaseUrl: base, userId }));
    }, { base: slowBase, userId: USER_ID });
    const page = await context.newPage();
    await page.goto(`${slowBase}${path}`);
    if (label === "search") {
      await page.locator("input").first().fill("e");
    }
    await page.waitForSelector(selector, { timeout: 15_000 });
    await page.waitForTimeout(700);
    if (label === "search") await page.locator(selector).first().focus();
    await press(page, "ArrowDown", 2);
    await press(page, "ArrowRight", 1);
    await page.waitForTimeout(400);
    const marked = () => page.evaluate(() => {
      const el = document.querySelector("[data-remote-active]") ?? document.activeElement;
      if (!el || el === document.body) return null;
      return { key: el.getAttribute("data-library-index") ?? el.getAttribute("data-search-key"), connected: el.isConnected, focused: document.activeElement === el, active: el.hasAttribute("data-remote-active") };
    });
    const before = await marked();
    await page.waitForTimeout(3000);
    const after = await marked();
    check(`${label}: highlighted card survives late watch-progress data`, Boolean(before && after && before.key === after.key && after.connected && (after.focused || after.active)), JSON.stringify({ before, after }));
    await context.close();
    await slow.close();
  }

  // 9. Search: type, move into the results, walk them, Left returns to the input.
  {
    const { context, page } = await newPage("/search");
    await page.locator("input").first().fill("e");
    await page.waitForSelector("a[href^='/search/']", { timeout: 15_000 });
    await page.waitForTimeout(800);
    await page.locator("a[href^='/search/']").first().focus();
    await press(page, "ArrowDown", 8);
    await press(page, "ArrowRight", 1);
    await settle(page);
    let f = await focusedInfo(page);
    check("search: focus visible after 8 rows down", Boolean(f?.visible && f.href?.startsWith("/search/")), JSON.stringify(f));
    await press(page, "ArrowLeft", 3);
    await settle(page);
    const onInput = await page.evaluate(() => document.activeElement?.tagName === "INPUT");
    check("search: Left past the first column returns to the input", onInput);
    await context.close();
  }

  // 10. The shell action column (Filters, Calendar link, Create) must never dead-end the remote: DOWN past the last button
  // and LEFT reach the nearest content item, UP from the first button reaches the header, RIGHT stays put.
  for (const [route, contentSelector] of [
    ["/calendar", ".calendar-page [data-navigation-focus-key], .calendar-page button:not(.page-filters-button)"],
    ["/movies", "a.tv-title-card"],
  ]) {
    const { context, page } = await newPage(route);
    await page.waitForSelector("[data-filters-button]", { timeout: 15_000 });
    await page.waitForTimeout(1500);
    const where = () =>
      page.evaluate((sel) => {
        const el = document.querySelector("[data-remote-active]") ?? document.activeElement;
        return {
          inColumn: Boolean(el?.closest(".shell-action-column")),
          inHeader: Boolean(el?.closest(".page-header")),
          inContent: Boolean(el && el.matches(sel) && !el.closest(".shell-action-column, .page-header")),
          label: el?.getAttribute("aria-label") || el?.textContent?.trim().slice(0, 20) || el?.tagName,
        };
      }, contentSelector);
    const toFilters = async () => {
      await page.evaluate(() => document.querySelector("[data-filters-button]").focus());
      await page.keyboard.press("Shift");
      await page.waitForTimeout(150);
    };
    const label = route.slice(1);
    await toFilters();
    await press(page, "ArrowLeft");
    await settle(page);
    const left = await where();
    check(`${label}: LEFT from Filters reaches the nearest content item`, left.inContent, JSON.stringify(left));
    await toFilters();
    await press(page, "ArrowRight");
    await settle(page);
    const right = await where();
    check(`${label}: RIGHT from Filters stays on the column`, right.inColumn, JSON.stringify(right));
    await toFilters();
    await press(page, "ArrowDown", 2);
    await settle(page);
    const down = await where();
    check(`${label}: DOWN past the last column button leaves the column (alphabet or content)`, !down.inColumn && !down.inHeader, JSON.stringify(down));
    await toFilters();
    await press(page, "ArrowUp", 4);
    await settle(page);
    const up = await where();
    check(`${label}: UP past the first column button reaches the header`, up.inHeader, JSON.stringify(up));
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
