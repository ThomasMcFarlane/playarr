import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "../lib/i18n/LanguageProvider";
import { ThemeProvider } from "../lib/theme";
import {
  AcceptableUsePage,
  AccountDeletionPage,
  LicencesPage,
  PrivacyPolicyPage,
  TermsPage,
} from "./Legal";

function renderLegalPage(path: string, page: ReactNode): string {
  return renderToStaticMarkup(
    <ThemeProvider>
      <LanguageProvider>
        <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>
      </LanguageProvider>
    </ThemeProvider>
  );
}

describe("public legal pages", () => {
  it.each([
    ["/legal/privacy", <PrivacyPolicyPage />, "Privacy policy"],
    ["/legal/terms", <TermsPage />, "Terms of use"],
    ["/legal/acceptable-use", <AcceptableUsePage />, "Acceptable use"],
    ["/legal/licences", <LicencesPage />, "Licences and attribution"],
    ["/legal/account-deletion", <AccountDeletionPage />, "Account deletion"],
  ])("renders %s in the signed-out auth stage", (path, page, heading) => {
    const markup = renderLegalPage(path, page);

    expect(markup).toContain("profiles-page profile-auth-page login-profile-page legal-profile-page");
    expect(markup).toContain(`<h1 class="auth-title">${heading}</h1>`);
    expect(markup).toContain('data-tv-scroll-container="true"');
    expect(markup).not.toContain("app-user-identity");
    expect(markup).not.toContain("profile-avatar");
    expect(markup).not.toContain("tv-key-art");
  });

  it("routes legal pages before the authenticated application shell", () => {
    const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const privacyRoute = source.indexOf('path="/legal/privacy"');
    const authenticatedShell = source.indexOf("<Route element={<AppShell />}");

    expect(privacyRoute).toBeGreaterThan(-1);
    expect(authenticatedShell).toBeGreaterThan(privacyRoute);
  });

  it("mounts public legal routes outside signed-in data providers", () => {
    const source = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    const publicBranch = source.indexOf("{isPublicLegalRoute ? (");
    const apiProvider = source.indexOf("<ApiClientProvider>");
    const downloadsProvider = source.indexOf("<DownloadsProvider>");

    expect(publicBranch).toBeGreaterThan(-1);
    expect(apiProvider).toBeGreaterThan(publicBranch);
    expect(downloadsProvider).toBeGreaterThan(publicBranch);
  });

  it("publishes the verified privacy contact directly on the privacy policy", () => {
    const markup = renderLegalPage("/legal/privacy", <PrivacyPolicyPage />);

    expect(markup).toContain('href="mailto:support@playarr.app"');
    expect(markup).toContain("Google Play Android app require HTTPS");
  });

  it("covers the iPhone, iPad and Apple TV apps", () => {
    const markup = renderLegalPage("/legal/privacy", <PrivacyPolicyPage />);

    expect(markup).toContain("iPhone, iPad and Apple TV applications");
    expect(markup).toContain("app.playarr.ios");
    expect(markup).toContain("do not register for push notifications");
    expect(markup).toContain("contain no advertising or analytics software");
  });
});
