import { describe, expect, it } from "vitest";
import { shouldNavigateFromFormControl } from "./arrowNavigationPolicy";

describe("shouldNavigateFromFormControl", () => {
  function input(
    type: string,
    selectionStart = 2,
    selectionEnd = selectionStart,
    valueLength = 5
  ) {
    return {
      kind: "input" as const,
      type,
      selectionStart,
      selectionEnd,
      valueLength,
    };
  }

  it.each(["text", "url", "email", "password", "search", "tel"])(
    "releases vertical arrows from a %s input",
    (type) => {
      expect(shouldNavigateFromFormControl("ArrowUp", input(type))).toBe(true);
      expect(shouldNavigateFromFormControl("ArrowDown", input(type))).toBe(true);
    }
  );

  it.each(["text", "url", "password", "search", "tel"])(
    "releases horizontal arrows only at the matching boundary of a %s input",
    (type) => {
      expect(shouldNavigateFromFormControl("ArrowLeft", input(type, 0))).toBe(true);
      expect(shouldNavigateFromFormControl("ArrowLeft", input(type, 1))).toBe(false);
      expect(shouldNavigateFromFormControl("ArrowRight", input(type, 5))).toBe(true);
      expect(shouldNavigateFromFormControl("ArrowRight", input(type, 4))).toBe(false);
    }
  );

  it.each(["checkbox", "button", "submit"])("releases every arrow from a %s input", (type) => {
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      expect(shouldNavigateFromFormControl(key, input(type, 0, 0, 0))).toBe(true);
    }
    expect(shouldNavigateFromFormControl(" ", input(type, 0, 0, 0))).toBe(false);
  });

  it("keeps horizontal arrows native while text is selected", () => {
    expect(shouldNavigateFromFormControl("ArrowLeft", input("text", 0, 3))).toBe(false);
    expect(shouldNavigateFromFormControl("ArrowRight", input("text", 0, 5))).toBe(false);
  });

  it.each(["number", "range", "date", "time"])(
    "keeps arrows native for a %s input",
    (type) => {
      expect(shouldNavigateFromFormControl("ArrowUp", input(type))).toBe(false);
      expect(shouldNavigateFromFormControl("ArrowDown", input(type))).toBe(false);
    }
  );

  it("keeps arrows native for selects and textareas", () => {
    expect(shouldNavigateFromFormControl("ArrowDown", { kind: "select" })).toBe(false);
    expect(shouldNavigateFromFormControl("ArrowDown", { kind: "textarea" })).toBe(false);
  });
});
