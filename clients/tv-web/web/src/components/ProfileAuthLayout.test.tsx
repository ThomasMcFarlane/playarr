import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "../lib/i18n/LanguageProvider";
import { ThemeProvider } from "../lib/theme";
import { ProfileAuthLayout } from "./ProfileAuthLayout";

function renderLayout(children: ReactNode): string {
  return renderToStaticMarkup(
    <ThemeProvider>
      <LanguageProvider>{children}</LanguageProvider>
    </ThemeProvider>
  );
}

describe("ProfileAuthLayout", () => {
  it("keeps sign-up free of back navigation", () => {
    const markup = renderLayout(
      <ProfileAuthLayout className="signup-profile-page">
        <form>Sign-up fields</form>
      </ProfileAuthLayout>
    );

    expect(markup).not.toContain("tv-stage-chrome-back");
  });

  it("places optional back navigation in the shared stage chrome", () => {
    const markup = renderLayout(
      <ProfileAuthLayout backLabel="Back" onBack={() => undefined}>
        <form>Sign-in fields</form>
      </ProfileAuthLayout>
    );

    expect(markup).toContain('class="tv-stage-chrome-logo"');
    expect(markup).toContain(
      'class="tv-library-heading tv-stage-chrome-heading"'
    );
    expect(markup).toContain(
      'class="tv-page-back tv-stage-chrome-back"'
    );

    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const layoutCss = readFileSync(new URL("../styles/page-layout.css", import.meta.url), "utf8");
    expect(layoutCss).toContain(".tv-library-heading {");
    expect(css).toContain(".tv-stage-chrome-heading {");
  });

  it("marks overflowing auth fields as a native vertical scroll viewport", () => {
    const markup = renderLayout(
      <ProfileAuthLayout>
        <form>Sign-up fields</form>
      </ProfileAuthLayout>
    );

    expect(markup).toContain('data-tv-scroll-container="true"');
    expect(markup).toContain('data-tv-scroll-axis="vertical"');
    expect(markup).toContain('data-navigation-scroll-key="auth:fields"');
  });

  it("uses the same broad 900px wash as the Android login screen", () => {
    const css = readFileSync(
      new URL("../styles/global.css", import.meta.url),
      "utf8"
    );
    const loginBackground = css.match(
      /\.login-profile-page\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;

    expect(loginBackground).toContain("circle 900px at 50% 50%");
  });
});
