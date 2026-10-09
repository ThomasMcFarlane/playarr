import { describe, expect, it } from "vitest";
import { shouldRestoreFocus } from "./useRestoreFocus";

describe("shouldRestoreFocus (audit A10)", () => {
  it("returns focus to a live opener when focus fell to the body", () => {
    expect(shouldRestoreFocus({ openerConnected: true, activeIsBody: true, activeIsOpener: false })).toBe(true);
  });

  it("leaves focus alone when the opener is gone or the viewer already moved it", () => {
    expect(shouldRestoreFocus({ openerConnected: false, activeIsBody: true, activeIsOpener: false })).toBe(false);
    expect(shouldRestoreFocus({ openerConnected: true, activeIsBody: false, activeIsOpener: false })).toBe(false);
    expect(shouldRestoreFocus({ openerConnected: true, activeIsBody: false, activeIsOpener: true })).toBe(false);
  });
});
