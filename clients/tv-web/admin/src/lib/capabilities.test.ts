import type { CapabilityItem } from "@playarr-tv/api-client";
import { describe, expect, it } from "vitest";
import {
  blockingCapabilities,
  capabilityBadgeClass,
  filterCapabilities,
  parseCapabilityFilter,
  sortCapabilities,
} from "./capabilities";

function item(id: string, status: CapabilityItem["status"], required: boolean): CapabilityItem {
  return {
    id,
    name: id,
    category: "binary",
    status,
    required,
    path: null,
    version: null,
    detail: null,
    impact: `${id} impact`,
    install_hint: `${id} hint`,
  };
}

const items = [
  item("a-present", "present", true),
  item("b-optional-missing", "missing", false),
  item("c-required-missing", "missing", true),
  item("d-degraded", "degraded", false),
];

describe("capabilities lib", () => {
  it("parses only known filters and defaults to all", () => {
    expect(parseCapabilityFilter("attention")).toBe("attention");
    expect(parseCapabilityFilter("present")).toBe("present");
    expect(parseCapabilityFilter("bogus")).toBe("all");
    expect(parseCapabilityFilter(null)).toBe("all");
  });

  it("filters by status", () => {
    expect(filterCapabilities(items, "all")).toHaveLength(4);
    expect(filterCapabilities(items, "present").map((i) => i.id)).toEqual(["a-present"]);
    expect(filterCapabilities(items, "attention").map((i) => i.id)).toEqual([
      "b-optional-missing",
      "c-required-missing",
      "d-degraded",
    ]);
  });

  it("sorts problems first, required before optional", () => {
    expect(sortCapabilities(items).map((i) => i.id)).toEqual([
      "c-required-missing",
      "b-optional-missing",
      "d-degraded",
      "a-present",
    ]);
  });

  it("flags only required items that are not present as blocking", () => {
    expect(blockingCapabilities(items).map((i) => i.id)).toEqual(["c-required-missing"]);
  });

  it("maps statuses to badge classes", () => {
    expect(capabilityBadgeClass("present")).toContain("badge-success");
    expect(capabilityBadgeClass("degraded")).toContain("badge-warning");
    expect(capabilityBadgeClass("missing")).toContain("badge-danger");
  });
});
