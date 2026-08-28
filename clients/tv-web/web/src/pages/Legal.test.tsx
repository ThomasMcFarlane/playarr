import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "../lib/i18n/LanguageProvider";
import { ThemeProvider } from "../lib/theme";
import {
  AcceptableUsePage,
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
});
