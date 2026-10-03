import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMPLETE_CLIENT_ROUTES,
  COMPLETE_CLIENT_SHELL_ROUTES,
  PRODUCT_NAV_GROUPS,
  PRODUCT_SETTINGS_SECTIONS,
  intentionalDegradationsFor,
  parityChecklistRows,
  productSurfaceParityGaps,
  productSurfacesFor,
  usesDeviceCodeLogin,
  usesTenFootChrome,
} from "./productSurfaces";

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "../App.tsx"), "utf8");
const settingsIndexSource = readFileSync(
  join(here, "../pages/settings/Index.tsx"),
  "utf8"
);
const globalCss = readFileSync(join(here, "../styles/global.css"), "utf8");
const mainSource = readFileSync(join(here, "../main.tsx"), "utf8");
const loginSource = readFileSync(join(here, "../pages/Login.tsx"), "utf8");
const deviceLoginSource = readFileSync(
  join(here, "../components/DeviceLogin.tsx"),
  "utf8"
);

describe("productSurfaces — complete client catalogue", () => {
  it("lists every required product surface from client principles", () => {
    const ids = COMPLETE_CLIENT_ROUTES.map((route) => route.id);
    for (const required of [
      "login",
      "qr-login",
      "profiles",
      "home",
      "search",
      "series",
      "movies",
      "sites",
      "music",
      "playlists",
      "watchlist",
      "player",
      "settings",
      "settings-appearance",
      "settings-profile-avatar",
      "settings-language",
      "settings-player",
      "settings-server",
      "settings-profile-lock",
      "settings-invite",
      "settings-request-latency",
      "clients",
      "downloads",
    ]) {
      expect(ids, `missing surface ${required}`).toContain(required);
    }
  });

  it("registers the same shell nav hierarchy for every complete client", () => {
    const targets = PRODUCT_NAV_GROUPS.flatMap((group) =>
      group.items.map((item) => item.to)
    );
    expect(targets).toEqual([
      "/downloads",
      "/search",
      "/",
      "/series",
      "/movies",
      "/sites",
      "/music",
      "/playlists",
      "/watchlist",
    ]);
  });

  it("registers all nine settings sections", () => {
    expect(PRODUCT_SETTINGS_SECTIONS.map((section) => section.to)).toEqual([
      "/settings/appearance",
      "/settings/profile-avatar",
      "/settings/language",
      "/settings/player",
      "/settings/server",
      "/settings/profile-lock",
      "/settings/invite",
      "/settings/request-latency",
      "/settings/remote",
    ]);
  });
});

describe("productSurfaces — web vs tv-vidaa parity", () => {
  it("exposes identical routes, nav, and settings for web and tv-vidaa", () => {
    const web = productSurfacesFor("web");
    const vidaa = productSurfacesFor("tv-vidaa");
    expect(productSurfaceParityGaps(web, vidaa)).toEqual([]);
    expect(vidaa.routeIds).toEqual(web.routeIds);
    expect(vidaa.navTargets).toEqual(web.navTargets);
    expect(vidaa.settingsPaths).toEqual(web.settingsPaths);
  });

  it("allows only documented TV degradations on tv-vidaa", () => {
    const degradations = intentionalDegradationsFor("tv-vidaa");
    const ids = degradations.map((item) => item.id).sort();
    expect(ids).toEqual(
      [
        "auth-device-code",
        "custom-avatar-upload",
        "downloads-storage",
        "playback-codecs",
        "ten-foot-chrome",
      ].sort()
    );
    expect(intentionalDegradationsFor("web")).toEqual([]);
  });

  it("uses device-code login and ten-foot chrome only on TV identities", () => {
    expect(usesDeviceCodeLogin("web")).toBe(false);
    expect(usesTenFootChrome("web")).toBe(false);
    expect(usesDeviceCodeLogin("tv-vidaa")).toBe(true);
    expect(usesTenFootChrome("tv-vidaa")).toBe(true);
    expect(usesTenFootChrome("android-tv")).toBe(true);
  });

  it("ships a full parity checklist covering criteria surfaces", () => {
    const rows = parityChecklistRows();
    expect(rows.length).toBeGreaterThanOrEqual(18);
    const ids = rows.map((row) => row.id);
    for (const required of [
      "auth-profiles",
      "home",
      "search",
      "library-series",
      "library-movies",
      "library-sites",
      "library-music",
      "work-detail",
      "playlists",
      "player",
      "settings-all",
      "clients",
      "errors-offline",
      "nav-shell",
      "style-tokens",
      "style-scroll",
    ]) {
      expect(ids).toContain(required);
    }
  });
});

describe("productSurfaces — shipped App wiring (real entry points)", () => {
  it("App.tsx routes every complete-client path from productSurfaces", () => {
    for (const route of COMPLETE_CLIENT_ROUTES) {
      if (route.path === "/") {
        expect(appSource).toMatch(/path=["']\/["']/);
        continue;
      }
      // Nested settings use relative path segments under /settings.
      if (route.path.startsWith("/settings/") && route.path !== "/settings") {
        const segment = route.path.slice("/settings/".length);
        expect(
          appSource,
          `App.tsx missing settings segment ${segment}`
        ).toContain(`path="${segment}"`);
        continue;
      }
      expect(
        appSource,
        `App.tsx missing route path ${route.path}`
      ).toContain(`path="${route.path}"`);
    }
  });

  it("App.tsx derives shell nav from PRODUCT_NAV_GROUPS", () => {
    expect(appSource).toContain("PRODUCT_NAV_GROUPS");
    expect(appSource).toContain('from "./lib/productSurfaces"');
  });

  it("settings Index derives sections from PRODUCT_SETTINGS_SECTIONS", () => {
    expect(settingsIndexSource).toContain("PRODUCT_SETTINGS_SECTIONS");
    expect(settingsIndexSource).toContain(
      'from "../../lib/productSurfaces"'
    );
  });

  it("main.tsx stamps data-platform from resolveClientPlatform", () => {
    expect(mainSource).toContain(
      "document.documentElement.dataset.platform = PLAYARR_CLIENT_PLATFORM"
    );
  });

  it("Login uses device-code for TVs and offers it to ordinary Web users", () => {
    expect(loginSource).toContain("DeviceLogin");
    expect(loginSource).toContain('t("pages.login.qrSubmit")');
    expect(loginSource).toContain("embedded");
    expect(loginSource).toContain("hostedLink");
    expect(appSource).toContain(
      '<Route path="/login/qr" element={<QrLoginPage />} />'
    );
  });

  it("DeviceLogin marks a real scroll container and displays code expiry", () => {
    expect(deviceLoginSource).toContain("data-tv-scroll-container");
    expect(deviceLoginSource).toContain(
      'data-navigation-scroll-key="auth:device-login"'
    );
    expect(deviceLoginSource).toContain('role="timer"');
    expect(deviceLoginSource).toContain("formatDeviceCodeCountdown");
  });

  it("ten-foot CSS applies to both android-tv and tv-vidaa", () => {
    expect(globalCss).toContain(
      'html:is([data-platform="android-tv"], [data-platform="tv-vidaa"])'
    );
  });

  it("shell routes include player and all library kinds", () => {
    const shellPaths = COMPLETE_CLIENT_SHELL_ROUTES.map((route) => route.path);
    expect(shellPaths).toContain("/player/:mediaFileId");
    expect(shellPaths).toContain("/series");
    expect(shellPaths).toContain("/movies");
    expect(shellPaths).toContain("/sites");
    expect(shellPaths).toContain("/music");
  });
});
