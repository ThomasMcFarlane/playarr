import { afterEach, describe, expect, it, vi } from "vitest";
import {
  centredVerticalTrackScrollTop,
  clearPendingMoves,
  enqueueMove,
  pendingMoveCount,
  directionalVerticalScrollTop,
  horizontalRevealDelta,
  isPlainArrowEvent,
  parentRoute,
  shouldClickAfterRedispatch,
  shouldAutoFocusViewDefault,
  tvBackNavigationTarget,
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
  it("centres boundary tracks without scrolling beyond the surface", () => {
    expect(
      centredVerticalTrackScrollTop({
        clientHeight: 500,
        containerTop: 100,
        scrollHeight: 1_600,
        scrollTop: 700,
        trackHeight: 180,
        trackTop: 420,
      })
    ).toBe(860);
    expect(
      centredVerticalTrackScrollTop({
        clientHeight: 500,
        containerTop: 100,
        scrollHeight: 1_600,
        scrollTop: 1_050,
        trackHeight: 180,
        trackTop: 520,
      })
    ).toBe(1_100);
    expect(
      centredVerticalTrackScrollTop({
        clientHeight: 500,
        containerTop: 100,
        scrollHeight: 1_600,
        scrollTop: 40,
        trackHeight: 180,
        trackTop: -180,
      })
    ).toBe(0);
  });

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

  it("returns client detail pages to the clients hub on remote Back", () => {
    expect(parentRoute("/clients/vidaa")).toBe("/clients");
    expect(parentRoute("/clients/android")).toBe("/clients");
    expect(parentRoute("/clients")).toBe("/");
    expect(parentRoute("/clients", "/profiles")).toBe("/profiles");
  });

  it("leaves an unhandled root Back press for an installed TV platform", () => {
    expect(tvBackNavigationTarget("/")).toBeNull();
    expect(tvBackNavigationTarget("/", "/profiles")).toBe("/profiles");
    expect(tvBackNavigationTarget("/movies/example")).toBe("/movies");
    expect(tvBackNavigationTarget("/", undefined, true)).toBe(-1);
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

describe("queued moves across a route change (audit A18)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops moves that have not run yet and cancels the frame that would apply them", () => {
    const cancel = vi.fn();
    vi.stubGlobal("window", {
      requestAnimationFrame: () => 7,
      cancelAnimationFrame: cancel,
      clearTimeout: () => undefined,
    });
    vi.stubGlobal("document", { querySelector: () => null, body: { dataset: {} } });
    enqueueMove("down");
    enqueueMove("right");
    expect(pendingMoveCount()).toBe(2);

    clearPendingMoves();

    expect(pendingMoveCount()).toBe(0);
    expect(cancel).toHaveBeenCalledWith(7);
  });
});

describe("isPlainArrowEvent (audit A22)", () => {
  it("accepts a bare arrow", () => {
    expect(isPlainArrowEvent({ defaultPrevented: false })).toBe(true);
  });

  it("passes modifier chords and already-handled keys through", () => {
    expect(isPlainArrowEvent({ defaultPrevented: false, altKey: true })).toBe(false);
    expect(isPlainArrowEvent({ defaultPrevented: false, ctrlKey: true })).toBe(false);
    expect(isPlainArrowEvent({ defaultPrevented: false, metaKey: true })).toBe(false);
    expect(isPlainArrowEvent({ defaultPrevented: true })).toBe(false);
  });
});

describe("shouldClickAfterRedispatch (audit A11)", () => {
  const link = { consumed: false, key: "Enter", tagName: "A", hasHref: true };

  it("clicks a link or button that no handler consumed", () => {
    expect(shouldClickAfterRedispatch(link)).toBe(true);
    expect(shouldClickAfterRedispatch({ ...link, tagName: "BUTTON", hasHref: false })).toBe(true);
    expect(shouldClickAfterRedispatch({ ...link, key: "Unidentified", keyCode: 23 })).toBe(true);
  });

  it("leaves consumed, disabled, href-less and non-Enter cases alone", () => {
    expect(shouldClickAfterRedispatch({ ...link, consumed: true })).toBe(false);
    expect(shouldClickAfterRedispatch({ ...link, disabled: true })).toBe(false);
    expect(shouldClickAfterRedispatch({ ...link, hasHref: false })).toBe(false);
    expect(shouldClickAfterRedispatch({ ...link, key: " " })).toBe(false);
    expect(shouldClickAfterRedispatch({ ...link, tagName: "DIV" })).toBe(false);
  });
});
