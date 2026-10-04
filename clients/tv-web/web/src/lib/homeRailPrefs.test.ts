import { describe, expect, it } from "vitest";
import {
  moveRail,
  toggleRail,
  toPreferencesRequest,
  type RailPreferenceEntry,
} from "./homeRailPrefs";

const entry = (id: string, hidden = false): RailPreferenceEntry => ({
  id,
  kind: "recently_added",
  library: "movie",
  title: id,
  hidden,
});

describe("home rail preferences", () => {
  it("moves rails within bounds", () => {
    const list = [entry("a"), entry("b"), entry("c")];
    expect(moveRail(list, "b", -1).map((e) => e.id)).toEqual(["b", "a", "c"]);
    expect(moveRail(list, "c", 1)).toBe(list);
    expect(moveRail(list, "a", -1)).toBe(list);
    expect(moveRail(list, "zzz", 1)).toBe(list);
  });

  it("toggles hidden and builds the request with the full order", () => {
    const list = toggleRail([entry("a"), entry("b")], "b");
    expect(toPreferencesRequest(list)).toEqual({ order: ["a", "b"], hidden: ["b"] });
  });
});
