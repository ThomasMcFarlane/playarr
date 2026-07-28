import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../lib/i18n/LanguageProvider";
import { ClientDetailsPage, ClientsPage } from "./Clients";

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
    <LanguageProvider>
      <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>
    </LanguageProvider>
  );
}

/**
 * The bare index redirects to the first client's own URL -- a coverflow
 * always has something centred, so there's no distinct no-selection state
 * to render -- so every route (including "/clients" itself) is rendered
 * through both routes to let that redirect resolve.
 */
function renderClientRoute(path: string): string {
  return renderPage(
    <Routes>
      <Route path="/clients" element={<ClientsPage />} />
      <Route path="/clients/:clientId" element={<ClientDetailsPage />} />
    </Routes>,
    path
  );
}

/**
 * How many platform tiles the coverflow renders. Every client URL must show
 * the same complete set, so the per-route assertions compare against this
 * rather than a literal -- adding a client should not require editing counts
 * scattered through this file. Only the active tile is a real link (see
 * "only the active tile is a real, focusable link" below), so this counts
 * tiles by id rather than by href.
 */
function allClientTileCount(): number {
  return (renderClientRoute("/clients/vidaa").match(/id="client-[a-z]+"/g) ?? [])
    .length;
}

describe("ClientsPage", () => {
  it("redirects the bare index to the first client's own URL", () => {
    // react-router's <Navigate> performs its redirect in an effect, which a
    // single renderToStaticMarkup pass never commits -- so the redirect
    // target is asserted directly off the element it renders, not by
    // comparing rendered markup.
    const redirect = ClientsPage() as React.ReactElement<
      React.ComponentProps<typeof Navigate>
    >;

    expect(redirect.props.to).toBe("/clients/vidaa");
    expect(redirect.props.replace).toBe(true);
  });

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

  it("makes only the active tile a real, natively-focusable link", () => {
    // The app-wide directional focus system treats every a[href]/button as
    // always reachable regardless of tabindex, so a real link on a
    // non-active tile would let Up/Down land on it from elsewhere on the
    // page -- exactly the bug this markup shape exists to rule out.
    const markup = renderClientRoute("/clients/vidaa");

    expect(markup.match(/<a\b[^>]*id="client-/g)).toHaveLength(1);
    expect(markup).toMatch(/<a\b[^>]*id="client-vidaa"/);
    expect(
      markup.match(/<div\b[^>]*id="client-[^"]*"[^>]*role="link"/g)
    ).toHaveLength(allClientTileCount() - 1);
  });

  it("renders downloadable clients as a profile-style coverflow", () => {
    const markup = renderClientRoute("/clients/vidaa");

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
    expect(markup).toContain('data-client-icon="playstation"');
    expect(markup).toContain('data-client-icon="firetv"');
    expect(markup).toContain('id="client-vidaa"');
    expect(markup).toContain('id="client-roku"');
    expect(markup).toContain('id="client-chromecast"');
    expect(markup).toContain('id="client-playstation"');
    expect(markup).toContain('id="client-firetv"');
    expect(markup).toContain("Chromecast built-in devices");
    expect(markup).toContain("PlayStation 5 and PlayStation 4");
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
      "playstation",
      "firetv",
    ]) {
      expect(markup).toContain(`id="client-${client}"`);
    }
    // Only the active tile (vidaa, on this route) is a real, focusable
    // link -- every other tile is a click-only element with no href, kept
    // deliberately invisible to the app-wide directional focus system so
    // Up/Down can never land on it from anywhere on the page.
    expect(markup).toContain('href="/clients/vidaa"');
    for (const client of [
      "android",
      "apple",
      "webos",
      "tizen",
      "roku",
      "chromecast",
      "harmony",
      "playstation",
      "firetv",
    ]) {
      expect(markup).not.toContain(`href="/clients/${client}"`);
    }
    expect(markup.match(/href="\/clients\//g)).toHaveLength(1);
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
      "playstation",
      "firetv",
    ]) {
      const markup = renderClientRoute(`/clients/${client}`);

      expect(markup).toContain('data-navigation-scroll-key="clients:platforms"');
      expect(markup.match(/id="client-[a-z]+"/g)).toHaveLength(allClientTileCount());
      // Only the current route's own tile is a real link -- every other
      // tile is deliberately click-only, invisible to the app-wide
      // directional focus system.
      expect(markup.match(/href="\/clients\//g)).toHaveLength(1);
      expect(markup).toContain(`href="/clients/${client}"`);
      expect(markup).toMatch(
        new RegExp(`id="client-${client}"[^>]*data-tv-focus-default="true"`)
      );
      expect(markup).toMatch(
        new RegExp(`id="client-${client}"[^>]*aria-current="page"`)
      );
    }
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
    expect(markup).toContain('data-tv-focus-default="true"');
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
      expect(markup.match(/href="\/clients\//g)).toHaveLength(1);
      expect(markup.match(/data-tv-focus-default="true"/g)).toHaveLength(1);
    }
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
