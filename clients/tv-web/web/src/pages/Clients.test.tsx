import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

function renderClientRoute(path: string): string {
  return renderPage(
    <Routes>
      <Route path="/clients/:clientId" element={<ClientDetailsPage />} />
    </Routes>,
    path
  );
}

describe("ClientsPage", () => {
  it("renders downloadable clients as a profile-style horizontal selector", () => {
    const markup = renderPage(<ClientsPage />, "/clients");

    expect(markup).toContain('data-navigation-scroll-key="clients:index"');
    expect(markup).toContain('data-navigation-scroll-key="clients:platforms"');
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
    expect(markup).toContain('data-client-icon="firetv"');
    expect(markup).toContain('id="client-vidaa"');
    expect(markup).toContain('id="client-roku"');
    expect(markup).toContain('id="client-firetv"');
    expect(markup.match(/data-tv-edge-stop-left="true"/g)).toHaveLength(1);
    expect(markup.match(/data-tv-edge-stop-right="true"/g)).toHaveLength(1);
    expect(markup).toContain("Apple TV");
    expect(markup).toContain("iPhone, iPad and Apple TV");
    expect(markup).toContain('id="client-apple"');
    expect(markup).not.toContain('id="client-apple-tv"');
    expect(markup).toContain("Roku TV");
    expect(markup).toContain("Amazon Fire TV devices");
    expect(markup).not.toContain('id="client-android-action"');
    expect(markup).not.toContain("Download APK");
    expect(markup).not.toContain("Download app");
    for (const client of ["vidaa", "android", "apple", "webos", "tizen", "roku", "firetv"]) {
      expect(markup).toContain(`href="/clients/${client}"`);
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

  it("keeps the platform selector available on every client URL", () => {
    for (const client of ["vidaa", "android", "apple", "webos", "tizen", "roku", "firetv"]) {
      const markup = renderClientRoute(`/clients/${client}`);

      expect(markup).toContain('data-navigation-scroll-key="clients:platforms"');
      expect(markup.match(/href="\/clients\//g)).toHaveLength(7);
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
      "pnpm --filter @streamarr-tv/app-webos run package:ipk"
    );
    expect(webosMarkup).toContain("ares-setup-device --add playarr-tv");
    expect(webosMarkup).toContain(
      "ares-novacom --device playarr-tv --getkey"
    );
    expect(webosMarkup).toContain(
      "ares-launch --device playarr-tv com.streamarr.tv"
    );
    expect(webosMarkup).toContain(
      'href="https://webostv.developer.lge.com/develop/getting-started/developer-mode-app"'
    );
    expect(webosMarkup).toContain(
      'href="https://github.com/ThomasMcFarlane/streamarr/tree/main/clients/tv-web/apps/tv-webos"'
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
      "tizen run -p StrmarrTV1.Streamarr -t &lt;target-name&gt;"
    );
    expect(tizenMarkup).toContain(
      'href="https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html"'
    );
    expect(tizenMarkup).toContain(
      'href="https://github.com/ThomasMcFarlane/streamarr/tree/main/clients/tv-web/apps/tv-tizen"'
    );

    for (const markup of [webosMarkup, tizenMarkup]) {
      expect(markup).toContain('data-tv-scroll-container="true"');
      expect(markup).toContain('data-tv-scroll-axis="vertical"');
      expect(markup).toContain('data-tv-scroll-axis="horizontal"');
      expect(markup).toContain('target="_blank"');
      expect(markup).toContain('rel="noopener noreferrer"');
      expect(markup.match(/href="\/clients\//g)).toHaveLength(7);
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
  });

  it("lists Fire TV as a coming-soon platform on its own URL", () => {
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
