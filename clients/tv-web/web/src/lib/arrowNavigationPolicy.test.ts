import { describe, expect, it } from "vitest";
import { shouldNavigateFromFormControl } from "./arrowNavigationPolicy";

describe("shouldNavigateFromFormControl", () => {
  it.each(["text", "url", "email", "password", "search", "tel"])(
    "releases vertical arrows from a %s input",
    (type) => {
      expect(shouldNavigateFromFormControl("ArrowUp", { kind: "input", type })).toBe(true);
      expect(shouldNavigateFromFormControl("ArrowDown", { kind: "input", type })).toBe(true);
    }
  );

  it("keeps horizontal arrows in text inputs for caret movement", () => {
    expect(
      shouldNavigateFromFormControl("ArrowLeft", { kind: "input", type: "text" })
    ).toBe(false);
    expect(
      shouldNavigateFromFormControl("ArrowRight", { kind: "input", type: "text" })
    ).toBe(false);
  });

  it.each(["number", "range", "date", "time"])(
    "keeps arrows native for a %s input",
    (type) => {
      expect(shouldNavigateFromFormControl("ArrowUp", { kind: "input", type })).toBe(false);
      expect(shouldNavigateFromFormControl("ArrowDown", { kind: "input", type })).toBe(false);
    }
  );

  it("keeps arrows native for selects and textareas", () => {
    expect(shouldNavigateFromFormControl("ArrowDown", { kind: "select" })).toBe(false);
    expect(shouldNavigateFromFormControl("ArrowDown", { kind: "textarea" })).toBe(false);
  });
});
