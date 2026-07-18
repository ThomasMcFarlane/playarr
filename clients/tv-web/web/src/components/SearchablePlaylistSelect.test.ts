import { describe, expect, it } from "vitest";
import { playlistSearchHandlesKey } from "./SearchablePlaylistSelect";

describe("SearchablePlaylistSelect", () => {
  it("releases vertical arrows from its single-line search input", () => {
    expect(playlistSearchHandlesKey("ArrowUp")).toBe(false);
    expect(playlistSearchHandlesKey("ArrowDown")).toBe(false);
  });

  it("keeps selection and close keys inside the dropdown", () => {
    expect(playlistSearchHandlesKey("Enter")).toBe(true);
    expect(playlistSearchHandlesKey("Escape")).toBe(true);
  });
});
