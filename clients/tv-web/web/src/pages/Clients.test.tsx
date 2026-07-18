import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../lib/i18n/LanguageProvider";
import { AndroidDownloadDetails, ClientsPage, VidaaClientsPage } from "./Clients";

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
    expect(markup.match(/Coming soon/g)).toHaveLength(3);
    expect(markup).toContain('data-client-icon="android"');
    expect(markup).toContain('data-client-icon="apple"');
    expect(markup).toContain('data-client-icon="lg"');
    expect(markup).toContain('data-client-icon="samsung"');
    expect(markup).toContain('data-client-icon="roku"');
    expect(markup).toContain('id="client-vidaa"');
    expect(markup).toContain('id="client-roku"');
    expect(markup.match(/data-tv-edge-stop-left="true"/g)).toHaveLength(2);
    expect(markup.match(/data-tv-edge-stop-right="true"/g)).toHaveLength(2);
    expect(markup).toContain("Apple TV");
    expect(markup).toContain("iPhone, iPad and Apple TV");
    expect(markup).toContain('id="client-apple"');
    expect(markup).not.toContain('id="client-apple-tv"');
    expect(markup).toContain("Roku TV");
    expect(markup).toContain('aria-controls="vidaa-install-details"');
    expect(markup).toContain('aria-controls="android-install-details"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('id="client-android-action"');
    expect(markup).toContain("Download APK");
    expect(markup.match(/Download app/g)).toHaveLength(1);
    expect(markup).toContain(
      "releases/download/clients-v0.1.0-preview.1/playarr-roku.zip"
    );
    expect(markup).not.toContain("playarr-ios-source.zip");
    expect(markup).not.toContain("playarr-apple-tv-source.zip");
    expect(markup).not.toContain("playarr-webos-developer-bundle.zip");
    expect(markup).not.toContain("playarr-tizen-developer-bundle.zip");
    expect(markup).toContain("Only installable app packages are offered for download");
    expect(markup.match(/aria-disabled="true"/g)).toHaveLength(3);
    expect(markup).not.toContain('href="/clients/vidaa"');
    expect(markup).not.toContain("app-shell");
    expect(markup).not.toContain("clients-header");
  });

  it("renders one responsive APK for mobile and TV", () => {
    const markup = renderPage(<AndroidDownloadDetails />, "/clients");

    expect(markup).toContain(
      'href="/downloads/android/releases/0.1.7/playarr-android.apk"'
    );
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).not.toContain('download=');
    expect(markup).not.toContain("playarr-android-mobile.apk");
    expect(markup).not.toContain("playarr-android-tv.apk");
    expect(markup).toContain('data-tv-edge-target-up="#client-android-action"');
  });

  it("renders the VIDAA custom store without claiming to operate DNS", () => {
    const markup = renderPage(<VidaaClientsPage />, "/clients/vidaa");

    expect(markup).toContain('data-navigation-scroll-key="clients:vidaa"');
    expect(markup).toContain('aria-label="All clients"');
    expect(markup).toContain('href="/vidaa-store/"');
    expect(markup).toContain("Playarr does not operate a public DNS resolver");
    expect(markup).toContain("Firmware support varies");
    expect(markup).toContain("Restart and restore DNS");
    expect(markup).toContain("Restore automatic DNS after installation.");
    expect(markup).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    expect(markup).not.toContain("Activate installer");
  });
});
