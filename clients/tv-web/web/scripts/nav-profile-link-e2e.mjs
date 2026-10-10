#!/usr/bin/env node
// The profile item at the foot of the left nav is a real link (`<a href="/profiles">`): a plain click navigates
// client-side without a reload, Ctrl-click and middle-click open a new tab, and the keyboard and D-pad still work. It is
// also a square nav tile in its own group, the same size as the other tiles, with a truncated one-line short name, and
// it overlaps no other nav item and no page content at any supported size.
//
//   node scripts/nav-profile-link-e2e.mjs [--no-build] [--dist dir] [--shots dir]
import { mkdirSync } from "node:fs";
import { boot, opt } from "./e2e-common.mjs";

const { base, check, open, finish } = await boot({ canDownload: true, playlists: 1, folders: true, watchlist: 1 });
const shots = opt("shots", "");
if (shots) mkdirSync(shots, { recursive: true });
const PROFILE = ".app-user-identity";

const sizes = [
  [1920, 1080, "1920"],
  [1366, 768, "1366"],
  [1280, 720, "1280"],
  [820, 1180, "tablet"],
  [390, 844, "phone"],
];
const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

for (const [width, height, tag] of sizes) {
  for (const route of ["/", "/movies", "/calendar"]) {
    const { context, page } = await open(route, { width, height });
    const label = `${tag} ${route}`;
    await page.waitForSelector(PROFILE, { timeout: 15000 });
    await page.waitForTimeout(600);
    const m = await page.evaluate((sel) => {
      const rect = (e) => e.getBoundingClientRect().toJSON();
      const el = document.querySelector(sel);
      const links = [...document.querySelectorAll(".app-nav-link")].filter((e) => e !== el);
      const std = links[0];
      const name = el.querySelector(".app-user-name");
      const cs = getComputedStyle(name);
      const visible = (e) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
      };
      const content = [...document.querySelectorAll(".app-main *")]
        .filter((e) => !e.closest(".tv-key-art, [aria-hidden='true']") && e.children.length === 0 && visible(e) && (e.textContent.trim() || e.tagName === "IMG" || e.tagName === "BUTTON" || e.tagName === "A"))
        .map((e) => ({ tag: e.className || e.tagName, ...rect(e) }));
      const clock = [...document.querySelectorAll(".app-header *")].filter((e) => e.children.length === 0 && visible(e)).map((e) => ({ tag: "header", ...rect(e) }));
      const logoEl = document.querySelector(".app-logo-icon");
      const verEl = document.querySelector(".app-user-version");
      const navEl = document.querySelector(".app-nav");
      const groupEl = el.closest(".app-nav-group-profile");
      return {
        logo: logoEl && visible(logoEl) ? rect(logoEl) : null,
        ver: verEl && visible(verEl) ? rect(verEl) : null,
        verInGroup: Boolean(verEl && groupEl && groupEl.contains(verEl)),
        nav: rect(navEl),
        group: groupEl ? rect(groupEl) : null,
        navPadBottom: parseFloat(getComputedStyle(navEl).paddingBottom),
        tagName: el.tagName,
        href: el.getAttribute("href"),
        el: rect(el),
        std: std ? rect(std) : null,
        others: links.map((e) => ({ label: e.getAttribute("aria-label"), ...rect(e) })),
        text: name.textContent.trim(),
        labelShown: visible(name),
        nowrap: cs.whiteSpace === "nowrap" && cs.textOverflow === "ellipsis",
        labelH: name.getBoundingClientRect().height,
        lineH: parseFloat(cs.fontSize),
        title: el.getAttribute("title"),
        aria: el.getAttribute("aria-label"),
        content: [...content, ...clock],
        vw: innerWidth,
        vh: innerHeight,
      };
    }, PROFILE);
    check(`${label}: profile item is a real <a href="/profiles">`, m.tagName === "A" && m.href === "/profiles", `${m.tagName} ${m.href}`);
    check(`${label}: profile tile is the same size as a standard nav tile (+-1px)`, m.std && Math.abs(m.el.width - m.std.width) <= 1 && Math.abs(m.el.height - m.std.height) <= 1, JSON.stringify({ p: [m.el.width, m.el.height], s: [m.std?.width, m.std?.height] }));
    const phone = tag === "phone";
    check(`${label}: short name label is present, one line, ellipsis`, (phone || m.labelShown) && m.text.length > 0 && m.nowrap && (phone || m.labelH < m.lineH * 2), JSON.stringify({ text: m.text, nowrap: m.nowrap, h: m.labelH }));
    check(`${label}: full name in accessible name and title`, Boolean(m.title) && m.aria.includes(m.title), `${m.aria} / ${m.title}`);
    const hitNav = m.others.filter((o) => overlaps(m.el, o));
    check(`${label}: profile tile overlaps no other nav item`, hitNav.length === 0, JSON.stringify(hitNav.map((o) => o.label)));
    // On phone the nav is a floating bottom bar that page content scrolls beneath for every tile alike: the tile must sit
    // inside that bar instead.
    const hitContent = phone ? [] : m.content.filter((c) => overlaps(m.el, c));
    check(`${label}: profile tile overlaps no page content, clock or panel`, hitContent.length === 0, JSON.stringify(hitContent.slice(0, 3)));
    const logoHit = m.logo ? m.others.concat([{ label: "profile", ...m.el }]).filter((o) => overlaps(m.logo, o)) : [];
    check(`${label}: the Playarr logo overlaps no nav item`, logoHit.length === 0, JSON.stringify({ logo: m.logo, hit: logoHit.map((o) => o.label) }));
    if (phone) {
      check(`${label}: profile tile is inside the nav bar`, m.el.left >= m.nav.left - 0.5 && m.el.right <= m.nav.right + 0.5 && m.el.top >= m.nav.top - 0.5 && m.el.bottom <= m.nav.bottom + 0.5, JSON.stringify({ el: m.el, nav: m.nav }));
    } else {
      check(`${label}: the version sits below the profile tile, outside its group`, m.ver && !m.verInGroup && m.ver.top >= m.group.bottom - 0.5 && m.ver.top >= m.el.bottom - 0.5, JSON.stringify({ ver: m.ver, group: m.group, inGroup: m.verInGroup }));
      check(`${label}: profile group and version sit at the bottom of the nav`, m.ver && m.nav.bottom - m.ver.bottom <= m.navPadBottom + 6 && m.group.bottom <= m.ver.top + 0.5, JSON.stringify({ navBottom: m.nav.bottom, verBottom: m.ver?.bottom, pad: m.navPadBottom }));
    }
    check(`${label}: profile tile is on screen`, m.el.top >= -0.5 && m.el.left >= -0.5 && m.el.bottom <= m.vh + 0.5 && m.el.right <= m.vw + 0.5, JSON.stringify(m.el));
    if (route === "/movies") {
      // A long name truncates with an ellipsis instead of wrapping or widening the tile.
      const long = await page.evaluate((sel) => {
        const name = document.querySelector(sel + " .app-user-name");
        const el = document.querySelector(sel);
        const before = el.getBoundingClientRect();
        name.textContent = "Bartholomew-Maximilian";
        const after = el.getBoundingClientRect();
        return { dw: Math.abs(after.width - before.width), dh: Math.abs(after.height - before.height), clipped: name.scrollWidth > name.clientWidth, h: name.getBoundingClientRect().height };
      }, PROFILE);
      check(`${label}: a long name is truncated, tile unchanged`, long.dw <= 0.5 && long.dh <= 0.5 && (phone || long.clipped), JSON.stringify(long));
      if (shots) {
        for (const theme of ["light", "dark"]) {
          await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${shots}/profile-tile-${tag}-${theme}.png` });
        }
      }
    }
    await context.close();
  }
}

// Behaviour: plain click is client-side, modifier and middle click open a new page, keyboard and D-pad work.
{
  const { context, page } = await open("/movies", { width: 1920, height: 1080 });
  await page.waitForSelector(PROFILE);
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__noReload = "same-document"; });
  await page.click(PROFILE);
  await page.waitForURL("**/profiles");
  check("plain click navigates to /profiles without a full reload", (await page.evaluate(() => window.__noReload)) === "same-document");
  await context.close();
}
for (const [name, opts] of [["Ctrl-click", { modifiers: ["Control"] }], ["middle-click", { button: "middle" }]]) {
  const { context, page } = await open("/movies", { width: 1920, height: 1080 });
  await page.waitForSelector(PROFILE);
  await page.waitForTimeout(600);
  const popup = context.waitForEvent("page", { timeout: 8000 }).catch(() => null);
  await page.click(PROFILE, opts);
  const tab = await popup;
  check(`${name} opens a new tab`, Boolean(tab));
  if (tab) {
    await tab.waitForLoadState("domcontentloaded").catch(() => undefined);
    check(`${name} new tab is at /profiles`, new URL(tab.url()).pathname === "/profiles", tab.url());
  }
  check(`${name} leaves the current page in place`, new URL(page.url()).pathname === "/movies", page.url());
  await context.close();
}
for (const [width, height] of [[1920, 1080], [1280, 720]]) {
  const label = `${width}x${height}`;
  const { context, page } = await open("/", { width, height });
  await page.waitForSelector(PROFILE);
  await page.waitForTimeout(600);
  await page.locator(PROFILE).focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(400);
  check(`${label}: DOWN on the profile tile stays on it`, await page.evaluate(() => Boolean(document.activeElement?.closest(".app-user-identity"))));
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(400);
  check(`${label}: UP moves to the previous nav tile`, await page.evaluate(() => document.activeElement?.classList.contains("app-nav-link") && !document.activeElement.classList.contains("app-user-identity")));
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(400);
  check(`${label}: DOWN returns to the profile tile`, await page.evaluate(() => Boolean(document.activeElement?.closest(".app-user-identity"))));
  await page.keyboard.press("Enter");
  await page.waitForURL("**/profiles", { timeout: 8000 }).catch(() => undefined);
  check(`${label}: Enter on the focused profile tile opens /profiles`, new URL(page.url()).pathname === "/profiles", page.url());
  await context.close();
}
await finish();
