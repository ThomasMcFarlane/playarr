import { describe, expect, it } from "vitest";
import { shouldAutoFocusViewDefault } from "./useTvNavigation";

describe("shouldAutoFocusViewDefault", () => {
  it("allows an async view default to receive untouched initial focus", () => {
    expect(
      shouldAutoFocusViewDefault({
        activeElementAllowsViewFocus: true,
        defaultTargetAvailable: true,
        focusHandled: false,
        userInteracted: false,
      })
    ).toBe(true);
  });

  it("keeps waiting while the async view has no default target", () => {
    expect(
      shouldAutoFocusViewDefault({
        activeElementAllowsViewFocus: true,
        defaultTargetAvailable: false,
        focusHandled: false,
        userInteracted: false,
      })
    ).toBe(false);
  });

  it("does not steal focus after viewer interaction or another focus change", () => {
    expect(
      shouldAutoFocusViewDefault({
        activeElementAllowsViewFocus: true,
        defaultTargetAvailable: true,
        focusHandled: false,
        userInteracted: true,
      })
    ).toBe(false);
    expect(
      shouldAutoFocusViewDefault({
        activeElementAllowsViewFocus: false,
        defaultTargetAvailable: true,
        focusHandled: false,
        userInteracted: false,
      })
    ).toBe(false);
  });
});
