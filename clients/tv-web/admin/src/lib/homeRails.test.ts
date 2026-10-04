import { describe, expect, it } from "vitest";
import type { HomeRailDefinition } from "@playarr-tv/api-client";
import {
  groupByLibrary,
  isEasterRule,
  moveWithinGroup,
  newSeasonalRule,
  parseOptionalInt,
  setRuleWindow,
  splitList,
} from "./homeRails";

function rail(id: string, library: HomeRailDefinition["library"], position: number): HomeRailDefinition {
  return {
    id,
    kind: "recently_added",
    library,
    name: null,
    default_title: id,
    view_id: null,
    enabled: true,
    position,
    is_default: true,
    config: {},
    effective_seasonal_rules: null,
  };
}

const RAILS = [
  rail("m1", "movie", 0),
  rail("s1", "series", 1),
  rail("m2", "movie", 2),
  rail("a1", "artist", 3),
];

describe("home rails helpers", () => {
  it("groups by library in a stable order", () => {
    const groups = groupByLibrary(RAILS);
    expect(groups.map((g) => g.library)).toEqual(["movie", "series", "artist"]);
    expect(groups[0]?.rails.map((r) => r.id)).toEqual(["m1", "m2"]);
  });

  it("moves a rail within its library by swapping with its neighbour", () => {
    expect(moveWithinGroup(RAILS, "m2", -1)).toEqual(["m2", "s1", "m1", "a1"]);
    expect(moveWithinGroup(RAILS, "m1", 1)).toEqual(["m2", "s1", "m1", "a1"]);
    expect(moveWithinGroup(RAILS, "m1", -1)).toBeNull();
    expect(moveWithinGroup(RAILS, "s1", 1)).toBeNull();
  });

  it("splits comma lists and parses optional ints", () => {
    expect(splitList(" a, b ,, c")).toEqual(["a", "b", "c"]);
    expect(parseOptionalInt("")).toBeNull();
    expect(parseOptionalInt("60")).toBe(60);
    expect(parseOptionalInt("1.5")).toBeNull();
  });

  it("switches a rule between fixed and Easter windows", () => {
    const easter = setRuleWindow(newSeasonalRule(), "easter");
    expect(isEasterRule(easter)).toBe(true);
    expect(easter.start).toBeNull();
    const fixed = setRuleWindow(easter, "fixed");
    expect(isEasterRule(fixed)).toBe(false);
    expect(fixed.start).toBe("01-01");
  });
});
