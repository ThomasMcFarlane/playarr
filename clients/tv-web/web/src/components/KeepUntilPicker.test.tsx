import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "../lib/i18n/LanguageProvider";
import { KeepUntilPicker } from "./KeepUntilPicker";

describe("KeepUntilPicker", () => {
  it("renders the shared SegmentedControl, with no legacy choice grid and no text search", () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <KeepUntilPicker
          state={{ kind: "after-watched", date: "2026-10-20", amount: 3, unit: "days" }}
          onChange={() => undefined}
        />
      </LanguageProvider>,
    );
    expect(html).toContain("tv-segmented");
    expect(html).not.toContain("tv-filter-choice-grid tv-filter-choice-grid-wide");
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(2);
  });
});
