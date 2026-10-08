import { describe, expect, it } from "vitest";
import { routeDirection, routeMotionApplies } from "./routeMotion";

describe("route motion", () => {
  it("treats browser Back and moves up the tree as Back, everything else as forward", () => {
    expect(routeDirection("/movies", "/movies/abc", "PUSH")).toBe("forward");
    expect(routeDirection("/movies/abc", "/movies", "PUSH")).toBe("back");
    expect(routeDirection("/movies/abc", "/", "PUSH")).toBe("forward");
    expect(routeDirection("/series", "/movies", "PUSH")).toBe("forward");
    expect(routeDirection("/movies", "/", "POP")).toBe("back");
  });

  it("does not animate settings panels, the player or an unchanged path", () => {
    expect(routeMotionApplies("/settings/player", "/settings/language")).toBe(false);
    expect(routeMotionApplies("/movies", "/player/x")).toBe(false);
    expect(routeMotionApplies("/player/x", "/movies")).toBe(false);
    expect(routeMotionApplies("/movies", "/movies")).toBe(false);
    expect(routeMotionApplies("/", "/settings")).toBe(true);
    expect(routeMotionApplies("/settings", "/")).toBe(true);
  });
});
