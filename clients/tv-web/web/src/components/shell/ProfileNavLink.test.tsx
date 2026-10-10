import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ProfileNavLink, shortProfileName } from "./ProfileNavLink";

function render(displayName: string): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ProfileNavLink
        displayName={displayName}
        ariaLabel={`Profile: ${displayName}`}
        avatar={<span className="app-user-avatar" />}
        backTo="/movies"
        route="/movies"
        entryKey="k"
      />
    </MemoryRouter>
  );
}

describe("ProfileNavLink", () => {
  it("renders a real anchor to the profiles route styled as a nav tile", () => {
    const markup = render("Ada Lovelace");
    expect(markup).toMatch(/^<a [^>]*href="\/profiles"/);
    expect(markup).toContain('class="app-nav-link app-user-identity"');
    expect(markup).toContain('aria-label="Profile: Ada Lovelace"');
    expect(markup).toContain('title="Ada Lovelace"');
    expect(markup).not.toContain("<button");
  });

  it("labels the tile with the first name", () => {
    expect(render("Ada Lovelace")).toContain(">Ada</span>");
    expect(shortProfileName("  Grace   Hopper ")).toBe("Grace");
    expect(shortProfileName("Viewer")).toBe("Viewer");
  });
});
