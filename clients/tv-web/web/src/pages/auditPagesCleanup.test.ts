import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Downloads (R26)", () => {
  it("shows the storage usage line once, in the panel", () => {
    const source = read("./Downloads.tsx");
    expect(source.match(/pages\.downloads\.storageUsed/g)).toHaveLength(1);
    expect(source).toContain("tv-downloads-storage-panel");
  });
});
