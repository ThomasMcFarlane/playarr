import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "../../lib/i18n/LanguageProvider";
import { ThemeProvider } from "../../lib/theme";
import { THEME_OPTIONS } from "../ThemeDropdown";
import { TvDetailHeading, TvStageChrome } from "./TvStage";

describe("TvDetailHeading", () => {
  it("uses the standard library-heading divider for the selected item", () => {
    const markup = renderToStaticMarkup(
      <TvDetailHeading
        backLabel="Back to Music"
        sectionTitle="Music"
        itemTitle="Sample Band Two"
        onBack={() => undefined}
      />
    );

    expect(markup).toContain("<h1>Music</h1>");
    expect(markup).toContain(
      '<span class="page-header-detail tv-detail-heading-item"><strong>Sample Band Two</strong></span>'
    );
    expect(markup).not.toContain(">|<");

    const css = readFileSync(new URL("../../styles/global.css", import.meta.url), "utf8");
    const sharedDividerRule = css.match(
      /\.tv-library-heading > \.page-header-title-block > span\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const detailItemRule = css.match(
      /\.tv-library-heading > \.page-header-title-block > \.tv-detail-heading-item\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;

    expect(sharedDividerRule).toContain("padding-left: clamp(14px, 1.2vw, 24px)");
    expect(sharedDividerRule).toContain("border-left: 1px solid var(--line-strong)");
    expect(detailItemRule).not.toContain("padding-left");
    expect(detailItemRule).not.toContain("border-left");
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
