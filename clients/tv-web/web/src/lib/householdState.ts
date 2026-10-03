import type { HouseholdStatus } from "@playarr-tv/api-client";

export type HouseholdBlockKind = "outside_schedule" | "budget_exhausted";

/** The block to show, or `null` when the profile may watch now. */
export function householdBlockFromStatus(
  status: HouseholdStatus | null
): { kind: HouseholdBlockKind; until: string | null } | null {
  if (!status) return null;
  if (status.state === "outside_schedule") {
    return { kind: "outside_schedule", until: status.next_start_at ?? null };
  }
  if (status.state === "budget_exhausted") {
    return { kind: "budget_exhausted", until: status.resets_at ?? null };
  }
  return null;
}

/**
 * Whole minutes of watch time left, for a "N min left" chip. Shown for any
 * budgeted profile in its last hour so it is a warning, not clutter; a
 * schedule window ending sooner counts as the limit too.
 */
export function remainingMinutes(status: HouseholdStatus | null, now: Date): number | null {
  if (!status || status.state !== "allowed") return null;
  const candidates: number[] = [];
  if (status.remaining_seconds != null) candidates.push(status.remaining_seconds / 60);
  if (status.window_ends_at) {
    candidates.push((new Date(status.window_ends_at).getTime() - now.getTime()) / 60_000);
  }
  if (candidates.length === 0) return null;
  const minutes = Math.ceil(Math.min(...candidates));
  return minutes <= 60 ? Math.max(minutes, 0) : null;
}

/** Whether a request should be offered to the guardian for this block. */
export function approvalSubjectFor(kind: HouseholdBlockKind): "schedule" | "budget" {
  return kind === "outside_schedule" ? "schedule" : "budget";
}
