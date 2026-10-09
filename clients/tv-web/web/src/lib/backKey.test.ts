import { describe, expect, it } from "vitest";
import { hasOpenBackLayer, isBackKey } from "./backKey";

const key = (key: string, extra: Record<string, unknown> = {}) =>
  ({ key, ...extra }) as unknown as KeyboardEvent;

describe("isBackKey", () => {
  it("accepts every platform BACK key", () => {
    expect(isBackKey(key("Escape"))).toBe(true);
    expect(isBackKey(key("BrowserBack"))).toBe(true);
    expect(isBackKey(key("GoBack"))).toBe(true);
    expect(isBackKey(key("Backspace"))).toBe(true);
    expect(isBackKey(key("Unidentified", { keyCode: 10009 }))).toBe(true);
    expect(isBackKey(key("Unidentified", { keyCode: 461 }))).toBe(true);
  });

  it("rejects other keys", () => {
    expect(isBackKey(key("Enter"))).toBe(false);
    expect(isBackKey(key("ArrowLeft"))).toBe(false);
    expect(isBackKey(key("Unidentified", { keyCode: 13 }))).toBe(false);
  });

  it("ignores Backspace while typing but keeps Escape and TV codes", () => {
    const input = { tagName: "INPUT", type: "text", isContentEditable: false };
    expect(isBackKey(key("Backspace", { target: input }))).toBe(false);
    expect(isBackKey(key("Escape", { target: input }))).toBe(true);
    expect(isBackKey(key("Unidentified", { keyCode: 461, target: input }))).toBe(true);
    const textarea = { tagName: "TEXTAREA", isContentEditable: false };
    expect(isBackKey(key("Backspace", { target: textarea }))).toBe(false);
    const editable = { tagName: "DIV", isContentEditable: true };
    expect(isBackKey(key("Backspace", { target: editable }))).toBe(false);
    const button = { tagName: "BUTTON", isContentEditable: false };
    expect(isBackKey(key("Backspace", { target: button }))).toBe(true);
  });

  it("ignores modified Backspace and Escape", () => {
    expect(isBackKey(key("Backspace", { altKey: true }))).toBe(false);
    expect(isBackKey(key("Escape", { ctrlKey: true }))).toBe(false);
  });
});

describe("hasOpenBackLayer (audit A5)", () => {
  it("reports an open dialog, drawer or menu so a global Back handler stands aside", () => {
    expect(hasOpenBackLayer({ querySelector: () => ({}) })).toBe(true);
    expect(hasOpenBackLayer({ querySelector: () => null })).toBe(false);
  });
});
