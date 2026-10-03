import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../lib/i18n/LanguageProvider";
import { ThemeProvider } from "../lib/theme";
import { ClientsPage } from "./Clients";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((message) => {
    if (!String(message).includes("useLayoutEffect does nothing on the server")) {
      throw new Error(`Unexpected console.error: ${String(message)}`);
    }
  });
});

afterAll(() => consoleErrorSpy.mockRestore());

function renderPage(page: React.ReactNode, path: string): string {
  return renderToStaticMarkup(
    <ThemeProvider>
      <LanguageProvider>
        <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>
      </LanguageProvider>
    </ThemeProvider>
  );
}

/**
 * Bare "/clients" and "/clients/:clientId" are a single route (see the
 * "/clients/:clientId?" route in App.tsx) so that React never
 * unmounts/remounts the tiles between the grid and stack -- that's what
 * lets a click morph one into the other instead of cutting between two
 * separately-rendered pages. Mirrors that with one route here too.
 */
function renderClientRoute(path: string): string {
  return renderPage(
    <Routes>
      <Route path="/clients/:clientId?" element={<ClientsPage />} />
    </Routes>,
    path
  );
}

/**
 * How many platform tiles render. Every /clients URL must show the same
 * complete set, so the per-route assertions compare against this rather
 * than a literal -- adding a client should not require editing counts
 * scattered through this file.
 */
function allClientTileCount(): number {
  return (renderClientRoute("/clients").match(/id="client-[a-z]+"/g) ?? []).length;
}

