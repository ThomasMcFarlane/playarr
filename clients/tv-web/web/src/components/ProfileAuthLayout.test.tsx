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

    expect(markup).not.toContain("profile-page-back");
  });

  it("aligns optional back navigation with the shared profile-page logo", () => {
    const markup = renderToStaticMarkup(
      <ProfileAuthLayout backLabel="Back" onBack={() => undefined}>
        <form>Sign-in fields</form>
      </ProfileAuthLayout>
    );

    expect(markup).toContain('class="profile-page-logo"');
    expect(markup).toContain('class="tv-back profile-page-back"');
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
