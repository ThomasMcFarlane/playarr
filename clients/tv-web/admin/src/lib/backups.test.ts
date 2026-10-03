import { describe, expect, it } from "vitest";
import {
  backupBadge,
  describePhase,
  downloadName,
  formatBytes,
  scheduleSummary,
} from "./backups";

describe("backups helpers", () => {
  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GiB");
    expect(formatBytes(-1)).toBe("unknown");
  });

  it("labels incomplete, partial and complete backups distinctly", () => {
    expect(backupBadge({ complete: false, partial: false }).label).toBe("Incomplete");
    expect(backupBadge({ complete: true, partial: true }).label).toBe("Partial");
    expect(backupBadge({ complete: true, partial: false }).label).toBe("Complete");
    // An incomplete backup is never presented as partial or complete.
    expect(backupBadge({ complete: false, partial: true }).label).toBe("Incomplete");
  });

  it("describes run phases and staged bytes", () => {
    expect(describePhase({ phase: "snapshot", bytes_staged: 0 })).toContain("consistent");
    expect(describePhase({ phase: "assets", bytes_staged: 2048 })).toContain("2.0 KiB");
    expect(describePhase({ phase: "unknown-phase", bytes_staged: 0 })).toBe("unknown-phase");
  });

  it("summarises schedules", () => {
    expect(scheduleSummary(null)).toBe("Manual only");
    expect(scheduleSummary(24)).toBe("Daily");
    expect(scheduleSummary(72)).toBe("Every 3 days");
    expect(scheduleSummary(6)).toBe("Every 6 hours");
  });

  it("sanitises download names", () => {
    expect(downloadName({ archive_name: "playarr-backup-1.parbak" })).toBe("playarr-backup-1.parbak");
    expect(downloadName({ archive_name: "../x y.parbak" })).toBe(".._x_y.parbak");
  });
});
