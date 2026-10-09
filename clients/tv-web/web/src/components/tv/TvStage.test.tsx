import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "../../lib/i18n/LanguageProvider";
import { ThemeProvider } from "../../lib/theme";
import { THEME_OPTIONS } from "../ThemeDropdown";
import { MemoryRouter } from "react-router-dom";
import { PageHeader } from "../shell/PageHeader";
import { TvStageChrome } from "./TvStage";

describe("detail page heading", () => {
  it("renders the selected item as the one shared small subtitle, with no divider", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <PageHeader
          variant="detail"
          title="Music"
          detail="Sample Band"
          back={{ label: "Back to Music", onBack: () => undefined }}
        />
      </MemoryRouter>
    );

    expect(markup).toContain("<h1>Music</h1>");
    expect(markup).toContain('<span class="page-header-detail page-subtitle">Sample Band</span>');
    expect(markup).not.toContain(">|<");

    const css = readFileSync(new URL("../../styles/page-layout.css", import.meta.url), "utf8");
    expect(css).not.toContain("border-left: 1px solid var(--line-strong)");
  });
});

describe("TvStageChrome", () => {
  it("places the theme dropdown beside the language selector", () => {
    const markup = renderToStaticMarkup(
      <ThemeProvider>
        <LanguageProvider>
          <TvStageChrome />
        </LanguageProvider>
      </ThemeProvider>
    );
    const themeDropdown = markup.indexOf(
      'class="language-dropdown theme-dropdown tv-stage-chrome-theme"'
    );
    const languageToggle = markup.indexOf(
      'class="language-dropdown tv-stage-chrome-language"'
    );

    expect(markup).toContain('class="tv-stage-chrome-controls"');
    expect(markup).toContain(">System<");
    expect(THEME_OPTIONS).toEqual(["system", "light", "dark"]);
    expect(themeDropdown).toBeGreaterThan(-1);
    expect(languageToggle).toBeGreaterThan(themeDropdown);
  });
});
