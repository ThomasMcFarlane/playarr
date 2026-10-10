#!/usr/bin/env node
// Every focusable circular avatar draws its focus ring on the circle, not on its square tile (owner 2026-10-10).
//   node scripts/avatar-focus-circle-e2e.mjs [--dist dir] [--no-build]
// Surfaces: the "Who's watching?" tiles (profile and add tile) and the Settings avatar presets, at 1920x1080 and
// 1280x720 in both themes. The host (button) has no outline or box-shadow; the circle (border-radius 50%) has the shadow.
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({}, { realisticAuth: true });
const surfaces = [
  { name: "profile picker", path: "/profiles", host: ".profile-avatar-button.circle-focus-host", target: ".profile-avatar.circle-focus-target" },
  { name: "avatar presets", path: "/settings/profile-avatar", host: ".profile-avatar-preset.circle-focus-host", target: ".circle-focus-target" },
];
for (const theme of ["dark", "light"]) {
  for (const [width, height] of [[1920, 1080], [1280, 720]]) {
    for (const s of surfaces) {
      const label = `${s.name} ${theme} ${width}x${height}`;
      const { page, context } = await open(s.path, { width, height, init: `localStorage.setItem("playarr-theme", "${theme}")` });
      await page.waitForSelector(s.host, { timeout: 15000 }).catch(() => {});
      await page.keyboard.press("Tab");
      const r = await page.evaluate(([h, t]) => ({ ...(window.__f = null), ...(() => {
        const host = document.querySelector(h);
        const tgt = host?.querySelector(t) ?? document.querySelector(t);
        if (!host || !tgt) return { missing: true };
        host.focus({ focusVisible: true });
        const hs = getComputedStyle(host), ts = getComputedStyle(tgt);
        return { focused: document.activeElement === host, hostOutline: hs.outlineStyle !== "none" && parseFloat(hs.outlineWidth) > 0, hostShadow: hs.boxShadow !== "none", targetShadow: ts.boxShadow, radius: ts.borderRadius };
      })() }), [s.host, s.target]);
      await page.waitForTimeout(400);
      const r2 = await page.evaluate(([h, t]) => {
        const host = document.querySelector(h);
        const tgt = host?.querySelector(t) ?? document.querySelector(t);
        const ts = getComputedStyle(tgt);
        const hs = getComputedStyle(host);
        return { hostOutline: hs.outlineStyle !== "none" && parseFloat(hs.outlineWidth) > 0, hostShadow: hs.boxShadow !== "none", targetShadow: ts.boxShadow, radius: ts.borderRadius };
      }, [s.host, s.target]);
      check(`${label}: circle exists and is focused`, !r.missing && r.focused, JSON.stringify(r));
      check(`${label}: circle has the ring shadow, border-radius 50%`, r2.targetShadow !== "none" && /50%/.test(r2.radius), JSON.stringify(r2));
      check(`${label}: square host has no outline or box-shadow`, !r2.hostOutline && !r2.hostShadow, JSON.stringify(r2));
      if (width === 1920) await page.screenshot({ path: `${process.env.SHOT_DIR ?? "/tmp"}/avatar-focus-${s.name.replace(" ", "-")}-${theme}.png` });
      await context.close();
    }
  }
}
await finish();
