import { describe, expect, it } from "vitest";
import { languageSearchHandlesKey } from "./LanguageDropdown";

describe("languageSearchHandlesKey", () => {
  it("releases vertical arrows from its single-line search input", () => {
    expect(languageSearchHandlesKey("ArrowUp")).toBe(false);
    expect(languageSearchHandlesKey("ArrowDown")).toBe(false);
  });

  it("keeps selection and close keys inside the dropdown", () => {
    expect(languageSearchHandlesKey("Enter")).toBe(true);
    expect(languageSearchHandlesKey("Escape")).toBe(true);
  });
});
