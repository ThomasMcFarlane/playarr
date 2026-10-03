import type { CapabilityItem, CapabilityStatus } from "@playarr-tv/api-client";

/** URL-persisted view filter for the Server capabilities page (`?show=`). */
export type CapabilityFilter = "all" | "attention" | "present";

export const CAPABILITY_FILTERS: ReadonlyArray<{ value: CapabilityFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "present", label: "Present" },
];

export function parseCapabilityFilter(value: string | null): CapabilityFilter {
  return value === "attention" || value === "present" ? value : "all";
}

const STATUS_ORDER: Record<CapabilityStatus, number> = { missing: 0, degraded: 1, present: 2 };

export function filterCapabilities(
  items: readonly CapabilityItem[],
  filter: CapabilityFilter
): CapabilityItem[] {
  if (filter === "present") return items.filter((item) => item.status === "present");
  if (filter === "attention") return items.filter((item) => item.status !== "present");
  return [...items];
}

/** Problems first (missing, then degraded), required before optional; ties keep server order. */
export function sortCapabilities(items: readonly CapabilityItem[]): CapabilityItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        STATUS_ORDER[a.item.status] - STATUS_ORDER[b.item.status] ||
        Number(b.item.required) - Number(a.item.required) ||
        a.index - b.index
    )
    .map(({ item }) => item);
}

/** Required items that are not present: these break playback features outright. */
export function blockingCapabilities(items: readonly CapabilityItem[]): CapabilityItem[] {
  return items.filter((item) => item.required && item.status !== "present");
}

export function capabilityBadgeClass(status: CapabilityStatus): string {
  switch (status) {
    case "present":
      return "badge badge-success badge-pill";
    case "degraded":
      return "badge badge-warning badge-pill";
    default:
      return "badge badge-danger badge-pill";
  }
}
