import { describe, expect, it } from "vitest";
import {
  directionalVerticalScrollTop,
  horizontalRevealDelta,
  parentRoute,
  shouldAutoFocusViewDefault,
} from "./useTvNavigation";

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

describe("directional page fallback", () => {
  it("pages a native vertical viewport when focus has no next target", () => {
    expect(
      directionalVerticalScrollTop({
        clientHeight: 500,
        direction: "down",
        scrollHeight: 1_500,
        scrollTop: 100,
      })
    ).toBe(460);
    expect(
      directionalVerticalScrollTop({
        clientHeight: 500,
        direction: "up",
        scrollHeight: 1_500,
        scrollTop: 100,
      })
    ).toBe(0);
  });

  it("returns VIDAA clients to the clients hub on remote Back", () => {
    expect(parentRoute("/clients/vidaa")).toBe("/clients");
    expect(parentRoute("/clients")).toBe("/");
    expect(parentRoute("/clients", "/profiles")).toBe("/profiles");
  });

  it("reveals an offscreen item inside a hidden-scrollbar horizontal selector", () => {
    expect(
      horizontalRevealDelta({
        containerLeft: 0,
        containerRight: 1_000,
        elementLeft: 940,
        elementRight: 1_140,
        scrollPaddingRight: 80,
      })
    ).toBe(220);
    expect(
      horizontalRevealDelta({
        containerLeft: 0,
        containerRight: 1_000,
        elementLeft: -60,
        elementRight: 140,
        scrollPaddingLeft: 80,
      })
    ).toBe(-140);
  });
});
