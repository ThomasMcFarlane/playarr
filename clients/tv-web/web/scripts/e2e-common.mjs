// Shared harness for the keyboard-driven web e2e scripts (nav-back-e2e, nav-focus-e2e): builds dist, starts the
// deterministic mock API of nav-perf, launches Chromium and signs a profile in.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startServer } from "./nav-perf/server.mjs";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
export const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
export const USER_ID = "00000000-0000-4000-8000-000000000001";

/**
 * A signed-in test session whose access token is JWT-shaped (`sub` = the user id). The app names its query cache
 * scope from that claim, so with the opaque token the other scripts use the stale-while-revalidate cache is OFF. A
 * script that checks Back/revisit behaviour boots with `{ realisticAuth: true }` to exercise the cache as production does.
 */
const jwtFor = (userId) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: userId, exp: Math.floor(Date.now() / 1000) + 86_400 })}.sig`;
};

export async function boot(serverOptions = {}, { realisticAuth = false } = {}) {
  const dist = opt("dist", join(root, "dist"));
  if (!args.includes("--no-build") && !opt("dist", "")) {
    const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: root, stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  const server = await startServer({ distDir: dist, movies: 24, series: 8, artists: 0, ...serverOptions });
  const defaultBase = `http://127.0.0.1:${server.port}`;
  const base = defaultBase;
  const dir = join(homedir(), ".cache/ms-playwright");
  const full = existsSync(dir) ? readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
  const exe = process.env.NAV_PERF_CHROMIUM || (full ? join(dir, full, "chrome-linux64/chrome") : undefined);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
  };
  // `server` (optional) is another mock started with `startServer`: the page then signs in to that one.
  async function open(path, { width = 1920, height = 1080, theme = "dark", server: other, init } = {}) {
    const base = other ? `http://127.0.0.1:${other.port}` : defaultBase;
    const context = await browser.newContext({ viewport: { width, height } });
    if (init) await context.addInitScript(init);
    await context.addInitScript(
      ({ base, userId, token }) => {
        try {
          localStorage.setItem("playarr:apiBaseUrl", base);
          const session = { accessToken: token, refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
          localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "e2e", apiBaseUrl: base, userId, name: "E2E", deviceId: "d", session }]));
          localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "e2e", apiBaseUrl: base, userId }));
        } catch {}
      },
      { base, userId: USER_ID, token: realisticAuth ? jwtFor(USER_ID) : "t" }
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}${path}`);
    await page.waitForTimeout(900);
    return { context, page, errors };
  }
  async function finish() {
    await browser.close();
    server.close?.();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
  }
  return { base, browser, server, check, open, finish };
}

/** Dispatch a TV remote BACK key that Playwright's keyboard cannot synthesise (keyCode only). */
export const pressKeyCode = (page, keyCode, key = "Unidentified") =>
  page.evaluate(
    ([code, k]) => {
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(new KeyboardEvent("keydown", { key: k, keyCode: code, bubbles: true, cancelable: true }));
    },
    [keyCode, key]
  );

export const BACK_KEYS = [
  ["Escape", (p) => p.keyboard.press("Escape")],
  ["Backspace", (p) => p.keyboard.press("Backspace")],
  ["BrowserBack", (p) => pressKeyCode(p, 0, "BrowserBack")],
  ["Tizen 10009", (p) => pressKeyCode(p, 10009)],
  ["webOS 461", (p) => pressKeyCode(p, 461)],
];

export const focusInfo = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-remote-active]") ?? document.activeElement;
    if (!el || el === document.body) return null;
    return {
      tag: el.tagName,
      cls: el.className?.toString() ?? "",
      label: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? "",
      href: el.getAttribute("href"),
      inNav: Boolean(el.closest(".app-nav")),
    };
  });
