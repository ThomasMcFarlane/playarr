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

const admin = vi.hoisted(() => ({ value: true }));
vi.mock("../../lib/DownloadsProvider", () => ({ useIsAdmin: () => admin.value }));

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
  const textInput = (
    selectionStart: number,
    selectionEnd = selectionStart,
    valueLength = 10
  ) => ({
    kind: "input" as const,
    type: "text",
    selectionStart,
    selectionEnd,
    valueLength,
  });

  it("hides the admin-only Request latency section from non-admins and shows it to admins", () => {
    admin.value = false;
    try {
      const member = renderSettingsRoute("/settings");
      expect(member).not.toContain("Request latency");
      expect(member).not.toContain("/settings/request-latency");
    } finally {
      admin.value = true;
    }
    expect(renderSettingsRoute("/settings")).toContain("/settings/request-latency");
  });

  it("renders every settings option in a native vertical list", () => {
    const markup = renderSettingsRoute("/settings");

    expect(markup).toContain('class="settings-options-list"');
    expect(markup).toContain('class="tv-library-heading page-header"');
    expect(markup).toContain(
      'class="tv-library tv-directory settings-page settings-workspace-page settings-index-route"'
    );
    expect(markup).toMatch(/class="[^"]*tv-page-back"/);
    expect(markup.match(/class="settings-option(?: is-active)?"/g)).toHaveLength(11);
    expect(markup).toContain('data-tv-scroll-container="true"');
    expect(markup).toContain('data-tv-scroll-axis="vertical"');
    expect(markup).toContain('data-navigation-scroll-key="settings:options"');
    expect(markup).toContain('id="settings-active-option"');
    expect(markup).toContain("Appearance controls");
    expect(markup).toContain('<span class="page-header-detail is-section"><strong>Appearance</strong>');
  });

  it("returns focus to the list only at the detail panel's left boundary", () => {
    expect(shouldReturnSettingsFocusToList("ArrowLeft", null, false)).toBe(true);
    expect(shouldReturnSettingsFocusToList("ArrowLeft", null, true)).toBe(false);
    expect(
      shouldReturnSettingsFocusToList("ArrowLeft", textInput(0), false)
    ).toBe(true);
    expect(
      shouldReturnSettingsFocusToList("ArrowLeft", textInput(3), false)
    ).toBe(false);
    expect(
      shouldReturnSettingsFocusToList("ArrowRight", textInput(10), false)
    ).toBe(false);
  });

  it("selects adjacent sections with vertical navigation without wrapping", () => {
    expect(adjacentSettingsIndex("ArrowDown", 0, 6)).toBe(1);
    expect(adjacentSettingsIndex("ArrowUp", 3, 6)).toBe(2);
    expect(adjacentSettingsIndex("ArrowUp", 0, 6)).toBeNull();
    expect(adjacentSettingsIndex("ArrowDown", 6, 7)).toBeNull();
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

  it("separates the mobile settings menu from routed page content", () => {
    const indexMarkup = renderSettingsRoute("/settings");
    const detailMarkup = renderSettingsRoute("/settings/appearance");
    const css = [
      readFileSync(new URL("../../styles/global.css", import.meta.url), "utf8"),
      readFileSync(new URL("../../styles/page-layout.css", import.meta.url), "utf8"),
    ].join("\n");

    expect(indexMarkup).toContain("settings-index-route");
    expect(detailMarkup).toContain("settings-detail-route");
    expect(indexMarkup).toContain("Appearance");
    expect(indexMarkup).toContain("Profile avatar");
    expect(indexMarkup).toContain("Language");
    expect(indexMarkup).toContain("Player");
    expect(indexMarkup).toContain("Server");
    expect(indexMarkup).toContain("Profile lock");
    expect(indexMarkup).toContain("Invite a friend");
    expect(indexMarkup).toContain("Request latency");
    expect(css).toMatch(
      /\.settings-index-route \.settings-workspace-track,\s*\.settings-detail-route \.settings-workspace-track\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s
    );
    expect(css).toMatch(
      /\.settings-index-route \.settings-detail-panel,\s*\.settings-detail-route \.settings-options-panel\s*\{[^}]*display:\s*none/s
    );
    expect(css).toMatch(
      /\.page-header\[data-mobile-show="title"\] > \.page-header-title-block > \.page-header-detail,\s*\.page-header\[data-mobile-show="detail"\] h1\s*\{[^}]*display:\s*none/s
    );
    expect(css).toMatch(
      /\.settings-index-route \.settings-option-copy small,\s*\.settings-index-route \.settings-option-arrow\s*\{[^}]*display:\s*block/s
    );
  });

  it("moves the intact list left and gives both panels independent scrolling", () => {
    const markup = renderSettingsRoute("/settings/appearance");
    const css = [
      readFileSync(new URL("../../styles/global.css", import.meta.url), "utf8"),
      readFileSync(new URL("../../styles/page-layout.css", import.meta.url), "utf8"),
    ].join("\n");

    expect(css).toMatch(
      /\.tv-library,\s*\.tv-detail\s*\{[^}]*height:\s*var\(--viewport-height\)/s
    );
    expect(css).toMatch(
      /\.settings-workspace-track\s*\{[^}]*grid-template-columns:\s*minmax\(calc\(var\(--tv-nav-clearance\) \+ 320px\), 35fr\) minmax\(0, 65fr\)/s
    );
    expect(css).toMatch(/\.settings-workspace\s*\{[^}]*inset:\s*0/s);
    expect(markup).toContain(
      'class="tv-rail-panel tv-library-grid-panel settings-detail-panel"'
    );
    expect(css).toMatch(/\.tv-library-grid-panel\s*\{[^}]*width:\s*65%[^}]*height:\s*100%/s);
    expect(css).toMatch(/\.app-clock\s*\{[^}]*right:\s*calc\(var\(--stage-split\)\s*\+/s);
    expect(css).toMatch(/--stage-split:\s*65%/);
    expect(css).toMatch(
      /\.settings-options-scroll,\s*\.settings-detail-scroll\s*\{[^}]*overflow-y:\s*auto/s
    );
  });
});
