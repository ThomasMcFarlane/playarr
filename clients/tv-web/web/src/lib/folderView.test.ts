import { describe, expect, it } from "vitest";
import type { FolderEntry } from "@playarr-tv/api-client";
import {
  FOLDER_DEFAULTS,
  activeFolderFilterCount,
  applyFolderUrl,
  folderAncestors,
  folderPlaybackQueue,
  folderProgress,
  formatFolderDuration,
  normaliseFolderPath,
  parentFolderPath,
  parseFolderUrl,
} from "./folderView";

const ROOT = "31b51f0d-e8f1-5ed1-bf63-a0cae6215685";

describe("folder URL state", () => {
  it("round-trips every view field and the navigation fields", () => {
    for (const view of ["list", "cover"] as const)
      for (const sort of ["name", "modified", "size", "duration"] as const)
          for (const order of ["asc", "desc"] as const) {
            const state = { ...FOLDER_DEFAULTS, root: ROOT, path: "Season A/Deep", kind: "movie" as const, view, sort, order, q: "clip", type: "media" as const };
            const query = applyFolderUrl(new URLSearchParams(), state).toString();
            expect(parseFolderUrl(new URLSearchParams(query))).toEqual(state);
          }
  });

  it("falls back to defaults for unknown or malformed values", () => {
    const parsed = parseFolderUrl(new URLSearchParams("root=nope&path=../x&view=cloud&sort=colour&order=up&type=files&kind=film&size=huge"));
    expect(parsed).toEqual(FOLDER_DEFAULTS);
  });

  it("normalises paths and refuses traversal and backslashes", () => {
    expect(normaliseFolderPath("/a//b/./c/")).toBe("a/b/c");
    expect(normaliseFolderPath("a/../b")).toBe("");
    expect(normaliseFolderPath("a\\b")).toBe("");
    expect(normaliseFolderPath(null)).toBe("");
  });

  it("drops navigation params at their defaults and keeps unrelated params", () => {
    const start = new URLSearchParams(`root=${ROOT}&path=a&q=x&type=media&panel=filters`);
    const out = applyFolderUrl(start, { path: "", q: "", type: "all" });
    expect(out.toString()).toBe(`root=${ROOT}&panel=filters`);
  });

  it("resets the path when the root changes and the search when the path changes", () => {
    const start = new URLSearchParams(`root=${ROOT}&path=a/b&q=clip`);
    expect(applyFolderUrl(start, { root: "11111111-1111-1111-1111-111111111111" }).get("path")).toBeNull();
    const moved = applyFolderUrl(start, { path: "a" });
    expect(moved.get("path")).toBe("a");
    expect(moved.get("q")).toBeNull();
    // An explicit q alongside a path change is kept.
    expect(applyFolderUrl(start, { path: "a", q: "keep" }).get("q")).toBe("keep");
  });

  it("counts only filters that narrow the listing", () => {
    expect(activeFolderFilterCount(FOLDER_DEFAULTS)).toBe(0);
    expect(activeFolderFilterCount({ ...FOLDER_DEFAULTS, q: "x", type: "media", sort: "size" })).toBe(2);
  });

  it("derives breadcrumbs and parents", () => {
    expect(folderAncestors("a/b/c")).toEqual(["a", "a/b", "a/b/c"]);
    expect(folderAncestors("")).toEqual([]);
    expect(parentFolderPath("a/b/c")).toBe("a/b");
    expect(parentFolderPath("a")).toBe("");
  });
});

describe("folder entries", () => {
  const media = (name: string, extra: Partial<FolderEntry> = {}): FolderEntry => ({
    entry_type: "media",
    name,
    path: name,
    media_file_id: `id-${name}`,
    title: name.replace(/\.\w+$/, ""),
    ...extra,
  });

  it("queues only playable entries in listing order", () => {
    const queue = folderPlaybackQueue([
      { entry_type: "directory", name: "Season A", path: "Season A" },
      media("b.mp4"),
      media("a.mkv", { artist: "Sample Artist" }),
    ]);
    expect(queue).toEqual([
      { mediaFileId: "id-b.mp4", title: "b", subtitle: undefined },
      { mediaFileId: "id-a.mkv", title: "a", subtitle: "Sample Artist" },
    ]);
  });

  it("formats durations and progress", () => {
    expect(formatFolderDuration(65_000)).toBe("1:05");
    expect(formatFolderDuration(3_725_000)).toBe("1:02:05");
    expect(formatFolderDuration(null)).toBe("");
    expect(folderProgress(media("a.mp4", { watch_state: "part_watched", position_ms: 250, duration_ms: 1000 }))).toBe(0.25);
    expect(folderProgress(media("a.mp4", { watch_state: "watched", position_ms: 1000, duration_ms: 1000 }))).toBe(0);
  });
});