describe("ClientsPage", () => {
  describe("bare /clients (grid landing page)", () => {
    it("shows every client as an equal-sized bubble, none of them active", () => {
      const markup = renderClientRoute("/clients");

      expect(markup).toContain('class="clients-coverflow is-grid"');
      expect(markup).not.toContain("is-active");
      expect(markup).not.toContain('aria-current="page"');
      // The index itself isn't any one client's page, so it keeps the
      // page-level "Clients" title rather than borrowing one client's.
      expect(markup).toContain('data-navigation-scroll-key="clients:index"');
      expect(markup).not.toContain("client-details-content");
      for (const client of [
        "vidaa",
        "android",
        "apple",
        "webos",
        "tizen",
        "roku",
        "chromecast",
        "xbox",
        "harmony",
        "firetv",
        "server",
      ]) {
        expect(markup).toContain(`id="client-${client}"`);
      }
    });

    it("makes every tile a real, natively-focusable, natively-activatable target", () => {
      // Nothing is privileged yet on the landing grid, and 2D arrow-key
      // movement between bubbles is exactly what the app-wide geometric
      // focus system already does well -- unlike the stack (see below),
      // every tile here should be reachable.
      const markup = renderClientRoute("/clients");

      expect(markup.match(/role="link"/g)).toHaveLength(allClientTileCount());
      expect(markup.match(/tabindex="0"/gi)).toHaveLength(allClientTileCount());
      expect(markup).not.toContain('tabindex="-1"');
      // The first tile is the sensible default focus target for a fresh
      // landing page.
      expect(markup).toMatch(/id="client-vidaa"[^>]*data-tv-focus-default="true"/);
    });

    it("does not rely on the app-wide edge-target/edge-stop focus attributes", () => {
      const markup = renderClientRoute("/clients");

      expect(markup).not.toContain("data-tv-edge-target-left");
      expect(markup).not.toContain("data-tv-edge-target-right");
      expect(markup).not.toContain("data-tv-edge-stop-left");
      expect(markup).not.toContain("data-tv-edge-stop-right");
    });

    it("renders identically whether or not the URL has a trailing slash", () => {
      expect(renderClientRoute("/clients")).toBe(renderClientRoute("/clients/"));
    });
  });

  describe("/clients/:clientId (coverflow + install details)", () => {
    it("does not rely on the app-wide edge-target/edge-stop focus attributes", () => {
      // Left/Right selection is handled by this page's own keydown handler
      // (see nextClientIndex, unit-tested directly in coverflow.test.ts) so
      // that Up/Down can never be misrouted into it -- there's nothing for
      // the shared geometric focus system to do here at all.
      const markup = renderClientRoute("/clients/vidaa");

      expect(markup).not.toContain("data-tv-edge-target-left");
      expect(markup).not.toContain("data-tv-edge-target-right");
      expect(markup).not.toContain("data-tv-edge-stop-left");
      expect(markup).not.toContain("data-tv-edge-stop-right");
    });

    it("makes only the active tile a real, natively-focusable target", () => {
      // The app-wide directional focus system treats every native
      // interactive element (and, per the app's own FOCUSABLE_SELECTOR,
      // even an inactive tabindex="-1" one on some element types) as always
      // reachable -- a focusable non-active tile here would let Up/Down
      // land on it from elsewhere on the page, exactly the bug this markup
      // shape exists to rule out.
      const markup = renderClientRoute("/clients/vidaa");

      expect(markup.match(/role="link"/g)).toHaveLength(allClientTileCount());
      expect(markup.match(/tabindex="0"/gi)).toHaveLength(1);
      expect(markup).toMatch(/id="client-vidaa"[^>]*tabindex="0"/);
      expect(
        markup.match(/tabindex="-1"/gi) ?? []
      ).toHaveLength(allClientTileCount() - 1);
    });

    it("renders the coverflow, with the install details for the active client", () => {
      const markup = renderClientRoute("/clients/vidaa");

      expect(markup).toContain('class="clients-coverflow is-stack"');
      expect(markup).toContain('data-navigation-scroll-key="clients:vidaa"');
      expect(markup).toContain('data-navigation-scroll-key="clients:platforms"');
      expect(markup).toMatch(/class="client-choice is-experimental is-vidaa is-active"/);
      expect(markup).toContain('data-tv-scroll-axis="horizontal"');
      expect(markup).toContain('class="profiles-page profile-auth-page clients-shell"');
      expect(markup).toContain('class="tv-stage-chrome"');
      expect(markup).toContain('class="profile-auth-scroll clients-scroll"');
      expect(markup).not.toContain("Any modern browser");
      expect(markup).not.toContain("The complete Playarr experience, ready now");
      expect(markup).not.toContain("The hosted TV app is available now");
      expect(markup).toContain("Fire TV");
      expect(markup).not.toContain("Coming soon");
      expect(markup).toContain('data-client-icon="android"');
      expect(markup).toContain('data-client-icon="apple"');
      expect(markup).toContain('data-client-icon="lg"');
      expect(markup).toContain('data-client-icon="samsung"');
      expect(markup).toContain('data-client-icon="roku"');
      expect(markup).toContain('data-client-icon="chromecast"');
      expect(markup).toContain('data-client-icon="harmony"');
      expect(markup).toContain('data-client-icon="firetv"');
      expect(markup).toContain('id="client-vidaa"');
      expect(markup).toContain('id="client-roku"');
      expect(markup).toContain('id="client-chromecast"');
      expect(markup).toContain('id="client-firetv"');
      expect(markup).toContain("Chromecast built-in devices");
      expect(markup).toContain("Amazon Fire TV devices");
      expect(markup).toContain("Apple TV");
      expect(markup).toContain("iPhone, iPad and Apple TV");
      expect(markup).toContain('id="client-apple"');
      expect(markup).not.toContain('id="client-apple-tv"');
      expect(markup).toContain("Roku TV");
      expect(markup).not.toContain('id="client-android-action"');
      expect(markup).not.toContain("Download APK");
      expect(markup).not.toContain("Download app");
      for (const client of [
        "vidaa",
        "android",
        "apple",
        "webos",
        "tizen",
        "roku",
        "chromecast",
        "harmony",
        "firetv",
      ]) {
        expect(markup).toContain(`id="client-${client}"`);
      }
      expect(markup).not.toContain("playarr-roku.zip");
      expect(markup).not.toContain("playarr-ios-source.zip");
      expect(markup).not.toContain("playarr-apple-tv-source.zip");
      expect(markup).not.toContain("playarr-webos-developer-bundle.zip");
      expect(markup).not.toContain("playarr-tizen-developer-bundle.zip");
      expect(markup).toContain(
        "Developer packages are served only after a release artifact is published"
      );
      expect(markup).not.toContain('aria-disabled="true"');
      expect(markup).not.toMatch(
        /id="client-(?:vidaa|android)-action"[^>]*aria-expanded=/
      );
      expect(markup).not.toContain('aria-controls="');
      expect(markup).not.toContain('id="android-install-details"');
      expect(markup).not.toContain('id="vidaa-install-details"');
      expect(markup).not.toContain("app-shell");
      expect(markup).not.toContain("clients-header");
    });

    it("falls back to the grid for an id that isn't a real client", () => {
      // react-router's <Navigate> performs its redirect in an effect, which
      // a single renderToStaticMarkup pass never commits -- it contributes
      // no markup of its own, so this route renders empty rather than
      // resolving to the grid's actual markup. The redirect target itself
      // is exercised end to end by the real browser, not this SSR harness.
      const markup = renderClientRoute("/clients/not-a-real-client");

      expect(markup).toBe("");
    });

    it("keeps the platform selector available on every client URL", () => {
      for (const client of [
        "vidaa",
        "android",
        "apple",
        "webos",
        "tizen",
        "roku",
        "chromecast",
        "xbox",
        "harmony",
        "firetv",
        "server",
      ]) {
        const markup = renderClientRoute(`/clients/${client}`);

        expect(markup).toContain('data-navigation-scroll-key="clients:platforms"');
        expect(markup.match(/id="client-[a-z]+"/g)).toHaveLength(allClientTileCount());
        expect(markup.match(/tabindex="0"/gi)).toHaveLength(1);
        expect(markup).toMatch(
          new RegExp(`id="client-${client}"[^>]*tabindex="0"`)
        );
        expect(markup).toMatch(
          new RegExp(`id="client-${client}"[^>]*data-tv-focus-default="true"`)
        );
        expect(markup).toMatch(
          new RegExp(`id="client-${client}"[^>]*aria-current="page"`)
        );
      }
    });

    it("strips a trailing slash the same way the URL itself does", () => {
      expect(renderClientRoute("/clients/roku")).toBe(
        renderClientRoute("/clients/roku/")
      );
    });

    it("renders one responsive APK for mobile and TV on the Android URL", () => {
      const markup = renderClientRoute("/clients/android");

      expect(markup).toContain('data-navigation-scroll-key="clients:android"');
      expect(markup).toContain('data-navigation-scroll-key="clients:platforms"');
      expect(markup).toMatch(
        /class="client-choice is-available is-android is-active"/
      );
      expect(markup).toMatch(
        /id="client-android"[^>]*aria-current="page"/
      );
      expect(markup).toContain(
        'href="https://playarr.app/downloads/android/playarr-android.apk"'
      );
      expect(markup).not.toMatch(/\/downloads\/android\/releases\/\d+\.\d+\.\d+\//);
      expect(markup).toContain('target="_blank"');
      expect(markup).toContain('rel="noopener noreferrer"');
      expect(markup).not.toContain('download=');
      expect(markup).not.toContain("playarr-android-mobile.apk");
      expect(markup).not.toContain("playarr-android-tv.apk");
      expect(markup.match(/data-tv-focus-default="true"/g)).toHaveLength(2);
    });

    it("renders the VIDAA custom store without claiming to operate DNS", () => {
      const markup = renderClientRoute("/clients/vidaa");

      expect(markup).toContain('data-navigation-scroll-key="clients:vidaa"');
      expect(markup).toContain('data-navigation-scroll-key="clients:platforms"');
      expect(markup).toMatch(
        /class="client-choice is-experimental is-vidaa is-active"/
      );
      expect(markup).toContain('aria-label="All clients"');
      expect(markup).toContain('href="https://playarr.app/vidaa-store/"');
      expect(markup).toContain("Playarr does not operate a public DNS resolver");
      expect(markup).toContain("Firmware support varies");
      expect(markup).toContain("Restart and restore DNS");
      expect(markup).toContain("Restore automatic DNS after installation.");
      expect(markup.replace(/<[^>]+>/g, " ")).not.toMatch(
        /\b(?:\d{1,3}\.){3}\d{1,3}\b/
      );
      expect(markup).not.toContain("Activate installer");
    });

    it("publishes complete LG and Samsung developer-mode install paths", () => {
      const webosMarkup = renderClientRoute("/clients/webos");
      const tizenMarkup = renderClientRoute("/clients/tizen");

      expect(webosMarkup).toContain('data-navigation-scroll-key="clients:webos"');
      expect(webosMarkup).toMatch(
        /class="client-choice is-experimental is-lg is-active"/
      );
      expect(webosMarkup).toContain("Available · Developer preview");
      expect(webosMarkup).not.toContain("Coming soon");
      expect(webosMarkup).toContain(
        'href="https://playarr.app/downloads/webos/playarr-webos.ipk"'
      );
      expect(webosMarkup).toContain(
        "only after one has been published"
      );
      expect(webosMarkup).toContain("webOS 23 or newer");
      expect(webosMarkup).toContain(
        "pnpm --filter @playarr-tv/app-webos run package:ipk"
      );
      expect(webosMarkup).toContain("ares-setup-device --add playarr-tv");
      expect(webosMarkup).toContain(
        "ares-novacom --device playarr-tv --getkey"
      );
      expect(webosMarkup).toContain(
        "ares-launch --device playarr-tv com.playarr.tv"
      );
      expect(webosMarkup).toContain(
        'href="https://webostv.developer.lge.com/develop/getting-started/developer-mode-app"'
      );
      expect(webosMarkup).toContain(
        'href="https://github.com/ThomasMcFarlane/playarr/tree/main/clients/tv-web/apps/tv-webos"'
      );

      expect(tizenMarkup).toContain('data-navigation-scroll-key="clients:tizen"');
      expect(tizenMarkup).toMatch(
        /class="client-choice is-experimental is-samsung is-active"/
      );
      expect(tizenMarkup).toContain("Available · Developer preview");
      expect(tizenMarkup).not.toContain("Coming soon");
      expect(tizenMarkup).toContain(
        'href="https://playarr.app/downloads/tizen/playarr-tizen.wgt"'
      );
      expect(tizenMarkup).toContain("only after a signed developer artifact is published");
      expect(tizenMarkup).toContain("Tizen 7.0 or newer");
      expect(tizenMarkup).toContain(
        "tizen package -t wgt -s &lt;certificate-profile&gt; -- apps/tv-tizen/dist"
      );
      expect(tizenMarkup).toContain("sdb connect &lt;TV-IP&gt;");
      expect(tizenMarkup).toContain(
        "tizen run -p StrmarrTV1.Playarr Server -t &lt;target-name&gt;"
      );
      expect(tizenMarkup).toContain(
        'href="https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html"'
      );
      expect(tizenMarkup).toContain(
        'href="https://github.com/ThomasMcFarlane/playarr/tree/main/clients/tv-web/apps/tv-tizen"'
      );

      for (const markup of [webosMarkup, tizenMarkup]) {
        expect(markup).toContain('data-tv-scroll-container="true"');
        expect(markup).toContain('data-tv-scroll-axis="vertical"');
        expect(markup).toContain('data-tv-scroll-axis="horizontal"');
        expect(markup).toContain('target="_blank"');
        expect(markup).toContain('rel="noopener noreferrer"');
        expect(markup.match(/id="client-[a-z]+"/g)).toHaveLength(allClientTileCount());
        // Unlike Android, the smart-TV install guide has no download link of
        // its own with data-tv-focus-default -- only the active tile.
        expect(markup.match(/data-tv-focus-default="true"/g)).toHaveLength(1);
      }
    });

    it("lists Playarr Server as a server with truthful install methods", () => {
      const markup = renderClientRoute("/clients/server");
      const text = markup.replace(/<[^>]+>/g, " ");

      expect(markup).toContain('data-navigation-scroll-key="clients:server"');
      expect(markup).toMatch(/class="client-choice is-experimental is-server is-active"/);
      expect(markup).toContain('data-client-icon="server"');
      expect(markup).toContain("Server, not a playback app");
      expect(markup).toContain("Build from source · No public download yet");
      expect(markup).toContain("have not been published yet");
      // No fabricated download, and no link into the private repository.
      expect(markup).not.toContain("download=");
      expect(markup).not.toContain("github.com");
      expect(markup).not.toContain("/downloads/server");
      expect(text).toContain("ffmpeg and ffprobe");
      expect(text).toContain("Docker Compose");
      expect(text).toContain("systemd on a Linux host");
      expect(text).toContain("Kubernetes (Helm chart)");
      expect(markup).toContain(
        "docker compose -f infra/docker/docker-compose.standalone.yml up -d --build"
      );
      expect(markup).toContain("sudo systemctl enable --now playarr.service");
      expect(markup).toContain("infra/kubernetes/helm/playarr-standalone");
      expect(markup).toContain("PLAYARR_RELAY_REGISTER=true");
      expect(text).toContain("off by default");
      expect(text).toContain("No streaming or API traffic passes through Cloudflare");
      expect(markup.match(/id="client-[a-z]+"/g)).toHaveLength(allClientTileCount());
      expect(markup.match(/tabindex="0"/gi)).toHaveLength(1);
    });

    it("moves Roku downloads and coming-soon details onto their own URLs", () => {
      const rokuMarkup = renderClientRoute("/clients/roku");
      const appleMarkup = renderClientRoute("/clients/apple");

      expect(rokuMarkup).toContain('data-navigation-scroll-key="clients:roku"');
      expect(rokuMarkup).toContain('data-navigation-scroll-key="clients:platforms"');
      expect(rokuMarkup).toMatch(
        /class="client-choice is-experimental is-roku is-active"/
      );
      expect(rokuMarkup).toContain(
        'href="https://playarr.app/downloads/roku/playarr-roku.zip"'
      );
      expect(rokuMarkup).toContain("Download Roku ZIP");
      expect(rokuMarkup).toContain(
        "Roku&#x27;s development installer expects the archive itself"
      );
      expect(rokuMarkup).toContain("Home three times, Up twice");
      expect(rokuMarkup).toContain("Right, Left, Right, Left, Right");
      expect(rokuMarkup).toContain("username rokudev");
      expect(rokuMarkup).toContain("select playarr-roku.zip without extracting it");
      expect(rokuMarkup).toContain("Only one sideloaded app can be installed.");
      expect(rokuMarkup).toContain(
        'href="https://developer.roku.com/dev/docs/developer-setup"'
      );
      expect(rokuMarkup).toContain("Available · Experimental install");
      expect(appleMarkup).toContain('data-navigation-scroll-key="clients:apple"');
      expect(appleMarkup).toContain('data-navigation-scroll-key="clients:platforms"');
      expect(appleMarkup).toContain("Coming soon");
      expect(appleMarkup).toContain("The native Apple client is coming soon");

      const harmonyMarkup = renderClientRoute("/clients/harmony");

      expect(harmonyMarkup).toContain('data-navigation-scroll-key="clients:harmony"');
      expect(harmonyMarkup).toContain('data-navigation-scroll-key="clients:platforms"');
      expect(harmonyMarkup).toMatch(
        /class="client-choice is-soon is-harmony is-active"/
      );
      expect(harmonyMarkup).toContain("Coming soon");
      expect(harmonyMarkup).toContain("The native HarmonyOS client is in development");
      expect(harmonyMarkup).toContain("Huawei phones, tablets and Vision TVs");
      expect(harmonyMarkup).not.toContain("Download app");

      const firetvMarkup = renderClientRoute("/clients/firetv");

      expect(firetvMarkup).toContain('data-navigation-scroll-key="clients:firetv"');
      expect(firetvMarkup).toContain('data-navigation-scroll-key="clients:platforms"');
      expect(firetvMarkup).toMatch(
        /class="client-choice is-soon is-firetv is-active"/
      );
      expect(firetvMarkup).toContain("Coming soon");
      expect(firetvMarkup).toContain("The native Fire TV client is in development");
      expect(firetvMarkup).toContain("Amazon Fire TV devices");
      expect(firetvMarkup).not.toContain("Download app");
    });
  });
});
