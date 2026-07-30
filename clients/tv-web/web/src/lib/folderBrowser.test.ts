import { describe, expect, it } from "vitest";
import type {
  FolderBrowseResponse,
  FolderRoot,
} from "@playarr-tv/api-client";
import {
  formatFolderDuration,
  formatFolderFileSize,
  mergeFolderBrowsePages,
} from "./folderBrowser";

const root: FolderRoot = {
  id: "root-1",
  source_instance_id: "source-1",
  source_name: "Movies",
  library_kind: "movie",
  name: "Films",
  available: true,
  unavailable_reason: null,
};

function page(
  overrides: Partial<FolderBrowseResponse> = {}
): FolderBrowseResponse {
  return {
    root,
    path: "",
    breadcrumbs: [],
    entries: [],
    total: 0,
    offset: 0,
    limit: 2,
    ...overrides,
  };
}

describe("folder browser data", () => {
  it("merges paged entries without duplicating a repeated boundary item", () => {
    const first = page({
      entries: [
        { entry_type: "directory", name: "Drama", path: "Drama" },
        {
          entry_type: "media",
          name: "Voyage.mkv",
          path: "Voyage.mkv",
          media_file_id: "media-1",
        },
      ],
      total: 3,
    });
    const next = page({
      entries: [
        {
          entry_type: "media",
          name: "Voyage.mkv",
          path: "Voyage.mkv",
          media_file_id: "media-1",
        },
        {
          entry_type: "media",
          name: "Moon.mkv",
          path: "Moon.mkv",
          media_file_id: "media-2",
        },
      ],
      offset: 2,
      total: 3,
    });

    expect(mergeFolderBrowsePages(first, next).entries.map((entry) => entry.name))
      .toEqual(["Drama", "Voyage.mkv", "Moon.mkv"]);
  });

  it("formats file-derived duration and size compactly", () => {
    expect(formatFolderDuration(65_000)).toBe("1:05");
    expect(formatFolderDuration(3_661_000)).toBe("1:01:01");
    expect(formatFolderDuration(undefined)).toBeNull();
    expect(formatFolderFileSize(1_500_000_000)).toBe("1.5 GB");
    expect(formatFolderFileSize(-1)).toBeNull();
  });
});
