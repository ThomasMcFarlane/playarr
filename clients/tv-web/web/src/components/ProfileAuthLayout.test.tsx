import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileAuthLayout } from "./ProfileAuthLayout";

describe("ProfileAuthLayout", () => {
  it("keeps sign-up free of back navigation", () => {
    const markup = renderToStaticMarkup(
      <ProfileAuthLayout className="signup-profile-page">
        <form>Sign-up fields</form>
      </ProfileAuthLayout>
    );

    expect(markup).not.toContain("tv-stage-chrome-back");
  });

  it("places optional back navigation in the shared stage chrome", () => {
    const markup = renderToStaticMarkup(
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
    expect(css).toContain(".tv-library-heading {");
    expect(css).toContain(".tv-stage-chrome-heading {");
  });

  it("marks overflowing auth fields as a native vertical scroll viewport", () => {
    const markup = renderToStaticMarkup(
      <ProfileAuthLayout>
        <form>Sign-up fields</form>
      </ProfileAuthLayout>
    );

    expect(markup).toContain('data-tv-scroll-container="true"');
    expect(markup).toContain('data-tv-scroll-axis="vertical"');
    expect(markup).toContain('data-navigation-scroll-key="auth:fields"');
  });
});
