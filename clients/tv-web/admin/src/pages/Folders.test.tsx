import type { AdminFolderRoot } from "@playarr-tv/api-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FolderRootRow } from "./Folders";

const root: AdminFolderRoot = {
  id: "r1",
  source_instance_id: "s1",
  source_name: "Sample Library",
  library_kind: "movie",
  name: "Sample Unsorted",
  reported_path: "/library/sample-unsorted",
  local_path: null,
  effective_path: "/library/sample-unsorted",
  manual: false,
  active: true,
  scan_enabled: false,
  path_available: false,
  scan_status: "pending",
  scan_error: null,
  last_scanned_at: null,
  item_count: 0,
};

const noop = () => undefined;

describe("FolderRootRow", () => {
  it("shows a disabled root as off, with paths and no remove button for a reported root", () => {
    const html = renderToStaticMarkup(
      <FolderRootRow root={root} busy={false} onToggle={noop} onSavePath={noop} onScan={noop} onDelete={noop} />
    );
    expect(html).not.toContain("checked");
    expect(html).toContain("/library/sample-unsorted");
    expect(html).toContain("(not available here)");
    expect(html).toContain("Not scanned yet");
    expect(html).not.toContain("Remove");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Scan now/);
  });

  it("enables scanning controls for an enabled manual root and surfaces a failed scan", () => {
    const html = renderToStaticMarkup(
      <FolderRootRow
        root={{ ...root, manual: true, scan_enabled: true, scan_status: "failed", scan_error: "not available", item_count: 12 }}
        busy={false}
        onToggle={noop}
        onSavePath={noop}
        onScan={noop}
        onDelete={noop}
      />
    );
    expect(html).toContain("checked");
    expect(html).toContain("Failed: not available");
    expect(html).toContain("12 files");
    expect(html).toContain("Remove");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Scan now/);
  });
});
