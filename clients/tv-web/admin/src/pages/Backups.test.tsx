import type { BackupSummary } from "@playarr-tv/api-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BackupFailures, BackupRow, BackupRunBanner, BackupSetup } from "./Backups";

const backup: BackupSummary = {
  id: "abc123",
  created_at: "2026-10-03T12:00:00Z",
  archive_name: "playarr-backup-20261003T120000Z-abc123.parbak",
  size_bytes: 5 * 1024 * 1024,
  engine: "sqlite",
  schema_version: 43,
  server_version: "0.1.0",
  mode: "database",
  partial: true,
  complete: true,
  tables: 40,
  rows: 1234,
  included: [{ class: "database", detail: "consistent SQLite snapshot" }],
  excluded: [{ class: "media libraries", detail: "never copied" }],
  unavailable: [],
  library_roots: ["/srv/media/Movies"],
  required_secrets: ["DATABASE_URL", "PLAYARR_JWT_SECRET"],
};

const noop = () => undefined;

describe("Backups components", () => {
  it("labels a database-only backup as partial and lists external dependencies", () => {
    const html = renderToStaticMarkup(
      <BackupRow backup={backup} busy={false} onDownload={noop} onVerify={noop} onDelete={noop} />
    );
    expect(html).toContain("Partial");
    expect(html).toContain("media libraries");
    expect(html).toContain("/srv/media/Movies");
    expect(html).toContain("DATABASE_URL");
    expect(html).toContain("5.0 MiB");
  });

  it("disables download for an incomplete backup and flags it", () => {
    const html = renderToStaticMarkup(
      <BackupRow
        backup={{ ...backup, complete: false }}
        busy={false}
        onDownload={noop}
        onVerify={noop}
        onDelete={noop}
      />
    );
    expect(html).toContain("Incomplete");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Download/);
  });

  it("shows run progress and failures", () => {
    expect(
      renderToStaticMarkup(
        <BackupRunBanner
          run={{
            id: "r",
            started_at: "2026-10-03T12:00:00Z",
            trigger: "manual",
            phase: "snapshot",
            bytes_staged: 0,
          }}
        />
      )
    ).toContain("consistent database snapshot");
    const failures = renderToStaticMarkup(
      <BackupFailures
        failures={[{ id: "f", at: "2026-10-03T12:00:00Z", phase: "publish", error: "disk full" }]}
      />
    );
    expect(failures).toContain("disk full");
    expect(failures).toContain("never removes an older backup");
    expect(renderToStaticMarkup(<BackupFailures failures={[]} />)).toBe("");
  });

  it("explains how to enable backups without exposing any key", () => {
    const html = renderToStaticMarkup(<BackupSetup restoreCommand="playarr-server backup restore" />);
    expect(html).toContain("PLAYARR_BACKUP_RECIPIENTS");
    expect(html).toContain("offline");
    expect(html).not.toContain("AGE-SECRET-KEY");
  });
});
