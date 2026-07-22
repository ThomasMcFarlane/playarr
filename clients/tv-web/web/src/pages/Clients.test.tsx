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
    expect(markup).not.toContain("Fire TV");
    expect(markup).not.toContain("Coming soon");
    expect(markup).toContain('data-client-icon="android"');
    expect(markup).toContain('data-client-icon="apple"');
    expect(markup).toContain('data-client-icon="lg"');
    expect(markup).toContain('data-client-icon="samsung"');
    expect(markup).toContain('data-client-icon="roku"');
    expect(markup).toContain('id="client-vidaa"');
    expect(markup).toContain('id="client-roku"');
    expect(markup.match(/data-tv-edge-stop-left="true"/g)).toHaveLength(1);
    expect(markup.match(/data-tv-edge-stop-right="true"/g)).toHaveLength(1);
    expect(markup).toContain("Apple TV");
    expect(markup).toContain("iPhone, iPad and Apple TV");
    expect(markup).toContain('id="client-apple"');
    expect(markup).not.toContain('id="client-apple-tv"');
    expect(markup).toContain("Roku TV");
    expect(markup).not.toContain('id="client-android-action"');
    expect(markup).not.toContain("Download APK");
    expect(markup).not.toContain("Download app");
    for (const client of ["vidaa", "android", "apple", "webos", "tizen", "roku"]) {
      expect(markup).toContain(`href="/clients/${client}"`);
    }
    expect(markup).not.toContain("playarr-roku.zip");
    expect(markup).not.toContain("playarr-ios-source.zip");
    expect(markup).not.toContain("playarr-apple-tv-source.zip");
    expect(markup).not.toContain("playarr-webos-developer-bundle.zip");
    expect(markup).not.toContain("playarr-tizen-developer-bundle.zip");
    expect(markup).toContain("Only installable app packages are offered for download");
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
    for (const client of ["vidaa", "android", "apple", "webos", "tizen", "roku"]) {
      const markup = renderClientRoute(`/clients/${client}`);

      expect(markup).toContain('data-navigation-scroll-key="clients:platforms"');
      expect(markup.match(/href="\/clients\//g)).toHaveLength(6);
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
      'href="/downloads/android/playarr-android.apk"'
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
    expect(markup).toContain('href="/vidaa-store/"');
    expect(markup).toContain("Playarr does not operate a public DNS resolver");
    expect(markup).toContain("Firmware support varies");
    expect(markup).toContain("Restart and restore DNS");
    expect(markup).toContain("Restore automatic DNS after installation.");
    expect(markup.replace(/<[^>]+>/g, " ")).not.toMatch(
      /\b(?:\d{1,3}\.){3}\d{1,3}\b/
    );
    expect(markup).not.toContain("Activate installer");
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
      "releases/download/clients-v0.1.0-preview.1/playarr-roku.zip"
    );
    expect(rokuMarkup).toContain("Available · Experimental install");
    expect(appleMarkup).toContain('data-navigation-scroll-key="clients:apple"');
    expect(appleMarkup).toContain('data-navigation-scroll-key="clients:platforms"');
    expect(appleMarkup).toContain("Coming soon");
    expect(appleMarkup).toContain("The native Apple client is coming soon");
  });
});
