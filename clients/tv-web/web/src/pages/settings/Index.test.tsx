import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../lib/i18n/LanguageProvider";
import {
  adjacentSettingsIndex,
  SettingsIndexPage,
  shouldReturnSettingsFocusToList,
} from "./Index";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((message) => {
    if (!String(message).includes("useLayoutEffect does nothing on the server")) {
      throw new Error(`Unexpected console.error: ${String(message)}`);
    }
  });
});

afterAll(() => consoleErrorSpy.mockRestore());

function renderSettingsRoute(initialEntry: string): string {
  return renderToStaticMarkup(
    <LanguageProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/settings" element={<SettingsIndexPage />}>
            <Route index element={<div>Appearance controls</div>} />
            <Route path="appearance" element={<div>Appearance controls</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </LanguageProvider>
  );
}

describe("SettingsIndexPage", () => {
  it("renders every settings option in a native vertical list", () => {
    const markup = renderSettingsRoute("/settings");

    expect(markup).toContain('class="settings-options-list"');
    expect(markup).toContain('class="tv-library-heading"');
    expect(markup).toContain(
      'class="tv-library tv-directory settings-page settings-workspace-page"'
    );
    expect(markup).toContain('class="tv-page-back"');
    expect(markup.match(/class="settings-option(?: is-active)?"/g)).toHaveLength(6);
    expect(markup).toContain('data-tv-scroll-container="true"');
    expect(markup).toContain('data-tv-scroll-axis="vertical"');
    expect(markup).toContain('data-navigation-scroll-key="settings:options"');
    expect(markup).toContain('id="settings-active-option"');
    expect(markup).toContain("Appearance controls");
    expect(markup).toContain('<span class="settings-heading-detail"><strong>Appearance</strong>');
  });

  it("returns focus to the list only at the detail panel's left boundary", () => {
    expect(shouldReturnSettingsFocusToList("ArrowLeft", false, false)).toBe(true);
    expect(shouldReturnSettingsFocusToList("ArrowLeft", false, true)).toBe(false);
    expect(shouldReturnSettingsFocusToList("ArrowLeft", true, false)).toBe(false);
    expect(shouldReturnSettingsFocusToList("ArrowRight", false, false)).toBe(false);
  });

  it("selects adjacent sections with vertical navigation without wrapping", () => {
    expect(adjacentSettingsIndex("ArrowDown", 0, 6)).toBe(1);
    expect(adjacentSettingsIndex("ArrowUp", 3, 6)).toBe(2);
    expect(adjacentSettingsIndex("ArrowUp", 0, 6)).toBeNull();
    expect(adjacentSettingsIndex("ArrowDown", 5, 6)).toBeNull();
    expect(adjacentSettingsIndex("Enter", 2, 6)).toBeNull();
  });

  it("keeps the selected option beside the routed detail panel", () => {
    const markup = renderSettingsRoute("/settings/appearance");

    expect(markup).toContain("settings-workspace-page");
    expect(markup).toContain('id="settings-active-option"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('data-navigation-scroll-key="settings:detail:01"');
    expect(markup).toContain("Appearance controls");
  });

  it("moves the intact list left and gives both panels independent scrolling", () => {
    const css = readFileSync(
      new URL("../../styles/global.css", import.meta.url),
      "utf8"
    );

    expect(css).toMatch(
      /\.tv-library,\s*\.tv-detail\s*\{[^}]*height:\s*var\(--viewport-height\)/s
    );
    expect(css).toMatch(
      /\.settings-workspace-track\s*\{[^}]*grid-template-columns:\s*minmax\(0, 26fr\) minmax\(0, 74fr\)/s
    );
    expect(css).toMatch(
      /\.settings-options-panel,\s*\.settings-detail-scroll\s*\{[^}]*overflow-y:\s*auto/s
    );
  });
});
